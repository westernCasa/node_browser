// CM4: what goes in the file (a note, Start here, the timeline), then CM5:
// "Share file…" hands the .trail.md to the phone's own share sheet (AirDrop,
// Messages, Mail, Save to Files).
import { useMemo, useState } from "react";
import { Platform, Pressable, Switch, Text, TextInput, View } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { colors, ui } from "../theme";
import Button from "./Button";
import Sheet from "./Sheet";

const M = require("../trailModel");

// Writes the text to a file in the cache and opens the system share sheet.
export async function shareTrailFile(name, text) {
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing files is not available on this device.");
  const file = new File(Paths.cache, M.safeFileName(name));
  if (file.exists) file.delete();
  file.create();
  await file.write(text);
  // iOS reads the type from the .md ending; Android needs the MIME type.
  await Sharing.shareAsync(file.uri, Platform.OS === "android" ? { mimeType: "text/markdown", dialogTitle: "Share trail" } : { dialogTitle: "Share trail" });
}

export default function ShareTrailSheet({ visible, onClose, store, trailId, displayName, onDisplayName }) {
  if (!visible) return null;
  return <Body onClose={onClose} store={store} trailId={trailId} displayName={displayName} onDisplayName={onDisplayName} />;
}

function Body({ onClose, store, trailId, displayName, onDisplayName }) {
  const snap = useMemo(() => store.snapshot(trailId), [store, trailId]);
  const sum = useMemo(() => M.shareSummary(snap), [snap]);
  const [note, setNote] = useState(snap?.trail.note || "");
  const [startHere, setStartHere] = useState(snap?.trail.startHere || "");
  const [timeline, setTimeline] = useState(true);
  const [name, setName] = useState(displayName || "");
  const [picking, setPicking] = useState(false);
  const [status, setStatus] = useState("");
  const text = M.shareText(store, trailId, { by: name, note, startHere, timeline }) || "";
  const fileName = M.safeFileName(snap?.trail.name);
  const start = sum.startChoices.find((c) => c.id === startHere);

  const send = async () => {
    setStatus("");
    if (name !== displayName) onDisplayName(name);
    try {
      await shareTrailFile(snap.trail.name, text);
      setStatus(`Shared ${fileName}.`);
    } catch (err) {
      setStatus(String(err?.message || err));
    }
  };

  return (
    <Sheet visible onClose={onClose} title={snap?.trail.name || "Trail"} kicker="Share as a file">
      <Text style={ui.kicker}>Note to the reader</Text>
      <TextInput style={[ui.input, { minHeight: 64, textAlignVertical: "top" }]} multiline maxLength={M.NOTE_MAX} placeholder="What should they look at first?" placeholderTextColor={colors.mute} value={note} onChangeText={setNote} />
      <Text style={ui.kicker}>Start here</Text>
      <Pressable onPress={() => setPicking(!picking)} style={[ui.input, { paddingVertical: 10 }]}>
        <Text style={{ color: start ? colors.text : colors.mute }} numberOfLines={1}>
          {start ? start.title : sum.startChoices.length ? "No card chosen" : "No cards to start from"}
        </Text>
      </Pressable>
      {picking ? (
        <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 6, marginTop: 4 }}>
          {[{ id: "", title: "None" }, ...sum.startChoices].map((c) => (
            <Pressable
              key={c.id || "none"}
              onPress={() => {
                setStartHere(c.id);
                setPicking(false);
              }}
              style={{ padding: 10, borderTopWidth: c.id ? 1 : 0, borderColor: colors.line }}
            >
              <Text style={{ color: c.id === startHere ? colors.accent : colors.text }} numberOfLines={1}>
                {c.title}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Text style={ui.kicker}>In the file</Text>
      <Text style={ui.help}>
        {sum.cards} {sum.cards === 1 ? "card" : "cards"} · {sum.groups} {sum.groups === 1 ? "group" : "groups"} · {sum.links} {sum.links === 1 ? "link" : "links"}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
        <Text style={{ color: colors.text, flex: 1 }}>
          Timeline · {sum.timeline} {sum.timeline === 1 ? "page" : "pages"}
          {sum.timelineOnly ? `, ${sum.timelineOnly} timeline only` : ""}
        </Text>
        <Switch value={timeline} onValueChange={setTimeline} />
      </View>
      <Text style={[ui.help, { marginTop: 4 }]}>Sign-in and payment pages are never put in the file.</Text>
      <Text style={ui.kicker}>Your name</Text>
      <TextInput style={ui.input} placeholder="Shown to the reader" placeholderTextColor={colors.mute} value={name} onChangeText={setName} maxLength={60} />
      <Text style={[ui.help, { marginTop: 12 }]}>
        {fileName} · {M.sizeText(M.byteLength(text))}
      </Text>
      <View style={{ flexDirection: "row", marginTop: 10 }}>
        <Button label="Share file…" active onPress={send} />
      </View>
      {status ? <Text style={[ui.help, { marginTop: 8 }]}>{status}</Text> : null}
    </Sheet>
  );
}
