// Address-bar input to URL, shared by desktop and mobile.
const HOME_URL = "https://en.wikipedia.org/wiki/Main_Page";

/** Turns what the user typed into a URL: a full URL, a bare domain, or a web search. */
function normalizeUrl(input, searchUrl = "https://duckduckgo.com/?q=") {
  const raw = String(input || "").trim();
  if (!raw) return "https://en.wikipedia.org/wiki/Special:Search";
  if (/^[a-z]+:\/\//i.test(raw)) return raw;
  if (/^localhost(:\d+)?(\/|$)/i.test(raw)) return "http://" + raw;
  if (raw.includes(" ") || !raw.includes(".")) return searchUrl + encodeURIComponent(raw);
  return "https://" + raw;
}

function hostOf(url) {
  const m = /^[a-z]+:\/\/([^/?#:]+)/i.exec(String(url || ""));
  return m ? m[1].replace(/^www\./, "") : String(url || "");
}

module.exports = { HOME_URL, normalizeUrl, hostOf };
