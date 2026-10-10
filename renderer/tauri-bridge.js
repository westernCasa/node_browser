(() => {
  const t = window.__TAURI__;
  if (!t || window.scout) return;
  const invoke = t.core.invoke.bind(t.core);
  const listen = t.event.listen.bind(t.event);
  window.scout = {
    createTab: (url) => invoke("tab_create", { url }),
    closeTab: (id) => invoke("tab_close", { id }),
    activateTab: (id) => invoke("tab_activate", { id }),
    navigate: (id, url) => invoke("tab_navigate", { id, url }),
    goBack: (id) => invoke("tab_back", { id }),
    goForward: (id) => invoke("tab_forward", { id }),
    reload: (id) => invoke("tab_reload", { id }),
    setLayout: (mode) => invoke("layout_set", { mode }),
    setSidebarWidth: (w) => invoke("layout_sidebar", { w }),
    extract: (id) => invoke("page_extract", { id }),
    suggest: (keywords, excludeUrl) => invoke("suggest_search", { keywords, excludeUrl }),
    preview: (url, keywords) => invoke("suggest_preview", { url, keywords }),
    onTabEvent: (fn) => {
      listen("tab:event", (ev) => fn(ev.payload));
    },
  };
})();
