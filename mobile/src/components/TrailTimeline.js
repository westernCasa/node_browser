// CM1: the trail as a list, sessions newest first, with card previews.
import { FlatList, Image, Pressable, Text, View } from "react-native";
import { colors, ui } from "../theme";

const M = require("../trailModel");

export default function TrailTimeline({ snap, header, onItem }) {
  const rows = M.timelineRows(snap);
  // One flat list: a session label, then its items.
  const data = rows.flatMap((s) => [{ key: `h:${s.id}`, head: s.label }, ...s.items.map((it) => ({ ...it, key: `${s.id}:${it.key}` }))]);
  return (
    <FlatList
      data={data}
      keyExtractor={(x) => x.key}
      ListHeaderComponent={header}
      contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 24 }}
      ListEmptyComponent={
        <View style={{ paddingVertical: 40 }}>
          <Text style={[ui.title, { textAlign: "center" }]}>What are you looking into?</Text>
          <Text style={[ui.help, { textAlign: "center", marginTop: 6 }]}>Search above. Pages you read land here, newest first.</Text>
        </View>
      }
      renderItem={({ item }) => {
        if (item.head) return <Text style={ui.kicker} accessibilityRole="header">{item.head}</Text>;
        const face = item.card ? M.cardFace(item.card) : null;
        return (
          <Pressable
            onPress={() => onItem(item)}
            accessibilityRole="button"
            accessibilityLabel={[item.time, face ? `${face.kicker}: ${face.title}` : item.title, face?.text || item.sub].filter(Boolean).join(". ")}
            accessibilityHint={item.card ? "Opens the card's preview" : "Opens the page"}
            style={({ pressed }) => ({ flexDirection: "row", gap: 10, paddingVertical: 10, borderTopWidth: 1, borderColor: colors.line, opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={[ui.help, { width: 42 }]}>{item.time}</Text>
            <View style={{ flex: 1 }}>
              {face ? (
                // A card preview: the same face as on the canvas.
                <View style={{ flexDirection: "row", gap: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg3, borderRadius: 8, padding: 10 }}>
                  {item.card.shot && /^file:/.test(item.card.shot) ? <Image source={{ uri: item.card.shot }} style={{ width: 48, height: 64, borderRadius: 4 }} /> : null}
                  <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.accent, fontSize: 10, letterSpacing: 1, textTransform: "uppercase" }} numberOfLines={1}>
                    {face.kicker}
                  </Text>
                  <Text style={{ color: colors.text, fontWeight: "600", marginTop: 3 }} numberOfLines={2}>
                    {face.title}
                  </Text>
                  {face.text ? (
                    <Text style={[ui.help, { marginTop: 3 }]} numberOfLines={2}>
                      {face.text}
                    </Text>
                  ) : null}
                  </View>
                </View>
              ) : (
                <>
                  <Text style={{ color: colors.text }} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={ui.help} numberOfLines={1}>
                    {item.sub}
                  </Text>
                </>
              )}
            </View>
          </Pressable>
        );
      }}
    />
  );
}
