const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("scout", {
  createTab: (url) => ipcRenderer.invoke("tab:create", url),
  closeTab: (id) => ipcRenderer.invoke("tab:close", id),
  activateTab: (id) => ipcRenderer.invoke("tab:activate", id),
  navigate: (id, url) => ipcRenderer.invoke("tab:navigate", id, url),
  goBack: (id) => ipcRenderer.invoke("tab:back", id),
  goForward: (id) => ipcRenderer.invoke("tab:forward", id),
  reload: (id) => ipcRenderer.invoke("tab:reload", id),
  setLayout: (mode) => ipcRenderer.invoke("layout:set", mode),
  setSidebarWidth: (w) => ipcRenderer.invoke("layout:sidebar", w),
  setLibraryOpen: (open) => ipcRenderer.invoke("layout:library", open),
  extract: (id) => ipcRenderer.invoke("page:extract", id),
  suggest: (keywords, excludeUrl) => ipcRenderer.invoke("suggest:search", keywords, excludeUrl),
  preview: (url, keywords) => ipcRenderer.invoke("suggest:preview", url, keywords),
  shot: (id) => ipcRenderer.invoke("library:shot", id),
  savePage: (id) => ipcRenderer.invoke("library:save", id),
  grabMedia: (id, url) => ipcRenderer.invoke("library:grab", id, url),
  libraryList: () => ipcRenderer.invoke("library:list"),
  removeLibraryItem: (id) => ipcRenderer.invoke("library:remove", id),
  openLibraryFolder: () => ipcRenderer.invoke("library:open-folder"),
  revealFile: (file) => ipcRenderer.invoke("library:reveal", file),
  toggleTabAudio: (id) => ipcRenderer.invoke("tab:audio", id),
  resetTabAudio: (id) => ipcRenderer.invoke("tab:audio-reset", id),
  onTabEvent: (fn) => {
    ipcRenderer.on("tab:event", (_e, payload) => fn(payload));
  },
  onCommand: (fn) => {
    ipcRenderer.on("ui:command", (_e, payload) => fn(payload));
  },
});
