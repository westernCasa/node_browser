// Ask AI about the current page (shared core/chat.js). One conversation per
// page address; it starts over when the page changes.
import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { colors, ui } from "../theme";
import Button from "./Button";
import Sheet from "./Sheet";

const QUICK = [
  ["Summarize", "Summarize this page in 5 bullet points."],
  ["Key facts", "What are the key facts, names and dates on this page?"],
  ["What next?", "What questions does this page leave open, and what should I read next to answer them?"],
];

export default function AskSheet({ visible, onClose, tab, services, readPage }) {
  const [convo, setConvo] = useState({ url: "", messages: [] });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const ai = services.settings.ai;
  const ready = services.core.Chat.canChat(ai);

  useEffect(() => {
    if (visible && tab && tab.url !== convo.url) setConvo({ url: tab.url, messages: [] });
  }, [visible, tab?.url]);

  const send = async (question) => {
    const q = String(question || "").trim();
    if (!q || !tab || busy) return;
    const history = convo.messages.filter((m) => m.role !== "error");
    setConvo({ url: tab.url, messages: [...convo.messages, { role: "user", content: q }] });
    setDraft("");
    setBusy(true);
    let reply;
    try {
      const page = await readPage(tab);
      const answer = await services.core.Chat.askPage({ question: q, page, history }, ai, { fetch: (...a) => fetch(...a) });
      reply = { role: "assistant", content: answer };
    } catch (err) {
      reply = { role: "error", content: String(err.message || err) };
    }
    setBusy(false);
    setConvo((c) => ({ ...c, messages: [...c.messages, reply] }));
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Ask AI" kicker="This page">
      <Text style={[ui.help, { marginBottom: 8 }]}>
        {ready
          ? `Questions send this page's text, title and address to ${ai.provider === "grok" ? "Grok (xAI)" : "your local model"} (${services.core.AI.endpoint(ai).model}). Nothing is sent until you ask.`
          : "Set up a model first in Settings: a Grok API key, or a local model server on your network."}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {QUICK.map(([label, q]) => (
          <Button key={label} label={label} small onPress={() => send(q)} />
        ))}
      </View>
      {convo.messages.map((m, i) => (
        <View
          key={i}
          style={{
            alignSelf: m.role === "user" ? "flex-end" : "stretch",
            maxWidth: m.role === "user" ? "90%" : "100%",
            backgroundColor: m.role === "user" ? "#1f2a44" : colors.bg,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: 8,
            padding: 8,
            marginBottom: 6,
          }}
        >
          <Text style={{ color: m.role === "error" ? colors.bad : colors.text, fontSize: 14, lineHeight: 20 }}>{m.content}</Text>
        </View>
      ))}
      {busy ? <Text style={[ui.help, { marginBottom: 6 }]}>Thinking…</Text> : null}
      <TextInput
        style={[ui.input, { minHeight: 60, textAlignVertical: "top" }]}
        value={draft}
        onChangeText={setDraft}
        placeholder="Ask about this page"
        placeholderTextColor={colors.mute}
        multiline
      />
      <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
        <Button label="Send" onPress={() => send(draft)} active={!!draft.trim()} />
        <Button label="Clear" onPress={() => setConvo({ url: tab?.url || "", messages: [] })} />
      </View>
    </Sheet>
  );
}
