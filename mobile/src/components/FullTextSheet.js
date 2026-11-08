// M19: the Full text sheet, the set-up tutorial and the disclaimer.
// The tutorial and disclaimer are shown in this sheet until full text is set
// up, and always in Settings → Full text for papers.
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { colors, ui } from "../theme";
import Button from "./Button";
import Sheet from "./Sheet";

const F = require("../fulltext");

// Set-up steps, in order.
export function FullTextTutorial() {
  const steps = [
    ["Turn on Find free copies", "In Settings → Full text for papers."],
    ["Add your email", "Unpaywall asks every app to send a contact email with each lookup. Nothing else is needed; there is no account."],
    ["Optional: add an OpenAlex key", "OpenAlex finds copies Unpaywall misses. Make a free account at openalex.org, then copy your key from openalex.org/settings/api and paste it here. Lookups by DOI are free."],
    ["Tap Full text on a paper", "When a page has a DOI, a Full text button shows above the bottom bar. NODE looks the DOI up only when you tap it."],
  ];
  return (
    <View accessibilityRole="list">
      <Text style={ui.kicker} accessibilityRole="header">
        How to set it up
      </Text>
      {steps.map(([title, body], i) => (
        <View key={title} style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
          <Text style={{ color: colors.accent, fontWeight: "700", width: 16 }}>{i + 1}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: "600" }}>{title}</Text>
            <Text style={ui.help}>{body}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// What is sent, to whom, and what NODE does not promise.
export function FullTextDisclaimer() {
  return (
    <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 10, marginTop: 6 }}>
      <Text style={[ui.kicker, { marginTop: 0 }]} accessibilityRole="header">
        What NODE sends
      </Text>
      <Text style={ui.help}>
        Only when you tap Full text: the paper's DOI and your email go to Unpaywall (api.unpaywall.org), and the DOI and your API key go to OpenAlex (api.openalex.org). NODE sends no page address, page text or trail. Your email and key stay in this phone's keychain.
      </Text>
      <Text style={[ui.help, { marginTop: 6 }]}>
        NODE lists copies these services report as free to read. It does not check them itself. Check the licence before you reuse or share a paper. The library link goes to LibKey, which uses your library's sign-in if your library supports it.
      </Text>
      <Text style={[ui.help, { marginTop: 6 }]}>Unpaywall and OpenAlex are run by OurResearch, a nonprofit, under their own terms. You can turn this off in Settings at any time.</Text>
    </View>
  );
}

export default function FullTextSheet({ visible, onClose, doi, pmid, services, onOpenUrl, onOpenSettings }) {
  const ft = services.settings.fulltext || {};
  const can = F.sources(ft);
  const ready = can.unpaywall || can.openalex;
  const [state, setState] = useState({ loading: false, result: null });

  useEffect(() => {
    if (!visible || !doi || !ready) return;
    let live = true;
    setState({ loading: true, result: null });
    F.lookUp(doi, ft, services.net.getText).then((result) => live && setState({ loading: false, result }));
    return () => {
      live = false;
    };
  }, [visible, doi, ready]);

  if (!visible) return null;
  const links = doi ? F.links(doi) : null;
  const r = state.result;
  const open = (url) => {
    onClose();
    onOpenUrl(url);
  };

  return (
    <Sheet visible onClose={onClose} title={r?.title || "Full text"} kicker={doi ? `DOI ${doi}` : pmid ? `PMID ${pmid}` : "Full text"}>
      {ready && doi ? (
        state.loading ? (
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginVertical: 8 }}>
            <ActivityIndicator color={colors.accent} />
            <Text style={ui.help}>Looking for a free copy…</Text>
          </View>
        ) : r ? (
          <>
            <Text style={{ color: colors.text, fontWeight: "600", marginTop: 4 }} accessibilityLiveRegion="polite">
              {r.copies.length ? `${r.copies.length} free ${r.copies.length === 1 ? "copy" : "copies"} found` : F.STATUS_TEXT.closed}
              {r.status && r.copies.length ? ` · ${F.STATUS_TEXT[r.status] || r.status}` : ""}
            </Text>
            {r.copies.map((c) => (
              <Pressable key={c.url} onPress={() => open(c.url)} accessibilityRole="link" accessibilityLabel={`Open free copy: ${F.copyLine(c)}`} style={{ borderTopWidth: 1, borderColor: colors.line, paddingVertical: 9 }}>
                <Text style={{ color: colors.accent }} numberOfLines={1}>
                  {c.where || c.url}
                </Text>
                <Text style={ui.help}>{F.copyLine(c)}</Text>
              </Pressable>
            ))}
            {r.notes.map((n) => (
              <Text key={n} style={[ui.help, { marginTop: 4 }]}>
                {n}
              </Text>
            ))}
          </>
        ) : null
      ) : null}

      {links ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          <Button label="Through your library" a11yHint="Opens LibKey, which uses your library's sign-in" onPress={() => open(links.library)} />
          <Button label="doi.org" a11yLabel="Open the DOI link" onPress={() => open(links.doi)} />
        </View>
      ) : null}
      {pmid ? (
        <View style={{ flexDirection: "row", marginTop: 6 }}>
          <Button label="PubMed" onPress={() => open(`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`)} />
        </View>
      ) : null}

      {!ready ? (
        <>
          <Text style={[ui.help, { marginTop: 12 }]}>
            {can.reason === "bad-email" ? "The email in Settings doesn't look right." : "To find free copies of papers, set up full text once."}
          </Text>
          <FullTextTutorial />
          <FullTextDisclaimer />
          <View style={{ flexDirection: "row", marginTop: 10 }}>
            <Button label="Set up in Settings" active onPress={onOpenSettings} />
          </View>
        </>
      ) : (
        <Text style={[ui.help, { marginTop: 12 }]}>Copies come from Unpaywall and OpenAlex, which report them as free to read. Check the licence before reusing. Settings → Full text for papers says what is sent.</Text>
      )}
    </Sheet>
  );
}
