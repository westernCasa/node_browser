// The phone's start screen (CM1-CM5). The trail switcher and Share sit at the
// top; Timeline and Canvas are two tabs. An opened .trail.md shows Replay and
// Canvas instead. "Browse" goes back to the open tabs.
//
// Two trails matter here: the one shown, and the one pages are recorded
// into (research.current). Switching to one of your trails makes it both.
// An opened file is only shown: reading pages never writes into it.
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Keyboard, PanResponder, Pressable, Text, TextInput, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { colors, ui } from "../theme";
import Button from "./Button";
import Sheet from "./Sheet";
import TrailTimeline from "./TrailTimeline";
import TrailCanvas from "./TrailCanvas";
import ReplayPanel from "./ReplayPanel";
import CardPreview from "./CardPreview";
import ShareTrailSheet, { shareTrailFile } from "./ShareTrailSheet";

const M = require("../trailModel");

const MAX_DOTS = 7;

export default function TrailHome({ services, controller, onBrowse, onOpenUrl, onSearch, tabCount, version, bump }) {
  const store = services.trails;
  const research = services.research;
  const [shownId, setShownId] = useState(() => research.current.id);
  const [tab, setTab] = useState("timeline"); // "timeline" | "canvas" | "replay"
  const [card, setCard] = useState(null);
  const [menu, setMenu] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [step, setStep] = useState(0);
  const [query, setQuery] = useState("");
  const [displayName, setDisplayName] = useState(() => readProfile(services.storage).displayName || "");

  // The shown trail can be deleted or replaced elsewhere: fall back to the current one.
  const id = store.has(shownId) ? shownId : research.current.id;
  // Pages read since the last save go in before the trail is drawn.
  const snap = useMemo(() => {
    try {
      research.saveNow();
    } catch (_) {}
    return store.snapshot(id);
  }, [id, version]);
  const readonly = Boolean(snap?.trail.readonly);
  const replay = useMemo(() => (readonly ? M.replayFor(store, id) : null), [id, readonly, version]);
  const shown = replay?.shownAt(step) || null;
  const list = store.list();
  const index = Math.max(0, list.findIndex((t) => t.id === id));

  useEffect(() => {
    setStep(0);
    setTab(readonly ? "replay" : "timeline");
  }, [id]);

  const show = (tid) => {
    const t = store.get(tid);
    if (!t) return;
    // One of your trails: record into it from now on.
    if (!t.trail.readonly && research.current.id !== tid) {
      research.switchTo(tid);
      controller.adoptSession();
    }
    setShownId(tid);
    bump();
  };
  const showRef = useRef(show);
  showRef.current = show;
  const listRef = useRef({ list, index });
  listRef.current = { list, index };

  // Swipe on the switcher: the next or previous trail.
  const swipe = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 20 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderRelease: (_e, g) => {
        if (Math.abs(g.dx) < 50) return;
        const { list: l, index: i } = listRef.current;
        const next = l[i + (g.dx < 0 ? 1 : -1)];
        if (next) showRef.current(next.id);
      },
    })
  ).current;

  const openFile = async () => {
    setMenu(false);
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
      if (r.canceled || !r.assets?.[0]) return;
      const a = r.assets[0];
      if (a.size > M.FILE_MAX) return Alert.alert("Can't open this file", "The file is too large for a trail (over 5 MB).");
      const text = await new File(a.uri).text();
      const res = M.openTrailText(store, text, { file: a.name || "", size: a.size });
      if (res.error) return Alert.alert(`Can't open ${a.name || "this file"}`, res.error);
      setShownId(res.id);
      bump();
    } catch (err) {
      Alert.alert("Can't open this file", String(err?.message || err));
    }
  };

  const saveAsNew = () => {
    const copy = M.saveAsNew(store, id);
    if (!copy) return;
    show(copy); // lands on its timeline
  };

  const openOnDesktop = async () => {
    try {
      await shareTrailFile(snap.trail.name, M.shareText(store, id, {}));
    } catch (err) {
      Alert.alert("Can't share this file", String(err?.message || err));
    }
  };

  const keywords = !readonly && id === research.current.id ? research.threads() : [];
  const tabs = readonly ? [["replay", "Replay"], ["canvas", "Canvas"]] : [["timeline", "Timeline"], ["canvas", "Canvas"]];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg2 }}>
      {/* Trail switcher: initials, name, last visit, dots; Share next to it. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6 }} {...swipe.panHandlers}>
        <Pressable
          onPress={() => setMenu(true)}
          style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}
          accessibilityRole="button"
          accessibilityLabel={`Trail: ${snap?.trail.name || "Trail"}${readonly ? `, from ${snap.trail.from || "someone"}, read only` : ""}`}
          accessibilityHint="Opens the list of trails"
          accessibilityActions={[
            { name: "next", label: "Next trail" },
            { name: "previous", label: "Previous trail" },
          ]}
          onAccessibilityAction={(e) => {
            const next = list[index + (e.nativeEvent.actionName === "next" ? 1 : -1)];
            if (next) show(next.id);
          }}
        >
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: readonly ? "#2a3a2a" : "#2a3350", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: colors.text, fontWeight: "700", fontSize: 13 }}>{snap?.trail.mono || "?"}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={ui.title} numberOfLines={1}>
              {snap?.trail.name || "Trail"}
            </Text>
            <Text style={ui.help} numberOfLines={1}>
              {readonly ? `From ${snap.trail.from || "someone"} · ` : ""}
              {M.ago(snap?.trail.lastAt) || "new"}
            </Text>
          </View>
        </Pressable>
        <Button label="Share" a11yLabel={readonly ? "Share this file" : "Share this trail as a file"} small onPress={() => (readonly ? openOnDesktop() : setSharing(true))} />
      </View>
      {list.length > 1 ? (
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 6, paddingBottom: 6 }}>
          {list.slice(0, MAX_DOTS).map((t) => (
            <Pressable key={t.id} onPress={() => show(t.id)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Trail: ${t.name}`} accessibilityState={{ selected: t.id === id }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: t.id === id ? colors.accent : colors.line }} />
            </Pressable>
          ))}
          {list.length > MAX_DOTS ? <Text style={[ui.help, { fontSize: 10, lineHeight: 8 }]}>+{list.length - MAX_DOTS}</Text> : null}
        </View>
      ) : null}

      {/* Search or address: opens in a tab. */}
      <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
        <TextInput
          style={ui.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search or enter address"
          placeholderTextColor={colors.mute}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={() => {
            if (!query.trim()) return;
            Keyboard.dismiss();
            onSearch(query);
            setQuery("");
          }}
        />
      </View>

      <View style={{ flexDirection: "row", marginHorizontal: 14, borderWidth: 1, borderColor: colors.line, borderRadius: 8, overflow: "hidden" }}>
        {tabs.map(([k, label]) => (
          <Pressable key={k} onPress={() => setTab(k)} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} accessibilityLabel={label} style={{ flex: 1, paddingVertical: 7, alignItems: "center", backgroundColor: tab === k ? colors.bg3 : "transparent" }}>
            <Text style={{ color: tab === k ? colors.accent : colors.mute, fontSize: 13, fontWeight: "600" }}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ flex: 1, marginTop: 8 }}>
        {!snap ? null : tab === "canvas" ? (
          <TrailCanvas snap={snap} onCard={setCard} shown={shown?.cards ? shown : null} focus={readonly ? replay?.steps[step]?.card || null : null} />
        ) : tab === "replay" && readonly ? (
          <ReplayPanel
            snap={snap}
            steps={replay.steps}
            step={step}
            onStep={setStep}
            onStartHere={setCard}
            onSaveAsNew={saveAsNew}
            onOpenOnDesktop={openOnDesktop}
          />
        ) : (
          <TrailTimeline
            snap={snap}
            onItem={(it) => (it.card ? setCard(it.card) : it.url ? onOpenUrl(it.url) : null)}
            header={
              keywords.length ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 4 }}>
                  {keywords.map((t) => (
                    <Pressable key={t.term} style={ui.chip} onPress={() => controller.togglePin(t.term)}>
                      <Text style={ui.chipText}>
                        {t.term} · {t.pages}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null
            }
          />
        )}
      </View>

      <View style={{ flexDirection: "row", gap: 6, padding: 8, borderTopWidth: 1, borderColor: colors.line }}>
        <Button label={`Browse${tabCount ? ` (${tabCount})` : ""}`} onPress={onBrowse} />
        <Button label="Open file" onPress={openFile} />
        <Button label="Trails" onPress={() => setMenu(true)} />
      </View>

      <CardPreview
        card={card}
        onClose={() => setCard(null)}
        onOpenUrl={(url) => {
          setCard(null);
          onOpenUrl(url);
        }}
      />
      <TrailsMenu
        visible={menu}
        onClose={() => setMenu(false)}
        list={list}
        shownId={id}
        current={research.current}
        onPick={(tid) => {
          setMenu(false);
          show(tid);
        }}
        onNew={() => {
          setMenu(false);
          research.create();
          controller.adoptSession();
          setShownId(research.current.id);
          bump();
        }}
        onRename={(name) => {
          if (readonly) return;
          research.rename(name);
          research.saveNow();
          bump();
        }}
        readonly={readonly}
        onOpenFile={openFile}
      />
      <ShareTrailSheet
        visible={sharing}
        onClose={() => setSharing(false)}
        store={store}
        trailId={id}
        displayName={displayName}
        onDisplayName={(n) => {
          setDisplayName(n);
          writeProfile(services.storage, { displayName: n });
        }}
      />
    </View>
  );
}

