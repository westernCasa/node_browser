import { Pressable, Text } from "react-native";
import { colors, ui } from "../theme";

export default function Button({ label, onPress, onLongPress, active, style, small }) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [ui.button, small && { paddingVertical: 4, paddingHorizontal: 8 }, active && { borderColor: colors.accent }, pressed && { opacity: 0.6 }, style]}
    >
      <Text style={[ui.buttonText, active && { color: colors.accent }, small && { fontSize: 12 }]}>{label}</Text>
    </Pressable>
  );
}
