// Colours and shared styles (same palette as the desktop app).
import { StyleSheet } from "react-native";

export const colors = {
  bg: "#121212",
  bg2: "#1a1a1a",
  bg3: "#242424",
  line: "#2e2e2e",
  text: "#ececec",
  mute: "#8a8a8a",
  accent: "#7aa2ff",
  bad: "#ff8a80",
  ok: "#7bd88f",
};

// Smallest tap area, in points (Apple HIG 44 pt; Android 48 dp is close).
export const TAP = 44;

export const ui = StyleSheet.create({
  // Chips are 36 pt and get hitSlop 4 where they are tappable (44 pt).
  chip: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg3, borderRadius: 999, paddingHorizontal: 12, minHeight: 36, justifyContent: "center", marginRight: 8, marginBottom: 8 },
  chipText: { color: colors.text, fontSize: 13 },
  button: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg3, borderRadius: 8, paddingHorizontal: 12, minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  buttonSmall: { paddingHorizontal: 10, minHeight: 36, minWidth: 36 },
  buttonText: { color: colors.text, fontSize: 13 },
  input: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg, color: colors.text, borderRadius: 8, paddingHorizontal: 12, minHeight: 44, fontSize: 15 },
  kicker: { color: colors.accent, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", marginTop: 14, marginBottom: 6 },
  help: { color: colors.mute, fontSize: 12, lineHeight: 17 },
  title: { color: colors.text, fontSize: 17, fontWeight: "600" },
});
