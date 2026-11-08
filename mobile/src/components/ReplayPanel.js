// CM3: an opened .trail.md on a phone. The sender's note, Start here and the
// Replay steps, with Save as new trail and Open on desktop. The file is read
// only.
import { FlatList, Pressable, Text, View } from "react-native";
import { colors, ui } from "../theme";
import Button from "./Button";

const M = require("../trailModel");

export default function ReplayPanel({ snap, steps, step, onStep, onStartHere, onSaveAsNew, onOpenOnDesktop }) {
  const t = snap.trail;
  const start = t.startHere && snap.cards.find((c) => c.id === t.startHere);
  const cur = steps[step];
  const head = (
    <View>
      <Text style={[ui.help, { marginTop: 10 }]}>
        From {t.from || "someone"} · read only
      </Text>
      {t.note ? <Text style={{ color: colors.text, fontSize: 15, lineHeight: 22, marginTop: 6 }}>{t.note}</Text> : null}
      {start ? (
        <Pressable onPress={() => onStartHere(start)} style={{ marginTop: 10, borderWidth: 1, borderColor: colors.ok, borderRadius: 8, padding: 10 }}>
          <Text style={{ color: colors.ok, fontSize: 10, letterSpacing: 1, textTransform: "uppercase" }}>Start here</Text>
          <Text style={{ color: colors.text, fontWeight: "600", marginTop: 2 }}>{M.cardFace(start).title}</Text>
        </Pressable>
      ) : null}
      <View style={{ flexDirection: "row", gap: 6, marginTop: 10 }}>
        <Button label="Save as new trail" onPress={onSaveAsNew} />
        <Button label="Open on desktop" onPress={onOpenOnDesktop} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
        <Text style={[ui.kicker, { flex: 1 }]}>
          Replay {steps.length ? `· step ${step + 1} of ${steps.length}` : ""}
        </Text>
        <Button label="‹ Back" small onPress={() => onStep(Math.max(0, step - 1))} style={step === 0 && { opacity: 0.4 }} />
        <Button label="Next ›" small onPress={() => onStep(Math.min(steps.length - 1, step + 1))} style={step >= steps.length - 1 && { opacity: 0.4 }} />
      </View>
      {cur ? <Text style={{ color: colors.text, marginBottom: 8 }}>{cur.caption}</Text> : null}
    </View>
  );
  return (
    <FlatList
      data={steps}
      keyExtractor={(s) => String(s.n)}
      ListHeaderComponent={head}
      contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 24 }}
      ListEmptyComponent={<Text style={ui.help}>This file has no timeline, so there is nothing to replay. The canvas shows its cards.</Text>}
      renderItem={({ item, index }) => (
        <Pressable
          onPress={() => onStep(index)}
          style={{ flexDirection: "row", gap: 10, paddingVertical: 8, borderTopWidth: 1, borderColor: colors.line, opacity: index > step ? 0.5 : 1 }}
        >
          <Text style={{ width: 24, color: index === step ? colors.accent : colors.mute, fontWeight: index === step ? "700" : "400" }}>{index + 1}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: index === step ? colors.text : colors.text, fontWeight: index === step ? "600" : "400" }} numberOfLines={3}>
              {item.caption}
            </Text>
            <Text style={ui.help}>
              {M.hhmm(item.at)} · {item.device === "phone" ? "Phone" : "Desktop"}
            </Text>
          </View>
        </Pressable>
      )}
    />
  );
}
