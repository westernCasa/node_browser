// Tab switcher: list of open tabs, close, new tab, Mosaic.
import { Pressable, Text, View } from "react-native";
import { colors, ui } from "../theme";
import Button from "./Button";
import Sheet from "./Sheet";
import SwipeRow from "./SwipeRow";

export default function TabsSheet({ visible, onClose, tabs, activeId, onActivate, onCloseTab, onNewTab, mosaic, onToggleMosaic, canMosaic, canSoundAll, soundAll, onToggleSoundAll }) {
  return (
    <Sheet visible={visible} onClose={onClose} title={`${tabs.length} tabs`} kicker="Tabs">
      <View style={{ flexDirection: "row", gap: 6, marginBottom: 10 }}>
        <Button label="New tab" onPress={onNewTab} small />
        {canMosaic ? <Button label={mosaic ? "Mosaic on" : "Mosaic"} active={mosaic} onPress={onToggleMosaic} small /> : null}
        {canSoundAll ? <Button label={soundAll ? "Sound: all" : "Sound: one"} active={soundAll} onPress={onToggleSoundAll} small /> : null}
      </View>
      <Text style={[ui.help, { marginBottom: 8 }]}>Swipe a tab left to close it. Mosaic shows several tabs at once (up to 4 on a phone). Tap a tile to make it the active tab. Media plays in up to 4 tabs at once; opening a paused tab resumes it. Only the active tab plays sound{canSoundAll ? " unless Sound: all is on" : " (iPhone and iPad allow one video with sound at a time)"}.</Text>
      {tabs.map((t) => (
        <SwipeRow key={t.id} onSwipe={() => onCloseTab(t.id)}>
          <Pressable
            onPress={() => onActivate(t.id)}
            style={{ flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderColor: colors.line, paddingVertical: 10 }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.id === activeId ? colors.accent : colors.text, fontWeight: "600" }} numberOfLines={1}>
                {t.title || "New tab"}
              </Text>
              <Text style={ui.help} numberOfLines={1}>{t.pausedByLimit ? "⏸ Paused (4 tabs already playing) · " : ""}{t.sysPauses ? `Paused by the system ${t.sysPauses}× and restarted · ` : ""}{t.url}</Text>
            </View>
            <Pressable onPress={() => onCloseTab(t.id)} hitSlop={10} style={{ paddingHorizontal: 8 }}>
              <Text style={{ color: colors.mute, fontSize: 18 }}>×</Text>
            </Pressable>
          </Pressable>
        </SwipeRow>
      ))}
    </Sheet>
  );
}
