// Preload for the full-screen toolbar layer (renderer/chrome-overlay.html):
// receives the copy of the toolbar and sends the user's input back.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nodeOverlay", {
  onMirror: (fn) => ipcRenderer.on("overlay:mirror", (_e, m) => fn(m)),
  onShow: (fn) => ipcRenderer.on("overlay:show", (_e, on) => fn(on)),
  onFocus: (fn) => ipcRenderer.on("overlay:focus", (_e, path) => fn(path)),
  onOffset: (fn) => ipcRenderer.on("overlay:offset", (_e, px) => fn(Number(px) || 0)),
  send: (msg) => ipcRenderer.send("overlay:event", msg),
  hold: (on) => ipcRenderer.send("overlay:hold", Boolean(on)),
});
