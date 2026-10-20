// NODE Chromium build: the menu page (Library, Bookmarks, History, Downloads,
// Trail, Settings, Help), built from the NODE UI kit's menu-example.html.
// Opened in a tab from the side panel's menu button. #section in the address
// opens that section; Esc or × closes the tab.
const $ = (id) => document.getElementById(id);
const SECTIONS = ["library", "bookmarks", "history", "downloads", "trail", "settings", "help"];

NodeUI.init();

async function closeTab() {
  const tab = await chrome.tabs.getCurrent().catch(() => null);
  if (tab) chrome.tabs.remove(tab.id);
  else window.close();
}

const menu = NodeUI.menuOverlay($("menu"), {
  onSection: (name) => {
    for (const s of document.querySelectorAll("[data-pane]")) s.hidden = s.dataset.pane !== name;
    if (location.hash.slice(1) !== name) history.replaceState(null, "", `#${name}`);
    if (name === "settings") paintSettings();
  },
  onClose: closeTab,
});

function sectionFromHash() {
  const h = location.hash.slice(1);
  return SECTIONS.includes(h) ? h : "library";
}

window.addEventListener("hashchange", () => menu.open(sectionFromHash()));

// Bookmarks, history, downloads and browser settings are Chromium's own pages.
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-open]");
  if (b) chrome.tabs.create({ url: b.dataset.open });
});

async function paintSettings() {
  const saved = (await chrome.storage.local.get("providers")).providers || {};
  $("brave-key").value = saved.brave?.key || "";
  const s = await chrome.runtime.sendMessage({ type: "playback-state" }).catch(() => null);
  $("playback-line").textContent = s ? `Playing: ${s.playing.length} of 4 tabs · paused by the limit: ${s.pausedByLimit.length}` : "";
}

$("save-settings").addEventListener("click", async () => {
  const key = $("brave-key").value.trim();
  const saved = (await chrome.storage.local.get("providers")).providers || {};
  await chrome.storage.local.set({ providers: { ...saved, brave: { ...saved.brave, key, enabled: Boolean(key) } } });
  // The side panel picks this up through chrome.storage.onChanged.
  $("settings-state").textContent = key ? "Saved. Web results now come from Brave Search." : "Saved. Web results come from DuckDuckGo.";
});

$("help-version").textContent = `NODE ${chrome.runtime.getManifest().version} · CHROMIUM ${(navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || ""}`;

menu.open(sectionFromHash());
