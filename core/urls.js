// Address-bar input to URL, shared by desktop and mobile.
const HOME_URL = "https://en.wikipedia.org/wiki/Main_Page";
// The beta survey (B65): anonymous Google Form, no account needed.
const SURVEY_URL = "https://forms.gle/XuMGZUzScNYPyP319";
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

// Sign-in, account, payment and banking pages, by the words in their address.
// Agents never read these (agents.js), and the research trail never records
// them (core/research.js), so their addresses cannot reach agents or exports.
// "session" counts only as the first part of the path (github.com/session,
// /sessions/new), so pages about a conference session are still recorded.
const SENSITIVE = /(^|[./-])(login|log-in|signin|sign-in|signup|sign-up|auth|oauth|sso|account|accounts|myaccount|password|passkey|passkeys|webauthn|2fa|mfa|checkout|payment|payments|billing|wallet|bank|banking)([./?#-]|$)/i;
const SESSION_PATH = /^\/sessions?(\/|$)/i;

/** True for sign-in, account, payment and banking pages (see SENSITIVE). */
function isSensitiveUrl(url) {
  let u;
  try {
    u = new URL(String(url || ""));
  } catch {
    return false;
  }
  if (!/^https?:$/.test(u.protocol)) return false;
  return SENSITIVE.test(u.hostname + u.pathname) || SESSION_PATH.test(u.pathname);
}

module.exports = { HOME_URL, SEARCH_URL, SURVEY_URL, normalizeUrl, hostOf, SENSITIVE, isSensitiveUrl };
