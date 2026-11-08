// A card's full preview (from the canvas, the timeline or Replay).
import { Image, Text, View } from "react-native";
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
      {card.shot && /^file:/.test(card.shot) ? (
        <Image source={{ uri: card.shot }} resizeMode="cover" style={{ width: "100%", aspectRatio: 3 / 4, maxHeight: 360, borderRadius: 8, marginBottom: 10, backgroundColor: colors.bg3 }} accessibilityLabel="Thumbnail of the page when it was captured" />
      ) : null}
      {f.text ? <Text style={{ color: colors.text, fontSize: 15, lineHeight: 22 }}>{f.text}</Text> : null}
      {card.kind === "capture" && card.fromText ? <Text style={[ui.help, { marginTop: 6 }]}>{card.fromText}{card.tz ? ` (${card.tz})` : ""}</Text> : null}
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
            {card.doi ? <Button label="Open DOI" onPress={() => onOpenUrl(`https://doi.org/${card.doi}`)} style={{ marginLeft: 6 }} /> : null}
            {card.pmid ? <Button label="PubMed" onPress={() => onOpenUrl(`https://pubmed.ncbi.nlm.nih.gov/${card.pmid}/`)} style={{ marginLeft: 6 }} /> : null}
          </View>
        </>
      ) : null}
    </Sheet>
  );
}
