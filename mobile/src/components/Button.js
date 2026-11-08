import { Pressable, Text } from "react-native";
import { colors, ui } from "../theme";

// a11yLabel: what a screen reader says when the label is a symbol (‹, ⚙︎, +).
export default function Button({ label, onPress, onLongPress, active, style, small, a11yLabel, a11yHint }) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel || String(label)}
      accessibilityHint={a11yHint}
      accessibilityState={active !== undefined ? { selected: Boolean(active) } : undefined}
      style={({ pressed }) => [ui.button, small && { paddingVertical: 4, paddingHorizontal: 8 }, active && { borderColor: colors.accent }, pressed && { opacity: 0.6 }, style]}
    >
      <Text style={[ui.buttonText, active && { color: colors.accent }, small && { fontSize: 12 }]}>{label}</Text>
    </Pressable>
  );
}
