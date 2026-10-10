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

export const ui = StyleSheet.create({
  chip: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg3, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, marginRight: 6, marginBottom: 6 },
  chipText: { color: colors.text, fontSize: 13 },
  button: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg3, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 7 },
  buttonText: { color: colors.text, fontSize: 13 },
  input: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg, color: colors.text, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  kicker: { color: colors.accent, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", marginTop: 14, marginBottom: 6 },
  help: { color: colors.mute, fontSize: 12, lineHeight: 17 },
  title: { color: colors.text, fontSize: 17, fontWeight: "600" },
});
