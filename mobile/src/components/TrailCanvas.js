// CM2: the trail's canvas on a phone. Drag to move around, pinch to zoom,
// tap a card, tap the minimap to go there. When editing is on (a trail of
// your own; Sven, 2026-11-15): press and hold a card, or a group's name, then
// drag to move it; taps go to the tool in use (see CanvasEditor.js).
import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, Text, View } from "react-native";
import { colors, ui } from "../theme";
import Button from "./Button";

const M = require("../trailModel");

const MINI_W = 120;
const MINI_H = 84;
const LINE_COLOR = { you: colors.accent, auto: "#9b8cff", nav: "#5a5a5a", suggested: "#444" };

export default function TrailCanvas({ snap, onCard, shown = null, focus = null, editable = false, selected = null, onEmptyTap, onMoveCard, onMoveGroup, onGroupTap }) {
  const [size, setSize] = useState(null);
  const [view, setView] = useState(null);
  const viewRef = useRef(null);
  viewRef.current = view;
  const boxRef = useRef(null);
  const origin = useRef({ x: 0, y: 0 }); // the canvas's place on screen, for pinch centres
  const bounds = useMemo(() => M.worldBounds(snap), [snap]);
  const fit = () => {
    if (size) setView(M.fitView(bounds, size.w, size.h));
  };
  // Moving a card or a group: { kind, id, x0, y0 } while a finger holds it.
  const dragRef = useRef(null);
  const dragTaken = useRef(false); // the finger moved, so the canvas took the drag
  const [drag, setDrag] = useState(null); // { kind, id, dx, dy } in world units
  const editRef = useRef({});
  editRef.current = { onMoveCard, onMoveGroup };
  const count = snap?.cards?.length || 0;
  const hadCards = useRef(count > 0);
  // The first card of an empty trail: show it.
  useEffect(() => {
    if (count > 0 && !hadCards.current) fit();
    hadCards.current = count > 0;
  }, [count]);

  // A new trail, or the first layout: show all of it.
  useEffect(() => {
    fit();
  }, [snap?.trail?.id, size?.w, size?.h]);
  // Replay: keep the step's card on screen.
  useEffect(() => {
    if (!focus || !size || !viewRef.current) return;
    const c = snap.cards.find((x) => x.id === focus);
    if (c) setView(M.centreOn({ ...viewRef.current, z: Math.max(viewRef.current.z, 0.45) }, c.x + c.w / 2, c.y + c.h / 2, size.w, size.h));
  }, [focus]);

  const gesture = useRef({ start: null, dist: 0, mid: null });
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (e) => e.nativeEvent.touches.length > 1,
        onMoveShouldSetPanResponderCapture: () => Boolean(dragRef.current), // a held card or group: take its drag
        onMoveShouldSetPanResponder: (e, g) => e.nativeEvent.touches.length > 1 || Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
        onPanResponderGrant: () => {
          dragTaken.current = Boolean(dragRef.current);
          gesture.current = { start: viewRef.current, dist: 0, mid: null, last: viewRef.current };
        },
        onPanResponderRelease: (_e, g) => {
          const d = dragRef.current;
          dragRef.current = null;
          setDrag(null);
          if (!d) return;
          const z = viewRef.current?.z || 1;
          const x = d.x0 + g.dx / z, y = d.y0 + g.dy / z;
          if (Math.abs(g.dx) + Math.abs(g.dy) < 3) return;
          if (d.kind === "card") editRef.current.onMoveCard?.(d.id, x, y);
          else editRef.current.onMoveGroup?.(d.id, x, y);
        },
        onPanResponderTerminate: () => {
          dragRef.current = null;
          setDrag(null);
        },
        onPanResponderMove: (e, g) => {
          const t = e.nativeEvent.touches;
          if (dragRef.current) {
            const z = viewRef.current?.z || 1;
            setDrag({ kind: dragRef.current.kind, id: dragRef.current.id, dx: g.dx / z, dy: g.dy / z });
            return;
          }
          const st = gesture.current;
          if (!st.start) return;
          if (t.length >= 2) {
            const d = Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
            const mid = { x: (t[0].pageX + t[1].pageX) / 2 - origin.current.x, y: (t[0].pageY + t[1].pageY) / 2 - origin.current.y };
            if (!st.dist) {
              // A pinch starts: measure from the view as it is now.
              st.dist = d;
              st.base = st.last;
              st.mid = mid;
              return;
            }
            const z = M.zoomAt(st.base, d / st.dist, st.mid.x, st.mid.y);
            st.last = { ...z, x: z.x + mid.x - st.mid.x, y: z.y + mid.y - st.mid.y };
          } else {
            if (st.dist) {
              // Back to one finger after a pinch: carry on from there.
              st.dist = 0;
              st.start = { ...st.last, x: st.last.x - g.dx, y: st.last.y - g.dy };
            }
            st.last = { ...st.start, x: st.start.x + g.dx, y: st.start.y + g.dy };
          }
          setView(st.last);
        },
        onPanResponderTerminationRequest: () => false,
      }),
    []
  );

  // Cards and groups where they show now (a held one follows the finger).
  const groupDragged = drag?.kind === "group" ? (snap?.groups || []).find((g) => g.id === drag.id) : null;
  const inDragged = (c) => groupDragged && c.x + c.w / 2 >= groupDragged.x && c.x + c.w / 2 <= groupDragged.x + groupDragged.w && c.y + c.h / 2 >= groupDragged.y && c.y + c.h / 2 <= groupDragged.y + groupDragged.h;
  const at = (c) => ((drag?.kind === "card" && drag.id === c.id) || inDragged(c) ? { ...c, x: c.x + drag.dx, y: c.y + drag.dy } : c);
  const byId = useMemo(() => new Map((snap?.cards || []).map((c) => [c.id, c])), [snap]);
  const startDrag = (kind, o) => {
    if (!editable) return;
    dragRef.current = { kind, id: o.id, x0: o.x, y0: o.y };
    dragTaken.current = false;
    setDrag({ kind, id: o.id, dx: 0, dy: 0 });
  };
  // Held but let go without moving: nothing to move.
  const endHold = () =>
    setTimeout(() => {
      if (dragRef.current && !dragTaken.current) {
        dragRef.current = null;
        setDrag(null);
      }
    }, 0);
  const lines = (snap?.lines || []).filter((l) => l.kind !== "suggested" && byId.has(l.from) && byId.has(l.to));
  const dim = (id) => shown && !shown.has(id);
  const empty = !snap?.cards?.length;

  return (
    <View
      ref={boxRef}
      style={{ flex: 1, backgroundColor: colors.bg, overflow: "hidden" }}
      onLayout={(e) => {
        setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
        boxRef.current?.measureInWindow?.((x, y) => (origin.current = { x, y }));
      }}
      {...pan.panHandlers}
    >
      {/* Taps on empty canvas: where a note or question goes. */}
      {editable && view ? (
        <Pressable
          style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}
          onPress={(e) => onEmptyTap?.((e.nativeEvent.locationX - view.x) / view.z, (e.nativeEvent.locationY - view.y) / view.z)}
          accessible={false}
        />
      ) : null}
      {view && !empty ? (
        <View pointerEvents="box-none" style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, transformOrigin: "top left", transform: [{ translateX: view.x }, { translateY: view.y }, { scale: view.z }] }}>
          {(snap.groups || [])
            .filter((g) => !g.suggested && [g.x, g.y, g.w, g.h].every(Number.isFinite))
            .map((g) => (g.id === drag?.id ? { ...g, x: g.x + drag.dx, y: g.y + drag.dy } : g))
            .map((g) => (
              <View key={g.id} pointerEvents="box-none" style={{ position: "absolute", left: g.x, top: g.y, width: g.w, height: g.h, borderRadius: 14, borderWidth: 2, borderColor: g.resolved ? colors.ok : "#3a3a48", backgroundColor: "rgba(122,162,255,0.05)", opacity: shown && !shown.groups?.has?.(g.id) && shown.stepGroups?.has?.(g.id) ? 0.25 : 1 }}>
                <Pressable
                  onPress={() => onGroupTap?.(g)}
                  onLongPress={() => startDrag("group", g)}
                  onPressOut={endHold}
                  delayLongPress={300}
                  disabled={!onGroupTap}
                  accessibilityRole="button"
                  accessibilityLabel={`Group: ${g.label || "New group"}${g.resolved ? ", resolved" : ""}`}
                  accessibilityHint={editable ? "Opens the group. Press and hold, then drag, to move it" : undefined}
                  style={{ alignSelf: "flex-start" }}
                >
                  <Text style={{ color: colors.mute, fontSize: 18, fontWeight: "600", margin: 12 }} numberOfLines={1}>
                    {g.label || "New group"}
                    {g.resolved ? " ✓" : ""}
                  </Text>
                </Pressable>
              </View>
            ))}
          {lines.map((l) => {
            const a = at(byId.get(l.from));
            const b = at(byId.get(l.to));
            const x1 = a.x + a.w / 2, y1 = a.y + a.h / 2, x2 = b.x + b.w / 2, y2 = b.y + b.h / 2;
            const len = Math.hypot(x2 - x1, y2 - y1);
            const hidden = shown && !(shown.lines.has(l.id) || (l.kind !== "you" && shown.cards.has(l.from) && shown.cards.has(l.to)));
            return [
              <View
                key={l.id}
                pointerEvents="none"
                style={{ position: "absolute", left: (x1 + x2) / 2 - len / 2, top: (y1 + y2) / 2 - 1.5, width: len, height: 3, backgroundColor: LINE_COLOR[l.kind] || colors.mute, opacity: hidden ? 0.1 : 0.8, transform: [{ rotate: `${Math.atan2(y2 - y1, x2 - x1)}rad` }] }}
              />,
              l.label ? (
                <Text key={`${l.id}:label`} pointerEvents="none" style={{ position: "absolute", left: (x1 + x2) / 2 - 60, top: (y1 + y2) / 2 - 14, width: 120, textAlign: "center", color: colors.text, fontSize: 14, backgroundColor: colors.bg, opacity: hidden ? 0.1 : 1 }} numberOfLines={1}>
                  {l.label}
                </Text>
              ) : null,
            ];
          })}
          {snap.cards
            .filter((c) => [c.x, c.y, c.w, c.h].every(Number.isFinite))
            .map(at)
            .map((c) => {
              const f = M.cardFace(c);
              const picked = selected?.has?.(c.id);
              const start = snap.trail.startHere === c.id;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => onCard?.(c)}
                  onLongPress={editable ? () => startDrag("card", byId.get(c.id)) : undefined}
                  onPressOut={editable ? endHold : undefined}
                  delayLongPress={300}
                  accessibilityRole="button"
                  accessibilityLabel={`${start ? "Start here. " : ""}${f.kicker}: ${f.title}${f.text ? `. ${f.text}` : ""}`}
                  accessibilityHint={editable ? "Press and hold, then drag, to move it" : undefined}
                  style={{ position: "absolute", left: c.x, top: c.y, width: c.w, height: c.h, borderRadius: 10, borderWidth: focus === c.id || start || picked || drag?.id === c.id ? 3 : 1, borderColor: focus === c.id || picked || drag?.id === c.id ? colors.accent : start ? colors.ok : colors.line, backgroundColor: colors.bg3, padding: 14, opacity: dim(c.id) ? 0.2 : 1, overflow: "hidden" }}
                >
                  <Text style={{ color: colors.accent, fontSize: 13, letterSpacing: 1, textTransform: "uppercase" }} numberOfLines={1}>
                    {start ? "Start here · " : ""}
                    {f.kicker}
                  </Text>
                  <Text style={{ color: colors.text, fontSize: 20, fontWeight: "600", marginTop: 6 }} numberOfLines={3}>
                    {f.title}
                  </Text>
                  {f.text ? (
                    <Text style={{ color: colors.mute, fontSize: 15, marginTop: 6, lineHeight: 20 }} numberOfLines={4}>
                      {f.text}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
        </View>
      ) : null}
      {empty ? (
        <View pointerEvents="none" style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
          <Text style={[ui.title, { textAlign: "center" }]}>No cards yet</Text>
          <Text style={[ui.help, { textAlign: "center", marginTop: 6 }]}>
            {editable ? "Pages you read for 20 seconds, scroll or capture become cards here. Or pick Note or Question and tap the canvas." : "This trail has no cards."}
          </Text>
        </View>
      ) : null}
      {view && size && !empty ? <Minimap snap={snap} bounds={bounds} view={view} size={size} onJump={(wx, wy) => setView(M.centreOn(view, wx, wy, size.w, size.h))} /> : null}
      {view && size && !empty ? (
        <View style={{ position: "absolute", left: 10, bottom: 10, flexDirection: "row", gap: 6 }}>
          <Button label="Fit" a11yLabel="Fit the whole trail" small onPress={fit} />
          <Button label="−" a11yLabel="Zoom out" small onPress={() => setView(M.zoomAt(view, 1 / 1.4, size.w / 2, size.h / 2))} />
          <Button label="+" a11yLabel="Zoom in" small onPress={() => setView(M.zoomAt(view, 1.4, size.w / 2, size.h / 2))} />
        </View>
      ) : null}
    </View>
  );
}

