import { Pressable, Text } from "react-native";
import { colors, ui, TAP } from "../theme";

// Every button can be tapped in a 44 × 44 pt area at least (Apple's minimum,
// Sven 2026-11-17). Small buttons look 36 pt tall and reach 44 pt through
// hitSlop, so rows of them stay compact.
// a11yLabel: what a screen reader says when the label is a symbol (‹, ⚙︎, +).
export default function Button({ label, onPress, onLongPress, active, style, small, a11yLabel, a11yHint }) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      hitSlop={small ? (TAP - 36) / 2 : 0}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel || String(label)}
      accessibilityHint={a11yHint}
      accessibilityState={active !== undefined ? { selected: Boolean(active) } : undefined}
      style={({ pressed }) => [ui.button, small && ui.buttonSmall, active && { borderColor: colors.accent }, pressed && { opacity: 0.6 }, style]}
    >
      <Text style={[ui.buttonText, active && { color: colors.accent }, small && { fontSize: 13 }]}>{label}</Text>
    </Pressable>
  );
}
