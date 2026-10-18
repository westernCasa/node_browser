// NODE Chromium build: the research side panel. The same shared logic as the
// Electron app: keywords (core/keywords.js), search sources and fallback
// (core/providers.js), search flow (core/suggest.js), Talk (core/talk.js).
import { analyzePage, KeywordContext } from "../../../core/keywords.js";
import { Registry, defaultSettings } from "../../../core/providers.js";
import { createNet } from "../../../core/net.js";
import { createSuggest } from "../../../core/suggest.js";
import { discussions } from "../../../core/talk.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Tests open this page as a tab and pass ?tab=<id> for the page to follow.
const pinnedTab = Number(new URLSearchParams(location.search).get("tab")) || null;

let settings = defaultSettings();
const net = createNet({ fetch: (...a) => fetch(...a) });
const registry = new Registry({ getText: net.getText, getConfig: (id) => settings.providers[id] || {} });
const { suggestFor } = createSuggest({ registry, getAISettings: () => ({ enabled: false }), ttl: net.ttl });
const keywordContext = new KeywordContext();
let pane = "suggest";
let lastUrl = "";

async function loadSettings() {
  const saved = (await chrome.storage.local.get("providers")).providers || {};
  for (const [id, conf] of Object.entries(saved)) settings.providers[id] = { ...settings.providers[id], ...conf };
  $("brave-key").value = settings.providers.brave?.key || "";
}

async function currentTab() {
  if (pinnedTab) return chrome.tabs.get(pinnedTab);
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function extract(tab) {
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: "extract" });
  } catch (_) {
    return null;
  }
}

function renderKeys(ranked) {
  $("keys").innerHTML = ranked.slice(0, 8).map((r) => `<span class="key">${esc(r.term)}</span>`).join("");
}

function renderResults(results) {
  $("results").innerHTML = results
    .map(
      (r, i) => `<a class="card" data-i="${i}" href="#"><div class="src">${esc(r.source || "web")}${r.query ? ` <span class="q">· ${esc(r.query)}</span>` : ""}</div><h3>${esc(r.title)}</h3><p>${esc(r.snippet || "")}</p><div class="host">${esc(new URL(r.url).hostname)}</div></a>`
    )
    .join("");
  $("results").querySelectorAll(".card").forEach((el) =>
    el.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: results[Number(el.dataset.i)].url });
    })
  );
}

async function refreshSuggest(force = false) {
  const tab = await currentTab();
  if (!tab?.url || !/^https?:/.test(tab.url)) {
    $("suggest-status").textContent = "Open a web page to get suggestions.";
    return;
  }
  if (!force && tab.url === lastUrl) return;
  lastUrl = tab.url;
  const page = await extract(tab);
  if (!page) {
    $("suggest-status").textContent = "Could not read this page.";
    return;
  }
  const res = analyzePage(page, { context: keywordContext, limit: 12 });
  if (res.blocked) {
    renderKeys([]);
    $("results").innerHTML = "";
    $("suggest-status").textContent = "This page is a bot check or access block. No keywords.";
    return;
  }
  // Home screens, feeds and sign-in walls: suggest from the running topic.
  const ranked = res.thin ? keywordContext.topic(8) : res.ranked;
  renderKeys(ranked);
  if (!ranked.length) {
    $("results").innerHTML = "";
    $("suggest-status").textContent = "Not enough text on this page to suggest from.";
    return;
  }
  $("suggest-status").textContent = "Searching…";
  const out = await suggestFor({ ranked, title: page.title, excludeUrl: page.url });
  $("suggest-status").textContent = `${out.results.length} results for ${out.queries.map((q) => `"${q}"`).join(" · ")}`;
  renderResults(out.results);
}

async function refreshTalk() {
  const tab = await currentTab();
  $("talk-status").textContent = "Looking for discussions…";
  $("talk-list").innerHTML = "";
  const getJson = async (url) => {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };
  const r = await discussions(tab?.url || "", { getJson });
  if (r.off) {
    $("talk-status").textContent = r.off;
    return;
  }
  $("talk-status").textContent = `${r.hn.length} on Hacker News · ${r.bluesky.length} on Bluesky`;
  const rows = [...r.hn.map((h) => ({ url: h.url, html: `<b>${esc(h.title)}</b><span class="meta">${h.points} points · ${h.comments} comments</span>` })), ...r.bluesky.map((b) => ({ url: b.url, html: `<span class="txt">${esc(b.text)}</span><span class="meta">${esc(b.author)} · ${b.likes} likes</span>` }))];
  $("talk-list").innerHTML = rows.map((x, i) => `<a class="talk-item" data-i="${i}" href="#">${x.html}</a>`).join("") + `<a class="talk-item talk-reddit" href="#" data-reddit="1">Search Reddit for this page</a>`;
  $("talk-list").querySelectorAll("a").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: a.dataset.reddit ? r.reddit : rows[Number(a.dataset.i)].url });
  }));
}

function show(name) {
  pane = name;
  for (const p of ["suggest", "talk", "settings"]) {
    $(`${p}-pane`).hidden = p !== name;
    $(`tab-${p}`).classList.toggle("active", p === name);
  }
  if (name === "talk") refreshTalk();
  if (name === "suggest") refreshSuggest(true);
  if (name === "settings") chrome.runtime.sendMessage({ type: "playback-state" }).then((s) => ($("playback-line").textContent = `Playing: ${s.playing.length} of 4 tabs · paused by the limit: ${s.pausedByLimit.length}`));
}

$("tab-suggest").addEventListener("click", () => show("suggest"));
$("tab-talk").addEventListener("click", () => show("talk"));
$("tab-settings").addEventListener("click", () => show("settings"));
$("save-settings").addEventListener("click", async () => {
  const key = $("brave-key").value.trim();
  settings.providers.brave = { ...settings.providers.brave, key, enabled: Boolean(key) };
  await chrome.storage.local.set({ providers: { brave: { key, enabled: Boolean(key) } } });
  show("suggest");
});

chrome.tabs.onActivated.addListener(() => pane === "suggest" && refreshSuggest());
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "page-settled" && pane === "suggest") refreshSuggest();
});

loadSettings().then(() => refreshSuggest(true));