// The whole trail in small, with the part on screen outlined.
function Minimap({ snap, bounds, view, size, onJump }) {
  const k = Math.min(MINI_W / bounds.w, MINI_H / bounds.h);
  const ox = (MINI_W - bounds.w * k) / 2;
  const oy = (MINI_H - bounds.h * k) / 2;
  const at = (wx, wy) => ({ left: ox + (wx - bounds.x) * k, top: oy + (wy - bounds.y) * k });
  // The screen in world units.
  const vx = -view.x / view.z, vy = -view.y / view.z, vw = size.w / view.z, vh = size.h / view.z;
  const vp = at(vx, vy);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Minimap"
      accessibilityHint="Moves the canvas to where you tap. The Timeline tab lists every card."
      onPress={(e) => onJump(bounds.x + (e.nativeEvent.locationX - ox) / k, bounds.y + (e.nativeEvent.locationY - oy) / k)}
      style={{ position: "absolute", right: 10, bottom: 10, width: MINI_W, height: MINI_H, backgroundColor: "rgba(26,26,26,0.92)", borderRadius: 8, borderWidth: 1, borderColor: colors.line, overflow: "hidden" }}
    >
      {snap.cards.map((c) => (
        <View key={c.id} pointerEvents="none" style={{ position: "absolute", ...at(c.x, c.y), width: Math.max(2, c.w * k), height: Math.max(2, c.h * k), backgroundColor: "#555", borderRadius: 1 }} />
      ))}
      <View pointerEvents="none" style={{ position: "absolute", ...vp, width: vw * k, height: vh * k, borderWidth: 1, borderColor: colors.accent }} />
    </Pressable>
  );
}
