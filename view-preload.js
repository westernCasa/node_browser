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
