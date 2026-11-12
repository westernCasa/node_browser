// Choose how Mosaic arranges tiles. Each choice shows a small picture of the
// layout with 4 tiles (the active tile highlighted). Used in the Mosaic
// layout sheet (press and hold Mosaic) and in Settings.
import { Pressable, Text, View } from "react-native";
import { colors, ui } from "../theme";
import Sheet from "./Sheet";

const { LAYOUTS, layoutRects } = require("../mosaicLayout");

function Preview({ id, wide }) {
  const rects = layoutRects(id, 4, { active: 0, wide });
  return (
    <View style={{ width: 40, height: 56, borderRadius: 4, borderWidth: 1, borderColor: colors.line, overflow: "hidden" }}>
      {rects.map((r, i) => (
        <View
          key={i}
          style={{ position: "absolute", left: `${r.left}%`, top: `${r.top}%`, width: `${r.width}%`, height: `${r.height}%`, padding: 1.5 }}
        >
          <View style={{ flex: 1, borderRadius: 2, backgroundColor: i === 0 ? colors.accent : colors.bg3 }} />
        </View>
      ))}
    </View>
  );
}

export function MosaicLayoutList({ value, onChange, wide }) {
  return (
    <View accessibilityRole="radiogroup">
      {LAYOUTS.map((l) => {
        const on = l.id === value;
        return (
          <Pressable
            key={l.id}
            onPress={() => onChange(l.id)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${l.label}. ${l.help}`}
            style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, borderTopWidth: 1, borderColor: colors.line }}
          >
            <Preview id={l.id} wide={wide} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: on ? colors.accent : colors.text, fontWeight: "600" }}>
                {l.label}
                {on ? "  ✓" : ""}
              </Text>
              <Text style={ui.help}>{l.help}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function MosaicLayoutSheet({ visible, onClose, value, onChange, wide }) {
  if (!visible) return null;
  return (
    <Sheet visible onClose={onClose} title="Mosaic layout" kicker="Mosaic">
      <Text style={ui.help}>Up to 4 tiles on a phone held upright. The highlighted tile is the active tab, the only one with sound.</Text>
      <MosaicLayoutList
        value={value}
        wide={wide}
        onChange={(id) => {
          onChange(id);
          onClose();
        }}
      />
    </Sheet>
  );
}
