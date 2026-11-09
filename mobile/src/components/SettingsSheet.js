// Search sources and AI query ideas. Keys are kept in the device keychain.
import { useState } from "react";
import { Switch, Text, TextInput, View } from "react-native";
import { colors, ui } from "../theme";
import Button from "./Button";
import Sheet from "./Sheet";
import { FullTextDisclaimer, FullTextTutorial } from "./FullTextSheet";

const F = require("../fulltext");

function Field({ label, value, onChange, secret, placeholder }) {
  return (
    <View style={{ marginTop: 6 }}>
      <Text style={[ui.help, { marginBottom: 2 }]}>{label}</Text>
      <TextInput
        style={ui.input}
        value={value}
        onChangeText={onChange}
        secureTextEntry={secret}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={placeholder}
        placeholderTextColor={colors.mute}
      />
    </View>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
      <Text style={{ color: colors.text, fontWeight: "600" }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

export default function SettingsSheet({ visible, onClose, services }) {
  const s = services.settings;
  const [p, setP] = useState(() => JSON.parse(JSON.stringify(s.providers)));
  const [ai, setAi] = useState(() => JSON.parse(JSON.stringify(s.ai)));
  const [ft, setFt] = useState(() => ({ enabled: false, email: "", openalexKey: "", ...(s.fulltext || {}) }));
  const [msg, setMsg] = useState("");
  const setProv = (id, patch) => setP({ ...p, [id]: { ...p[id], ...patch } });

  const save = async () => {
    await services.saveSettings({ providers: p, ai, fulltext: ft });
    setMsg("Saved.");
  };
  const testAI = async () => {
    await save();
    setMsg("Testing…");
    const r = await services.flow.aiTest();
    setMsg(r.ok ? `Working. Sample ideas: ${r.queries.join(" · ")}` : r.error);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Settings" kicker="Search">
      <Text style={ui.help}>Wikipedia runs for every search. Web results come from the first working source: Brave, SearXNG, DuckDuckGo.</Text>
      <Toggle label="Wikipedia" value={p.wikipedia.enabled} onChange={(v) => setProv("wikipedia", { enabled: v })} />
      <Toggle label="Brave Search API" value={p.brave.enabled} onChange={(v) => setProv("brave", { enabled: v })} />
      {p.brave.enabled ? <Field label="Brave API key" value={p.brave.key} onChange={(v) => setProv("brave", { key: v })} secret /> : null}
      <Toggle label="SearXNG" value={p.searxng.enabled} onChange={(v) => setProv("searxng", { enabled: v })} />
      {p.searxng.enabled ? <Field label="Instance URL" value={p.searxng.url} onChange={(v) => setProv("searxng", { url: v })} placeholder="https://searx.example.org" /> : null}
      <Toggle label="DuckDuckGo (fallback)" value={p.ddg.enabled} onChange={(v) => setProv("ddg", { enabled: v })} />

      <Text style={ui.kicker}>AI query ideas</Text>
      <Toggle label="Use AI query ideas" value={ai.enabled} onChange={(v) => setAi({ ...ai, enabled: v })} />
      <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
        <Button label="Local model" active={ai.provider === "local"} small onPress={() => setAi({ ...ai, provider: "local" })} />
        <Button label="Grok" active={ai.provider === "grok"} small onPress={() => setAi({ ...ai, provider: "grok" })} />
      </View>
      {ai.provider === "local" ? (
        <>
          <Text style={[ui.help, { marginTop: 6 }]}>
            On a phone, "local" means a model server on your own network, such as Ollama on your computer (address like http://192.168.1.20:11434/v1).
          </Text>
          <Field label="Server address" value={ai.local.url} onChange={(v) => setAi({ ...ai, local: { ...ai.local, url: v } })} />
          <Field label="Model name" value={ai.local.model} onChange={(v) => setAi({ ...ai, local: { ...ai.local, model: v } })} />
        </>
      ) : (
        <>
          <Text style={[ui.help, { marginTop: 6 }]}>Grok runs on xAI's servers: your keywords and page titles are sent to xAI.</Text>
          <Field label="xAI API key" value={ai.grok.key} onChange={(v) => setAi({ ...ai, grok: { ...ai.grok, key: v } })} secret />
          <Field label="Model name" value={ai.grok.model} onChange={(v) => setAi({ ...ai, grok: { ...ai.grok, model: v } })} />
        </>
      )}

      <Text style={ui.kicker} accessibilityRole="header">
        Full text for papers
      </Text>
      <Text style={ui.help}>On a page with a DOI, Full text finds a free, legal copy of the paper and links it through your library.</Text>
      <Toggle label="Find free copies (Unpaywall, OpenAlex)" value={ft.enabled} onChange={(v) => setFt({ ...ft, enabled: v })} />
      {ft.enabled ? (
        <>
          <Field label="Your email (Unpaywall asks for it)" value={ft.email} onChange={(v) => setFt({ ...ft, email: v })} placeholder="you@example.org" />
          {ft.email && !F.EMAIL_RE.test(ft.email.trim()) ? <Text style={[ui.help, { color: colors.bad }]}>This doesn't look like an email address.</Text> : null}
          <Field label="OpenAlex API key (optional)" value={ft.openalexKey} onChange={(v) => setFt({ ...ft, openalexKey: v })} secret placeholder="From openalex.org/settings/api" />
        </>
      ) : null}
      <FullTextTutorial />
      <FullTextDisclaimer />

      <View style={{ flexDirection: "row", gap: 6, marginTop: 12 }}>
        <Button label="Save" onPress={save} />
        <Button label="Test AI" onPress={testAI} />
      </View>
      {msg ? <Text style={[ui.help, { marginTop: 8 }]}>{msg}</Text> : null}
    </Sheet>
  );
}
