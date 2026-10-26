const { ipcRenderer } = require("electron");

const arg = process.argv.find((a) => a.startsWith("--scout-tab="));
const tabId = arg ? arg.slice("--scout-tab=".length) : null;

// Any click in the page makes this tab active and counts as a user gesture
// (used to decide whether a popup may open).
window.addEventListener(
  "pointerdown",
  () => {
    if (tabId) ipcRenderer.send("tab:clicked", tabId);
  },
  true
);

// Tell the app the visible part of the page may have changed (scroll,
// selection, resize), at most once a second. The sidebar re-reads the page
// only after such activity, instead of every 5 seconds.
let lastActivity = 0;
let activityTimer = null;
const activity = () => {
  if (!tabId) return;
  const wait = 1000 - (Date.now() - lastActivity);
  if (wait <= 0) {
    lastActivity = Date.now();
    ipcRenderer.send("tab:activity", tabId);
  } else if (!activityTimer) {
    activityTimer = setTimeout(() => {
      activityTimer = null;
      lastActivity = Date.now();
      ipcRenderer.send("tab:activity", tabId);
    }, wait);
  }
};
window.addEventListener("scroll", activity, { capture: true, passive: true });
window.addEventListener("resize", activity, { passive: true });
document.addEventListener("selectionchange", activity);

const isEditable = (el) => {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el.type || "text").toLowerCase();
    return !["button", "checkbox", "radio", "range", "submit", "reset", "color", "file", "image"].includes(type);
  }
  return false;
};

// Plain "S" takes a screenshot, but only when the user is not typing.
window.addEventListener(
  "keydown",
  (e) => {
    if (!tabId || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key !== "s" && e.key !== "S") return;
    const target = e.composedPath ? e.composedPath()[0] : e.target;
    if (isEditable(target) || isEditable(document.activeElement)) return;
    ipcRenderer.send("tab:hotkey", tabId, "shot");
  },
  true
);

// ---- Pinch (B72) ----
// A trackpad pinch reaches the page as wheel events with ctrlKey and small,
// fractional steps; Ctrl + mouse wheel comes in whole steps of about 100 and is
// left to the browser's own page zoom. Pinches go to the app, which zooms the
// page or moves between Focus, Mosaic and the tab overview (main.js onPinch).
window.addEventListener(
  "wheel",
  (e) => {
    if (!tabId || !e.ctrlKey) return;
    const pinch = !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 10;
    if (!pinch) return;
    e.preventDefault();
    ipcRenderer.send("tab:pinch", tabId, Math.exp(-e.deltaY / 100));
  },
  { passive: false, capture: true }
);

// ---- Gestures ----
const nav = (dir) => tabId && ipcRenderer.send("tab:gesture", tabId, dir);

// Mouse side buttons (button 3 = back, 4 = forward), as in Chrome and Safari.
window.addEventListener(
  "mouseup",
  (e) => {
    // On Windows the same buttons arrive as app commands in main.js.
    if ((e.button === 3 || e.button === 4) && process.platform !== "win32") {
      e.preventDefault();
      nav(e.button === 3 ? "back" : "forward");
    }
  },
  true
);

// Two-finger horizontal swipe on a trackpad: back (fingers move right) or
// forward (fingers move left), with an arrow at the edge of the page that fills
// as the swipe goes on, as in Chrome. Ignored when the page itself can scroll
// sideways in that direction, while pinching (ctrlKey), and for mostly
// vertical scrolling. One navigation per swipe.
const SWIPE_DISTANCE = 220;
let swipeTotal = 0;
let swipeTimer = null;
let swipeDone = false;
let arrowHost = null;
let arrowEl = null;

function canScrollX(el, dx) {
  for (let n = el; n && n !== document; n = n.parentNode) {
    if (n.nodeType !== 1) continue;
    const style = getComputedStyle(n);
    const scrollable = n === document.scrollingElement || /(auto|scroll)/.test(style.overflowX);
    if (!scrollable || n.scrollWidth <= n.clientWidth + 1) continue;
    if (dx < 0 ? n.scrollLeft > 0 : n.scrollLeft + n.clientWidth < n.scrollWidth - 1) return true;
  }
  return false;
}

