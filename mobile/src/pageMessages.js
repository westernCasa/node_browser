// Messages from web pages to the app (the WebView bridge). Every page can
// post to window.ReactNativeWebView, including untrusted and plain http pages,
// so the app accepts only a narrow set of messages and checks each one
// (Google Play Device and Network Abuse policy on JavaScript interfaces in
// WebViews that load untrusted content).
//
// What a page message can do: report what NODE's own injected scripts read
// (keywords, DOI, selection, scrolling, media playing). It can never reach
// files, the keychain, AI keys, settings or the trail store directly, and it
// can't start a network request. No React Native imports (tested in Node).

const MAX_RAW = 400000; // a whole page's text is ~ 200 KB at most
const TYPES = new Set(["extract", "capinfo", "media", "syspause", "selection", "scroll"]);
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

// pendingFor(id) -> the tab id a request was sent to, or null.
// Returns a clean message, or null to ignore it.
function checkMessage(raw, { tabId, pendingFor = () => null }) {
  if (typeof raw !== "string" || raw.length > MAX_RAW) return null;
  let m;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== "object" || Array.isArray(m) || !TYPES.has(m.type)) return null;
  switch (m.type) {
    case "extract":
    case "capinfo": {
      const id = typeof m.id === "string" || typeof m.id === "number" ? String(m.id) : "";
      // Answers only to a request NODE sent to this tab.
      const own = m.type === "capinfo" && id === `ft:${tabId}`;
      if (!own && pendingFor(id) !== tabId) return null;
      if (m.type === "extract") return { type: "extract", id, data: m.data && typeof m.data === "object" ? m.data : null, error: str(m.error, 300) };
      return {
        type: "capinfo",
        id,
        url: str(m.url, 4000),
        title: str(m.title, 500),
        selection: str(m.selection, 2000),
        text: str(m.text, 20000),
        metas: Array.isArray(m.metas) ? m.metas.filter((x) => Array.isArray(x) && x.length === 2).slice(0, 20).map(([n, v]) => [str(n, 60), str(v, 500)]) : [],
        links: Array.isArray(m.links) ? m.links.map((x) => str(x, 500)).filter(Boolean).slice(0, 5) : [],
        error: str(m.error, 300),
      };
    }
    case "media":
      return { type: "media", playing: m.playing === true };
    case "syspause":
      return { type: "syspause" };
    case "selection":
      return { type: "selection", text: str(m.text, 5000) };
    case "scroll":
      return { type: "scroll" };
    default:
      return null;
  }
}

module.exports = { checkMessage, MAX_RAW, TYPES };
