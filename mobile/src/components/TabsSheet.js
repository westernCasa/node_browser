// Tab switcher: list of open tabs, close, new tab, Mosaic on tablets.
import { Pressable, Text, View } from "react-native";
import { colors, ui } from "../theme";
import Button from "./Button";
import Sheet from "./Sheet";

export default function TabsSheet({ visible, onClose, tabs, activeId, onActivate, onCloseTab, onNewTab, mosaic, onToggleMosaic, canMosaic }) {
  return (
    <Sheet visible={visible} onClose={onClose} title={`${tabs.length} tabs`} kicker="Tabs">
      <View style={{ flexDirection: "row", gap: 6, marginBottom: 10 }}>
        <Button label="New tab" onPress={onNewTab} small />
        {canMosaic ? <Button label={mosaic ? "Mosaic on" : "Mosaic"} active={mosaic} onPress={onToggleMosaic} small /> : null}
      </View>
      {!canMosaic ? <Text style={[ui.help, { marginBottom: 8 }]}>Mosaic (several tabs on screen) needs a tablet-sized screen.</Text> : null}
      {tabs.map((t) => (
        <Pressable
          key={t.id}
          onPress={() => onActivate(t.id)}
          style={{ flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderColor: colors.line, paddingVertical: 10 }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.id === activeId ? colors.accent : colors.text, fontWeight: "600" }} numberOfLines={1}>
              {t.title || "New tab"}
            </Text>
            <Text style={ui.help} numberOfLines={1}>{t.url}</Text>
          </View>
          <Pressable onPress={() => onCloseTab(t.id)} hitSlop={10} style={{ paddingHorizontal: 8 }}>
            <Text style={{ color: colors.mute, fontSize: 18 }}>×</Text>
          </Pressable>
        </Pressable>
      ))}
    </Sheet>
  );
}
