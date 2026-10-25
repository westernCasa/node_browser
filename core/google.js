// Which addresses open in the Google window (a separate Chromium-based browser
// window that NODE starts), because Google refuses sign-in inside Electron apps.
//
// Modes:
//   "apps"   (default) Google sign-in plus the Google apps that need an account.
//   "signin" only the Google sign-in and account pages.
//   "off"    nothing is routed; Google pages stay in NODE (signed out).
//
// Google Search, YouTube watching, Maps and Scholar searching work signed out,
// so they stay in NODE. So do published Google Forms (docs.google.com/forms/d/e/…),
// which anyone can fill in without an account, such as NODE's beta survey. Only Scholar's account features (My Library, alerts)
// are routed.

const SIGNIN_HOSTS = ["accounts.google.com", "myaccount.google.com"];
const APP_HOSTS = [
  "mail.google.com",
  "drive.google.com",
  "docs.google.com",
  "calendar.google.com",
  "meet.google.com",
  "chat.google.com",
  "contacts.google.com",
  "keep.google.com",
  "photos.google.com",
  "gemini.google.com",
  "notebooklm.google.com",
  "classroom.google.com",
  "takeout.google.com",
];

const MODES = ["apps", "signin", "off"];

function parse(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u : null;
  } catch (_) {
    return null;
  }
}

function isScholarAccountPage(u) {
  if (!/^scholar\.google\.[a-z.]+$/.test(u.hostname)) return false;
  if (/^\/scholar_alerts/.test(u.pathname)) return true;
  if (u.pathname === "/scholar" && u.searchParams.has("scilib")) return true;
  // Editing one's own Scholar profile.
  if (u.pathname === "/citations" && /^(edit|list_works|new_profile)/.test(u.searchParams.get("view_op") || "")) return true;
  return false;
}

function routesToGoogleWindow(url, mode = "apps") {
  if (mode === "off") return false;
  const u = parse(url);
  if (!u) return false;
  const host = u.hostname.toLowerCase();
  if (SIGNIN_HOSTS.includes(host)) return true;
  if (mode !== "apps") return false;
  if (host === "docs.google.com" && /^\/forms\/d\/e\//.test(u.pathname)) return false;
  if (APP_HOSTS.includes(host)) return true;
  return isScholarAccountPage(u);
}

module.exports = { routesToGoogleWindow, MODES, SIGNIN_HOSTS, APP_HOSTS };
