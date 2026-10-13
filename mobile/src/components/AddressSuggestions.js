// Address-bar suggestions while typing: a Brave search for what was typed (or
// "Go to" for an address), matching pages from history, and Wikipedia titles.
// With nothing typed yet, recent history is shown.
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { colors, ui } from "../theme";

const { SEARCH_URL, normalizeUrl } = require("../../../core/urls");

const looksLikeAddress = (q) => /^[a-z]+:\/\//i.test(q) || (!q.includes(" ") && q.includes("."));

export default function AddressSuggestions({ query, history, bookmarks, getText, lang = "en", onPick }) {
  const q = String(query || "").trim();
  const [wiki, setWiki] = useState([]);

  // Wikipedia title suggestions, 250 ms after typing stops (cached by the net layer).
  useEffect(() => {
    setWiki([]);
    if (q.length < 2 || looksLikeAddress(q)) return;
    let gone = false;
    const timer = setTimeout(async () => {
      try {
        const code = /^[a-z-]{2,12}$/.test(lang) ? lang : "en";
        const url = `https://${code}.wikipedia.org/w/api.php?action=opensearch&limit=4&namespace=0&format=json&search=${encodeURIComponent(q)}`;
        const res = await getText(url, { timeout: 4000 });
        const data = JSON.parse(res.text || "[]");
        if (!gone) setWiki((data[1] || []).map((title, i) => ({ title, url: data[3]?.[i] })).filter((x) => x.url));
      } catch (_) {}
    }, 250);
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [q, lang]);

  const rows = [];
  if (q) {
    rows.push(
      looksLikeAddress(q)
        ? { key: "go", label: `Go to ${q}`, sub: "", url: normalizeUrl(q) }
        : { key: "search", label: `Search Brave for “${q}”`, sub: "search.brave.com", url: SEARCH_URL + encodeURIComponent(q) }
    );
  }
  for (const b of bookmarks ? bookmarks.search(q, q ? 3 : 4) : []) rows.push({ key: "b" + b.url, label: "★ " + (b.title || b.url), sub: b.url, url: b.url });
  for (const h of history.search(q, q ? 5 : 8)) if (!rows.some((r) => r.url === h.url)) rows.push({ key: "h" + h.url, label: h.title || h.url, sub: h.url, url: h.url, history: true });
  for (const w of wiki) if (!rows.some((r) => r.url === w.url)) rows.push({ key: "w" + w.url, label: w.title, sub: "Wikipedia", url: w.url });
  if (!rows.length) return null;

  return (
    <View
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        right: 0,
        maxHeight: 360,
        backgroundColor: colors.bg2,
        borderBottomWidth: 1,
        borderColor: colors.line,
        zIndex: 20,
        elevation: 20,
      }}
    >
      {/* "handled": tapping a row does not first close the keyboard and the list. */}
      <ScrollView keyboardShouldPersistTaps="handled">
        {rows.map((r) => (
          <Pressable key={r.key} onPress={() => onPick(r.url)} style={{ paddingHorizontal: 12, paddingVertical: 9, borderTopWidth: 1, borderColor: colors.line }}>
            <Text style={{ color: colors.text, fontSize: 14 }} numberOfLines={1}>
              {r.history ? "🕘 " : ""}
              {r.label}
            </Text>
            {r.sub ? (
              <Text style={ui.help} numberOfLines={1}>
                {r.sub}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