function showArrow(progress, back) {
  if (!arrowHost) {
    arrowHost = document.createElement("div");
    arrowHost.style.cssText = "all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none";
    const root = arrowHost.attachShadow({ mode: "closed" });
    arrowEl = document.createElement("div");
    arrowEl.style.cssText =
      "position:fixed;top:50%;width:44px;height:44px;margin-top:-22px;border-radius:50%;background:#1a1a1a;color:#fff;" +
      "font:22px/44px -apple-system,system-ui,sans-serif;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.35);transition:opacity .12s";
    root.appendChild(arrowEl);
    (document.body || document.documentElement).appendChild(arrowHost);
  }
  const p = Math.min(1, progress);
  arrowEl.textContent = back ? "←" : "→";
  arrowEl.style.left = back ? `${-44 + 64 * p}px` : "";
  arrowEl.style.right = back ? "" : `${-44 + 64 * p}px`;
  arrowEl.style.opacity = String(0.3 + 0.7 * p);
  arrowEl.style.background = p >= 1 ? "#7aa2ff" : "#1a1a1a";
}

function hideArrow() {
  if (arrowEl) arrowEl.style.opacity = "0";
}

window.addEventListener(
  "wheel",
  (e) => {
    if (e.ctrlKey || !tabId) return;
    const dx = e.deltaX;
    if (Math.abs(dx) < 2 || Math.abs(dx) < Math.abs(e.deltaY) * 1.5) return;
    clearTimeout(swipeTimer);
    // The swipe ends when wheel events stop (fingers lifted and momentum over).
    swipeTimer = setTimeout(() => {
      if (!swipeDone && Math.abs(swipeTotal) >= SWIPE_DISTANCE) nav(swipeTotal < 0 ? "back" : "forward");
      swipeTotal = 0;
      swipeDone = false;
      hideArrow();
    }, 160);
    if (swipeDone) return;
    if (swipeTotal === 0 && canScrollX(e.target, dx)) return;
    swipeTotal += dx;
    showArrow(Math.abs(swipeTotal) / SWIPE_DISTANCE, swipeTotal < 0);
  },
  { capture: true, passive: true }
);

// ---- Passwords (B47) ----
// After a sign-in form is sent, the username and password go to the app, which
// asks whether to save them (main.js). When a sign-in field gets focus on a
// site with saved logins, the app shows them in a small menu; a login is
// filled only when the user picks it. Only this page's top frame takes part.
const TEXTISH = ["text", "email", "tel", ""];
const visible = (el) => {
  if (!el || !el.isConnected || el.disabled || el.readOnly) return false;
  if (!el.getClientRects().length) return false;
  const s = getComputedStyle(el);
  return s.visibility !== "hidden" && s.display !== "none";
};
const scopeOf = (el) => (el && el.form) || document;
const passwordFields = (scope) => [...scope.querySelectorAll("input[type=password]")].filter(visible);
const USERISH = /user|e-?mail|login|account|ident|phone|handle/i;
function usernameField(scope, before) {
  const all = [...scope.querySelectorAll("input")].filter((el) => TEXTISH.includes((el.getAttribute("type") || "").toLowerCase()) && visible(el));
  const prior = before ? all.filter((el) => el.compareDocumentPosition(before) & Node.DOCUMENT_POSITION_FOLLOWING) : all;
  const pool = prior.length ? prior : all;
  const score = (el) => {
    const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (/\b(username|email)\b/.test(ac)) return 3;
    if ((el.type || "").toLowerCase() === "email") return 2;
    if (USERISH.test(`${el.name} ${el.id} ${el.placeholder} ${el.getAttribute("aria-label") || ""}`)) return 1;
    return 0;
  };
  let best = null;
  for (const el of pool) if (!best || score(el) >= score(best)) best = el;
  if (best && score(best) === 0 && !before) return null; // a lone search box is not a username
  return best;
}
function isUsernameField(el) {
  if (!el || el.tagName !== "INPUT" || !TEXTISH.includes((el.getAttribute("type") || "").toLowerCase())) return false;
  const scope = scopeOf(el);
  if (passwordFields(scope).length) return usernameField(scope, passwordFields(scope)[0]) === el;
  const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
  return /\busername\b/.test(ac);
}

