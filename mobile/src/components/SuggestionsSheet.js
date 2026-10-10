// Keywords (tap to pin, long-press to hide), status line and result cards.
import { useState } from "react";
import { Image, Pressable, Text, TextInput, View } from "react-native";
import { colors, ui } from "../theme";
import Button from "./Button";
import Sheet from "./Sheet";

const { hostOf } = require("../../../core/urls");

export default function SuggestionsSheet({ visible, onClose, state, controller, onOpen }) {
  const [draft, setDraft] = useState("");
  const pins = state.pinned;
  const auto = controller.autoTerms().slice(0, 8);
  return (
    <Sheet visible={visible} onClose={onClose} title="Suggestions" kicker="Next pages">
      <View style={{ flexDirection: "row", gap: 6, marginBottom: 8 }}>
        <Button label={state.autoOn ? "Auto" : "Auto off"} active={state.autoOn} onPress={() => controller.setAuto(!state.autoOn)} small />
        <Button label="Search now" onPress={() => controller.crawl()} small />
      </View>
      <Text style={ui.help}>Tap a keyword to pin it. Press and hold to hide it.</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 8 }}>
        {pins.map((k) => (
          <Pressable key={"p" + k} style={[ui.chip, { borderColor: colors.accent }]} onPress={() => controller.togglePin(k)}>
            <Text style={[ui.chipText, { color: colors.accent }]}>📌 {k}</Text>
          </Pressable>
        ))}
        {auto.map((k) => (
          <Pressable key={"a" + k} style={ui.chip} onPress={() => controller.togglePin(k)} onLongPress={() => controller.hide(k)}>
            <Text style={ui.chipText}>{k}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        style={[ui.input, { marginTop: 4 }]}
        placeholder="Add keyword (pinned)"
        placeholderTextColor={colors.mute}
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={() => {
          controller.addPin(draft);
          setDraft("");
        }}
        returnKeyType="search"
      />
      <Text style={[ui.help, { marginVertical: 10 }]}>{state.status}</Text>
      {state.results.map((r) => (
        <View key={r.url} style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 10, marginBottom: 8, backgroundColor: colors.bg }}>
          {r.image ? <Image source={{ uri: r.image }} style={{ height: 120, borderRadius: 6, marginBottom: 8, backgroundColor: colors.bg3 }} resizeMode="cover" /> : null}
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: colors.accent, fontSize: 10, textTransform: "uppercase" }}>
              {r.source}
              {r.query ? <Text style={{ color: colors.mute, textTransform: "none" }}> · {r.query}</Text> : null}
            </Text>
            <Pressable onPress={() => controller.dismiss(r.url)} hitSlop={10}>
              <Text style={{ color: colors.mute }}>×</Text>
            </Pressable>
          </View>
          <Text style={{ color: colors.text, fontWeight: "600", marginTop: 4 }}>{r.title}</Text>
          {r.snippet ? <Text style={[ui.help, { marginTop: 2 }]} numberOfLines={3}>{r.snippet}</Text> : null}
          <Text style={{ color: "#6a6a6a", fontSize: 11, marginTop: 4 }}>{hostOf(r.url)}</Text>
          <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
            <Button label="Open here" small onPress={() => onOpen(r, false)} />
            <Button label="New tab" small onPress={() => onOpen(r, true)} />
          </View>
        </View>
      ))}
    </Sheet>
  );
}
