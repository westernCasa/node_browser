// Address-bar input to URL, shared by desktop and mobile.
const HOME_URL = "https://en.wikipedia.org/wiki/Main_Page";
// Searches typed in the address bar go to Brave Search.
const SEARCH_URL = "https://search.brave.com/search?q=";

/** Turns what the user typed into a URL: a full URL, a bare domain, or a web search. */
function normalizeUrl(input, searchUrl = SEARCH_URL) {
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

module.exports = { HOME_URL, SEARCH_URL, normalizeUrl, hostOf };