// The sign-in data in the form around el (or the whole page).
function readLogin(el) {
  const scope = scopeOf(el);
  const pws = passwordFields(scope).filter((p) => p.value);
  // Sign-up and change-password forms repeat the new password last.
  const password = pws.length ? pws[pws.length - 1].value : "";
  const userEl = usernameField(scope, pws[0] || passwordFields(scope)[0] || null);
  const username = userEl ? userEl.value.trim() : "";
  return { username, password };
}
function sendLogin(el) {
  if (!tabId) return;
  const { username, password } = readLogin(el);
  // A first step that asks only for the username (Google, Microsoft) is kept
  // for the password step that follows.
  if (!password) {
    if (username && isUsernameField(el instanceof HTMLInputElement ? el : usernameField(scopeOf(el), null))) ipcRenderer.send("pw:submitted", { username, password: "" });
    return;
  }
  ipcRenderer.send("pw:submitted", { username, password });
}
document.addEventListener("submit", (e) => sendLogin(e.target), true);
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key !== "Enter" || !(e.target instanceof HTMLInputElement)) return;
    if (e.target.type === "password" || isUsernameField(e.target)) sendLogin(e.target);
  },
  true
);
window.addEventListener(
  "click",
  (e) => {
    const b = e.target instanceof Element ? e.target.closest("button, input[type=submit], input[type=image], [role=button]") : null;
    if (!b) return;
    // Only buttons that send the form: a submit button, or outside a form a
    // button labelled like one (not "Show password" and the like).
    const submitLike = b.form ? b.type === "submit" || b.type === "image" : /\b(sign|log)\s?in\b|continue|next|submit/i.test(b.textContent || b.value || b.getAttribute("aria-label") || "");
    if (!submitLike) return;
    const scope = b.form || document;
    if (passwordFields(scope).some((p) => p.value) || (scope !== document && [...scope.querySelectorAll("input")].some(isUsernameField))) sendLogin(b);
  },
  true
);

// Offer saved logins when a sign-in field gets focus (once per field), and
// again when an empty field that already has focus is clicked. The app shows
// the menu only right after a click or key press in this tab.
const offered = new WeakSet();
let lastField = null;
const fieldKind = (el) => (!(el instanceof HTMLInputElement) ? null : el.type === "password" ? "password" : isUsernameField(el) ? "username" : null);
async function offer(el, kind) {
  const r = el.getBoundingClientRect();
  const shown = await ipcRenderer.invoke("pw:focus", { kind, rect: { x: r.left, y: r.top, width: r.width, height: r.height } }).catch(() => false);
  if (shown) offered.add(el);
}
document.addEventListener(
  "focusin",
  (e) => {
    const kind = tabId && fieldKind(e.target);
    if (!kind) return;
    lastField = e.target;
    if (!offered.has(e.target)) offer(e.target, kind);
  },
  true
);
window.addEventListener(
  "mousedown",
  (e) => {
    const el = e.target;
    const kind = tabId && el === document.activeElement && !el.value && fieldKind(el);
    if (kind) setTimeout(() => offer(el, kind), 0);
  },
  true
);

function setValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  el.focus();
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
ipcRenderer.on("pw:fill", (_e, { origin, username, password }) => {
  if (location.origin !== origin) return;
  const anchor = lastField && lastField.isConnected ? lastField : document.activeElement;
  const scope = scopeOf(anchor);
  const pw = passwordFields(scope)[0] || null;
  const user = usernameField(scope, pw) || (anchor instanceof HTMLInputElement && anchor.type !== "password" ? anchor : null);
  if (user && username) setValue(user, username);
  if (pw && password) setValue(pw, password);
});
