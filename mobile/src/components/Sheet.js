// Bottom sheet used for Suggestions, Tabs, Trail and Settings.
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { colors, ui } from "../theme";
import Button from "./Button";

export default function Sheet({ visible, title, kicker, onClose, children, scroll = true }) {
  const Body = scroll ? ScrollView : View;
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }} onPress={onClose} />
      <View style={{ maxHeight: "82%", backgroundColor: colors.bg2, borderTopLeftRadius: 14, borderTopRightRadius: 14, borderTopWidth: 1, borderColor: colors.line }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, paddingBottom: 6 }}>
          <View>
            {kicker ? <Text style={[ui.kicker, { marginTop: 0 }]}>{kicker}</Text> : null}
            <Text style={ui.title}>{title}</Text>
          </View>
          <Button label="Close" onPress={onClose} small />
        </View>
        <Body style={{ paddingHorizontal: 14 }} contentContainerStyle={{ paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
          {children}
        </Body>
      </View>
    </Modal>
  );
}
