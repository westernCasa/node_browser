// The phone canvas with desktop's tools (Sven, 2026-11-15: full desktop
// tools on the phone). Tools: Select, Link, Group, Note, Question.
//   Select: tap a card for its preview and actions (link, remove, edit a
//     note, reply to or resolve a question, change or remove links); tap a
//     group's name to rename or resolve it. Press and hold a card or a
//     group's name, then drag, to move it.
//   Link: tap one card, then another; then pick a label.
//   Group: tap the cards to group, then "Group n cards" and name it.
//   Note, Question: tap the canvas where it goes, then type.
// Every change shows a note with Undo. Opened files stay read only.
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { colors, ui } from "../theme";
import Button from "./Button";
import CardPreview from "./CardPreview";
import Sheet from "./Sheet";
import TrailCanvas from "./TrailCanvas";

const M = require("../trailModel");

const TOOLS = [
  ["select", "Select", "Tap a card to open it. Press and hold, then drag, to move"],
  ["link", "Link", "Tap a card, then the card to link it to"],
  ["group", "Group", "Tap the cards to put in a group"],
  ["note", "Note", "Tap the canvas where the note goes"],
  ["question", "Question", "Tap the canvas where the question goes"],
];

export default function CanvasEditor({ snap, editor, onChanged, onOpenUrl }) {
  const [tool, setTool] = useState("select");
  const [pickA, setPickA] = useState(null); // Link: the first card
  const [picked, setPicked] = useState(() => new Set()); // Group: chosen cards
  const [card, setCard] = useState(null); // the card whose preview is open
  const [group, setGroup] = useState(null); // the group whose sheet is open
  const [prompt, setPrompt] = useState(null); // { kind, title, initial, placeholder, run(text) }
  const [labelFor, setLabelFor] = useState(null); // a line id: pick its label
  const [undo, setUndo] = useState(null); // { text, fn }
  const undoTimer = useRef(null);

  useEffect(() => () => clearTimeout(undoTimer.current), []);
  useEffect(() => {
    // A new trail: back to Select, nothing chosen.
    setTool("select");
    setPickA(null);
    setPicked(new Set());
  }, [snap?.trail?.id]);

  // Run an editor action: show its note with Undo, redraw.
  const run = (out) => {
    if (!out) return null;
    clearTimeout(undoTimer.current);
    setUndo({ text: out.text, fn: out.undo });
    undoTimer.current = setTimeout(() => setUndo(null), 6000);
    onChanged();
    return out.result;
  };
  const doUndo = () => {
    if (!undo?.fn) return;
    undo.fn();
    clearTimeout(undoTimer.current);
    setUndo({ text: "Undone.", fn: null });
    undoTimer.current = setTimeout(() => setUndo(null), 2500);
    onChanged();
  };

  const live = (id) => snap.cards.find((c) => c.id === id);
  const title = (id) => (live(id) ? M.cardFace(live(id)).title : "a card");

  const onCard = (c) => {
    if (tool === "link") {
      if (!pickA) return setPickA(c.id);
      if (pickA === c.id) return setPickA(null);
      const line = run(editor.link(pickA, c.id, ""));
      setPickA(null);
      if (line) setLabelFor(line.id);
      return;
    }
    if (tool === "group") {
      const next = new Set(picked);
      next.has(c.id) ? next.delete(c.id) : next.add(c.id);
      return setPicked(next);
    }
    setCard(c);
  };

  const onEmptyTap = (x, y) => {
    if (tool === "note")
      setPrompt({ title: "New note", placeholder: "Write a note", run: (t) => run(editor.note(x - 130, y - 70, t)) });
    else if (tool === "question")
      setPrompt({ title: "New question", placeholder: "What do you want to find out?", run: (t) => run(editor.question(x - 130, y - 70, t)) });
    else if (tool === "link") setPickA(null);
  };

  const pickTool = (id) => {
    setTool(id);
    setPickA(null);
    setPicked(new Set());
  };

  const hint = tool === "link" && pickA ? `Now tap the card to link “${title(pickA)}” to` : TOOLS.find((t) => t[0] === tool)[2];
  const cardLines = card ? snap.lines.filter((l) => l.kind !== "suggested" && (l.from === card.id || l.to === card.id)) : [];

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 10, paddingBottom: 6 }} accessibilityRole="tablist">
        {TOOLS.map(([id, label]) => (
          <Button key={id} label={label} small active={tool === id} a11yHint={TOOLS.find((t) => t[0] === id)[2]} onPress={() => pickTool(id)} />
        ))}
      </View>
      <Text style={[ui.help, { paddingHorizontal: 12, paddingBottom: 4 }]} accessibilityLiveRegion="polite">
        {hint}
      </Text>
      <View style={{ flex: 1 }}>
        <TrailCanvas
          snap={snap}
          editable
          selected={tool === "group" ? picked : pickA ? new Set([pickA]) : null}
          onCard={onCard}
          onEmptyTap={onEmptyTap}
          onMoveCard={(id, x, y) => run(editor.moveCard(id, x, y))}
          onMoveGroup={(id, x, y) => run(editor.moveGroup(id, x, y))}
          onGroupTap={(g) => tool === "select" && setGroup(g)}
        />
        {tool === "group" && picked.size ? (
          <View style={{ position: "absolute", left: 10, right: 10, top: 10, flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: colors.bg3, borderRadius: 10, borderWidth: 1, borderColor: colors.line, padding: 8 }}>
            <Text style={{ color: colors.text, flex: 1 }}>{picked.size} chosen</Text>
            <Button label="Cancel" small onPress={() => setPicked(new Set())} />
            <Button
              label={`Group ${picked.size} ${picked.size === 1 ? "card" : "cards"}`}
              small
              active
              onPress={() =>
                setPrompt({
                  title: "Name the group",
                  initial: "New group",
                  placeholder: "Group name",
                  run: (t) => {
                    const g = run(editor.group([...picked], t));
                    if (g) setPicked(new Set());
                    return g;
                  },
                })
              }
            />
          </View>
        ) : null}
        {undo ? (
          <View accessibilityLiveRegion="polite" style={{ position: "absolute", left: 10, right: 140, bottom: 54, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.bg3, borderRadius: 10, borderWidth: 1, borderColor: colors.line, padding: 8 }}>
            <Text style={{ color: colors.text, flex: 1 }} numberOfLines={1}>
              {undo.text}
            </Text>
            {undo.fn ? <Button label="Undo" small onPress={doUndo} /> : null}
          </View>
        ) : null}
      </View>

      <CardPreview
        card={card}
        onClose={() => setCard(null)}
        onOpenUrl={(url) => {
          setCard(null);
          onOpenUrl(url);
        }}
        extra={
          card ? (
            <View>
              <Text style={ui.kicker} accessibilityRole="header">
                On the canvas
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                <Button
                  label="Link to…"
                  onPress={() => {
                    setTool("link");
                    setPickA(card.id);
                    setCard(null);
                  }}
                />
                {card.kind === "note" ? (
                  <Button label="Edit note" onPress={() => setPrompt({ title: "Edit note", initial: card.text, run: (t) => run(editor.editNote(card.id, t)) })} />
                ) : null}
                {card.kind === "question" ? (
                  <>
                    <Button label="Reply" onPress={() => setPrompt({ title: "Reply", placeholder: "What did you find?", run: (t) => run(editor.reply(card.id, t)) })} />
                    {card.status === "resolved" ? (
                      <Button label="Reopen" onPress={() => run(editor.resolveQuestion(card.id, false))} />
                    ) : (
                      <Button label="Resolve…" onPress={() => setPrompt({ title: "Resolve", placeholder: "What's the answer? (optional)", optional: true, run: (t) => run(editor.resolveQuestion(card.id, true, t)) })} />
                    )}
                  </>
                ) : null}
                <Button
                  label="Remove from canvas"
                  onPress={() => {
                    run(editor.remove(card.id));
                    setCard(null);
                  }}
                />
              </View>
              {cardLines.length ? (
                <>
                  <Text style={ui.kicker} accessibilityRole="header">
                    Links
                  </Text>
                  {cardLines.map((l) => {
                    const other = l.from === card.id ? l.to : l.from;
                    return (
                      <View key={l.id} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, borderTopWidth: 1, borderColor: colors.line }}>
                        <Text style={{ color: colors.text, flex: 1 }} numberOfLines={2}>
                          {l.from === card.id ? "→ " : "← "}
                          {title(other)}
                          {l.label ? ` · ${l.label}` : ""}
                          {l.kind === "nav" ? " · opened from" : l.kind === "auto" ? ` · ${l.label || "added by NODE"}` : ""}
                        </Text>
                        {l.kind === "you" ? <Button label="Label" small onPress={() => setLabelFor(l.id)} /> : null}
                        <Button label="Unlink" small a11yLabel={`Remove the link to ${title(other)}`} onPress={() => run(editor.unlink(l.id))} />
                      </View>
                    );
                  })}
                </>
              ) : null}
            </View>
          ) : null
        }
      />

      {group ? (
        <Sheet visible onClose={() => setGroup(null)} title={group.label || "New group"} kicker="Group">
          <Text style={ui.help}>To move the group and its cards, press and hold its name on the canvas, then drag.</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            <Button
              label="Rename"
              onPress={() => {
                const g = group;
                setGroup(null);
                setPrompt({ title: "Rename group", initial: g.label, run: (t) => run(editor.renameGroup(g.id, t)) });
              }}
            />
            <Button
              label={group.resolved ? "Reopen" : "Mark resolved"}
              onPress={() => {
                run(editor.resolveGroup(group.id, !group.resolved));
                setGroup(null);
              }}
            />
          </View>
        </Sheet>
      ) : null}

      {labelFor ? (
        <Sheet visible onClose={() => setLabelFor(null)} title="Label this link" kicker="Link">
          <View accessibilityRole="radiogroup">
            {editor.LABELS.map((l) => (
              <Pressable
                key={l.id || "none"}
                accessibilityRole="radio"
                onPress={() => {
                  run(editor.labelLine(labelFor, l.id));
                  setLabelFor(null);
                }}
                style={{ paddingVertical: 11, borderTopWidth: 1, borderColor: colors.line }}
              >
                <Text style={{ color: colors.text }}>{l.label}</Text>
              </Pressable>
            ))}
          </View>
        </Sheet>
      ) : null}

      <PromptSheet prompt={prompt} onClose={() => setPrompt(null)} />
    </View>
  );
}

// One text field with Save, for notes, questions, names, replies.
function PromptSheet({ prompt, onClose }) {
  const [text, setText] = useState("");
  useEffect(() => setText(prompt?.initial || ""), [prompt]);
  if (!prompt) return null;
  const save = () => {
    if (!text.trim() && !prompt.optional) return;
    prompt.run(text.trim());
    onClose();
  };
  return (
    <Sheet visible onClose={onClose} title={prompt.title}>
      <TextInput
        style={[ui.input, { minHeight: 64, textAlignVertical: "top" }]}
        value={text}
        onChangeText={setText}
        placeholder={prompt.placeholder || ""}
        placeholderTextColor={colors.mute}
        multiline
        autoFocus
        accessibilityLabel={prompt.title}
      />
      <View style={{ flexDirection: "row", gap: 6, marginTop: 10 }}>
        <Button label="Save" active onPress={save} />
        <Button label="Cancel" onPress={onClose} />
      </View>
    </Sheet>
  );
}
