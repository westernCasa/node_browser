const { ipcRenderer } = require("electron");

const arg = process.argv.find((a) => a.startsWith("--scout-tab="));
const tabId = arg ? arg.slice("--scout-tab=".length) : null;

window.addEventListener(
  "pointerdown",
  () => {
    if (tabId) ipcRenderer.send("tab:clicked", tabId);
  },
  true
);
