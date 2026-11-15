// Ask AI about the current page (shared core/chat.js). One conversation per
// page address; it starts over when the page changes.
// Store rules (src/aiPolicy.js): a provider gets page text only after the
// person agrees (Apple 5.1.2(i)); every answer can be reported (Google Play
// AI-generated content policy); the Demo provider answers on the phone.
import { useEffect, useState } from "react";
import { Linking, Text, TextInput, View } from "react-native";
import { colors, ui } from "../theme";
import Button from "./Button";
import Sheet from "./Sheet";

const P = require("../aiPolicy");
const appConfig = require("../../app.json");

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
  const demo = P.provider(ai) === "demo";
  const ready = demo || services.core.Chat.canChat(ai);
  const [, redraw] = useState(0);
  const consented = P.hasConsent(ai, services.settings.aiConsent);
  const consent = P.consentText(ai);
  const agree = async () => {
    await services.saveSettings({ aiConsent: { ...services.settings.aiConsent, [P.provider(ai)]: Date.now() } });
    redraw((n) => n + 1);
  };
  const report = (i) => {
    const answer = convo.messages[i]?.content || "";
    const question = [...convo.messages.slice(0, i)].reverse().find((m) => m.role === "user")?.content || "";
    const url = P.reportMailto({
      to: appConfig.expo.extra?.reportEmail || "",
      provider: P.providerName(ai),
      model: demo ? "" : services.core.AI.endpoint(ai).model,
      question,
      answer,
      url: tab?.url || "",
      version: appConfig.expo.version,
    });
    Linking.openURL(url).catch(() => {});
  };

  useEffect(() => {
    if (visible && tab && tab.url !== convo.url) setConvo({ url: tab.url, messages: [] });
  }, [visible, tab?.url]);

  const send = async (question) => {
    const q = String(question || "").trim();
    if (!q || !tab || busy || !consented) return;
    const history = convo.messages.filter((m) => m.role !== "error");
    setConvo({ url: tab.url, messages: [...convo.messages, { role: "user", content: q }] });
    setDraft("");
    setBusy(true);
    let reply;
    try {
      const page = await readPage(tab);
      const answer = demo ? P.demoAnswer(q, page) : await services.core.Chat.askPage({ question: q, page, history }, ai, { fetch: (...a) => fetch(...a) });
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
        {demo
          ? "Demo: answers are sentences picked from the page on this phone. Nothing is sent. For real AI answers, add Grok or your own model server in Settings → AI."
          : ready
            ? `Questions send this page's text, title and address to ${P.providerName(ai)} (${services.core.AI.endpoint(ai).model}). Nothing is sent until you ask.`
            : "Set up a model first in Settings: a Grok API key, or a model server on your network. Or choose Demo."}
      </Text>
      {ready && !consented && consent ? (
        <View style={{ borderWidth: 1, borderColor: colors.accent, borderRadius: 8, padding: 10, marginBottom: 10 }} accessibilityLiveRegion="polite">
          <Text style={{ color: colors.text, fontWeight: "700", marginBottom: 6 }} accessibilityRole="header">
            {consent.title}
          </Text>
          {consent.lines.map((l) => (
            <Text key={l} style={[ui.help, { marginBottom: 4 }]}>
              {l}
            </Text>
          ))}
          <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
            <Button label="Agree and continue" active onPress={agree} />
            <Button label="Not now" onPress={onClose} />
          </View>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {QUICK.map(([label, q]) => (
          <Button key={label} label={label} small onPress={() => send(q)} style={!consented && { opacity: 0.4 }} />
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
          {m.role === "assistant" ? (
            <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 4 }}>
              <Button label="⚑ Report" small a11yLabel="Report this AI answer" a11yHint="Opens an email to the NODE team with this answer" onPress={() => report(i)} />
            </View>
          ) : null}
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
        <Button label="Send" onPress={() => send(draft)} active={!!draft.trim() && consented} />
        <Button label="Clear" onPress={() => setConvo({ url: tab?.url || "", messages: [] })} />
      </View>
    </Sheet>
  );
}
