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
