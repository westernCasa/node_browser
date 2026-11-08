// A card's full preview (from the canvas, the timeline or Replay).
import { Text, View } from "react-native";
import { colors, ui } from "../theme";
import Button from "./Button";
import Sheet from "./Sheet";

const M = require("../trailModel");

export default function CardPreview({ card, onClose, onOpenUrl }) {
  if (!card) return null;
  const f = M.cardFace(card);
  const replies = [];
  const walk = (l, depth) => (l || []).forEach((r) => (replies.push({ ...r, depth }), walk(r.replies, depth + 1)));
  walk(card.replies, 0);
  return (
    <Sheet visible onClose={onClose} title={f.title} kicker={f.kicker}>
      {f.text ? <Text style={{ color: colors.text, fontSize: 15, lineHeight: 22 }}>{f.text}</Text> : null}
      {card.kind === "report" && card.text && card.text !== f.text ? <Text style={{ color: colors.text, marginTop: 8, lineHeight: 21 }}>{card.text}</Text> : null}
      {card.keywords?.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 10 }}>
          {card.keywords.map((k) => (
            <View key={k} style={ui.chip}>
              <Text style={ui.chipText}>{k}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {replies.length ? (
        <>
          <Text style={ui.kicker}>Replies</Text>
          {replies.map((r, i) => (
            <View key={r.id || i} style={{ marginLeft: r.depth * 12, borderLeftWidth: 2, borderColor: colors.line, paddingLeft: 8, marginBottom: 8 }}>
              <Text style={ui.help}>{r.by || "Someone"}</Text>
              <Text style={{ color: colors.text }}>{r.text}</Text>
            </View>
          ))}
        </>
      ) : null}
      {card.url ? (
        <>
          <Text style={[ui.help, { marginTop: 12 }]} numberOfLines={2}>
            {card.url}
          </Text>
          <View style={{ flexDirection: "row", marginTop: 10 }}>
            <Button label="Open page" onPress={() => onOpenUrl(card.url)} />
          </View>
        </>
      ) : null}
    </Sheet>
  );
}
