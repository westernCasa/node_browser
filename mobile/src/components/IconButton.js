// A 44 × 44 pt icon button for the browser bars, with an optional small badge
// (a count) and a spoken label.
import { Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, TAP } from "../theme";

export default function IconButton({ icon, label, onPress, onLongPress, active, disabled, badge, text, a11yHint }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onLongPress={disabled ? undefined : onLongPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={a11yHint}
      accessibilityState={{ disabled: Boolean(disabled), ...(active !== undefined ? { selected: Boolean(active) } : {}) }}
      style={({ pressed }) => ({ width: TAP, height: TAP, alignItems: "center", justifyContent: "center", borderRadius: TAP / 2, opacity: disabled ? 0.35 : pressed ? 0.55 : 1, backgroundColor: active ? "rgba(122,162,255,0.14)" : "transparent" })}
    >
      {text !== undefined ? (
        // The tab count, in a rounded square like other browsers.
        <View style={{ minWidth: 22, height: 22, borderRadius: 5, borderWidth: 1.6, borderColor: active ? colors.accent : colors.text, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 }}>
          <Text style={{ color: active ? colors.accent : colors.text, fontSize: 12, fontWeight: "700" }}>{text}</Text>
        </View>
      ) : (
        <Ionicons name={icon} size={23} color={active ? colors.accent : colors.text} />
      )}
      {badge ? (
        <View style={{ position: "absolute", top: 5, right: 4, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 }}>
          <Text style={{ color: colors.bg, fontSize: 10, fontWeight: "700" }}>{badge > 99 ? "99+" : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