function TrailsMenu({ visible, onClose, list, shownId, current, onPick, onNew, onRename, readonly, onOpenFile }) {
  if (!visible) return null;
  const shown = list.find((t) => t.id === shownId);
  return (
    <Sheet visible onClose={onClose} title="Trails">
      {!readonly && shown ? (
        <TextInput key={shown.id + shown.name} style={ui.input} defaultValue={shown.name} onEndEditing={(e) => onRename(e.nativeEvent.text)} accessibilityLabel="Trail name" />
      ) : null}
      <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
        <Button label="New trail" small onPress={onNew} />
        <Button label="Open file" small onPress={onOpenFile} />
      </View>
      <Text style={ui.kicker}>Most recent first</Text>
      {list.map((t) => (
        <Pressable key={t.id} onPress={() => onPick(t.id)} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderTopWidth: 1, borderColor: colors.line }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: t.readonly ? "#2a3a2a" : "#2a3350", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: colors.text, fontSize: 11, fontWeight: "700" }}>{t.mono}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.id === shownId ? colors.accent : colors.text, fontWeight: "600" }} numberOfLines={1}>
              {t.name}
            </Text>
            <Text style={ui.help} numberOfLines={1}>
              {t.readonly ? `From ${t.from || "someone"} · read only · ` : ""}
              {t.cards} {t.cards === 1 ? "card" : "cards"} · {t.pages} {t.pages === 1 ? "page" : "pages"} · {M.ago(t.lastAt)}
              {t.id === current.id ? " · recording" : ""}
            </Text>
          </View>
        </Pressable>
      ))}
    </Sheet>
  );
}

function readProfile(storage) {
  try {
    return JSON.parse(storage.read("profile.json") || "{}");
  } catch {
    return {};
  }
}
function writeProfile(storage, patch) {
  storage.write("profile.json", JSON.stringify({ ...readProfile(storage), ...patch }));
}
