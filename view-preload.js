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
