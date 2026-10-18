// NODE Chromium build: background service worker of the built-in extension.
// The 4-tab playback limit (core/playback.js) across the browser's tabs, and
// opening the side panel from the toolbar button.
import { PlaybackLimiter } from "../../../core/playback.js";

const playback = new PlaybackLimiter();
let activeTab = null;

chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  activeTab = tabId;
  if (playback.activated(String(tabId))) chrome.tabs.sendMessage(tabId, { type: "resume" }).catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => playback.closed(String(tabId)));

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender.tab?.id;
  if (msg.type === "media-playing" && tabId != null) {
    for (const id of playback.started(String(tabId), String(activeTab ?? tabId))) chrome.tabs.sendMessage(Number(id), { type: "pause-for-limit" }).catch(() => {});
    reply({ ok: true });
  } else if (msg.type === "media-stopped" && tabId != null) {
    playback.stopped(String(tabId));
    reply({ ok: true });
  } else if (msg.type === "playback-state") {
    reply(playback.snapshot());
  } else if (msg.type === "page-settled" && tabId != null) {
    chrome.runtime.sendMessage({ type: "page-settled", tabId }).catch(() => {});
  }
  return false;
});
