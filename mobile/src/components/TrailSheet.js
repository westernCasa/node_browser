// Research session: name, recurring keywords, pages read, new session, export.
import { Pressable, Share, Text, TextInput, View } from "react-native";
import { colors, ui } from "../theme";
import Button from "./Button";
import Sheet from "./Sheet";

const { hostOf } = require("../../../core/urls");

export default function TrailSheet({ visible, onClose, research, controller, onOpenUrl, version, bump }) {
  if (!visible) return null;
  const s = research.current;
  const threads = research.threads();
  return (
    <Sheet visible={visible} onClose={onClose} title="Trail" kicker="Research session">
      <TextInput
        key={s.id + version}
        style={ui.input}
        defaultValue={s.name}
        onEndEditing={(e) => {
          research.rename(e.nativeEvent.text);
          bump();
        }}
      />
      <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
        <Button
          label="New session"
          small
          onPress={() => {
            research.create();
            controller.adoptSession();
            bump();
          }}
        />
        <Button label="Export" small onPress={() => Share.share({ title: s.name, message: research.markdown() })} />
      </View>
      <Text style={[ui.help, { marginTop: 8 }]}>
        {s.trail.length} pages read · {s.opened.length} suggestions opened · {s.dismissed.length} hidden
      </Text>
      <Text style={ui.kicker}>Recurring keywords</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {threads.length ? (
          threads.map((t) => (
            <Pressable key={t.term} style={ui.chip} onPress={() => controller.togglePin(t.term)}>
              <Text style={ui.chipText}>
                {t.term} · {t.pages}
              </Text>
            </Pressable>
          ))
        ) : (
          <Text style={ui.help}>Keywords that show up on more than one page appear here.</Text>
        )}
      </View>
      <Text style={ui.kicker}>Pages read</Text>
      {[...s.trail].reverse().map((r) => (
        <Pressable key={r.url} onPress={() => onOpenUrl(r.url)} style={{ borderTopWidth: 1, borderColor: colors.line, paddingVertical: 8 }}>
          <Text style={{ color: colors.text, fontWeight: "600" }}>{r.title}</Text>
          <Text style={ui.help}>
            {hostOf(r.url)} · {r.keywords.join(", ")}
          </Text>
        </Pressable>
      ))}
    </Sheet>
  );
}
