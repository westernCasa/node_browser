const api = window.scout || null;

const tabsEl = document.getElementById("tabs");
const omni = document.getElementById("omni");
const omniForm = document.getElementById("omni-form");
const keysEl = document.getElementById("keys");
const resultsEl = document.getElementById("results");
const statusEl = document.getElementById("suggest-status");
const layoutBtn = document.getElementById("layout-btn");
const keyInput = document.getElementById("key-input");

let tabs = [];
let activeId = null;
let layout = "focus";
let suggestTimer = null;
let crawlBusy = false;
let crawlClock = null;

// Keyword state (B10). Pinned keywords are chosen by the user and are never
// replaced by the automatic reading of the page. Hidden keywords are never shown.
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};
let pinned = [];
let banned = store.get("scout.banned", []);
let auto = []; // ranked terms from the page: [{term, score, kind}]
let autoOn = store.get("scout.auto", true);
let lastCrawl = { at: 0, url: "", terms: [], selection: "" };
const RECRAWL_GAP_MS = 20000; // B11: minimum time between automatic searches
const AUTO_SHOWN = 8;

const lower = (s) => String(s).toLowerCase();
const isPinned = (t) => pinned.some((p) => lower(p) === lower(t));
const isBanned = (t) => banned.includes(lower(t));

function autoTerms() {
  return auto.map((r) => r.term).filter((t) => !isPinned(t) && !isBanned(t));
}

// Chips shown in the panel: pins first, then the top automatic terms.
function shownKeywords() {
  return [...pinned, ...autoTerms().slice(0, AUTO_SHOWN)];
}

function overlap(a, b) {
  const A = new Set(a.map(lower));
  const B = new Set(b.map(lower));
  if (!A.size && !B.size) return 1;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / Math.max(A.size, B.size);
}

const STOP = new Set(
  "a an the and or of to in on for with from by as at is are was were be this that these those it its into over about after before between than then so if but not no yes you your we they he she their our my page wikipedia free encyclopedia search home skip content official site www com org net".split(
    " "
  )
);

function deriveKeywords(page) {
  const names = [...(page?.names || [])];
  const metaBits = [...(page?.mediaMeta || []), ...(page?.mediaLinks || [])]
    .join(" ")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9+#.\-\s]/g, " ");
  const counts = new Map();
  for (const raw of metaBits.split(/\s+/)) {
    const w = raw.replace(/^\.+|\.+$/g, "");
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  const fromMeta = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w);
  const nameTokens = names
    .flatMap((n) => n.split(/\s+/))
    .map((w) => w.replace(/[^a-zA-Z0-9+-]/g, ""))
    .filter((w) => w.length > 2 && !STOP.has(w.toLowerCase()));
  const merged = [];
  const seen = new Set();
  for (const w of [...names, ...nameTokens, ...fromMeta]) {
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(w);
    if (merged.length >= 8) break;
  }
  return merged;
}

function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function renderTabs() {
  tabsEl.innerHTML = "";
  for (const t of tabs) {
    const el = document.createElement("div");
    el.className = "tab" + (t.id === activeId ? " active" : "");
    el.innerHTML = `<span title="${escapeHtml(t.url || "")}">${escapeHtml(t.title || "New tab")}</span>`;
    if (api?.toggleTabAudio && (t.audible || t.audio !== "auto")) {
      const snd = document.createElement("button");
      snd.className = "snd" + (t.muted ? "" : " on");
      snd.textContent = t.muted ? "🔇" : "🔊";
      snd.title = t.muted
        ? "Muted. Click to unmute this tab. Right-click: back to automatic."
        : "Playing sound. Click to mute this tab. Right-click: back to automatic.";
      snd.addEventListener("click", (e) => {
        e.stopPropagation();
        api.toggleTabAudio(t.id);
      });
      snd.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        api.resetTabAudio(t.id);
      });
      el.appendChild(snd);
    }
    const x = document.createElement("button");
    x.className = "x";
    x.textContent = "×";
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      api ? api.closeTab(t.id) : demoClose(t.id);
    });
    el.appendChild(x);
    el.addEventListener("click", () => (api ? api.activateTab(t.id) : demoActivate(t.id)));
    tabsEl.appendChild(el);
  }
  const current = tabs.find((t) => t.id === activeId);
  if (current && document.activeElement !== omni) omni.value = current.url || "";
}

function renderKeys() {
  keysEl.innerHTML = "";
  const chip = (term, isPin) => {
    const el = document.createElement("span");
    el.className = "key" + (isPin ? " pinned" : "");
    el.title = isPin ? "Pinned. Click to unpin." : "Click to pin. Pinned keywords go into every search.";
    el.textContent = (isPin ? "📌 " : "") + term;
    el.addEventListener("click", () => {
      if (isPin) pinned = pinned.filter((p) => lower(p) !== lower(term));
      else pinned = [...pinned, term];
      renderKeys();
      crawl();
    });
    const btn = document.createElement("button");
    btn.textContent = "×";
    btn.title = isPin ? "Unpin" : "Hide this keyword";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isPin) {
        pinned = pinned.filter((p) => lower(p) !== lower(term));
      } else {
        banned = [...new Set([...banned, lower(term)])];
        store.set("scout.banned", banned);
      }
      renderKeys();
      crawl();
    });
    el.appendChild(btn);
    keysEl.appendChild(el);
  };
  for (const p of pinned) chip(p, true);
  for (const t of autoTerms().slice(0, AUTO_SHOWN)) chip(t, false);

  const hiddenEl = document.getElementById("hidden-keys");
  hiddenEl.hidden = !banned.length;
  hiddenEl.innerHTML = "";
  if (banned.length) {
    const label = document.createElement("span");
    label.textContent = "Hidden: " + banned.slice(-6).join(", ") + (banned.length > 6 ? ` +${banned.length - 6}` : "");
    const clear = document.createElement("button");
    clear.textContent = "Show all";
    clear.addEventListener("click", () => {
      banned = [];
      store.set("scout.banned", banned);
      renderKeys();
    });
    hiddenEl.append(label, clear);
  }
}

function renderResults(items) {
  resultsEl.innerHTML = "";
  if (!items?.length) {
    resultsEl.innerHTML = `<p class="empty">No suggestions yet. Load a page, or add keywords and press Crawl.</p>`;
    return;
  }
  for (const item of items) {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.url = item.url;
    card.innerHTML = `
      <div class="media-slot">${
        item.image
          ? `<img class="media" src="${escapeHtml(item.image)}" alt="" />`
          : `<div class="media-fallback">Fetching preview</div>`
      }</div>
      <div class="src">${escapeHtml(item.source || "web")}${item.query ? ` <span class="q">· ${escapeHtml(item.query)}</span>` : ""}</div>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.snippet || item.description || "")}</p>
      <div class="host">${escapeHtml(hostOf(item.url))}</div>
      <div class="card-actions">
        <button data-act="open">Open tab</button>
        <button data-act="here">Open here</button>
      </div>
    `;
    hydratePreview(card, item.url, item);
    card.querySelector('[data-act="open"]').addEventListener("click", (e) => {
      e.stopPropagation();
      openUrl(item.url, true);
    });
    card.querySelector('[data-act="here"]').addEventListener("click", (e) => {
      e.stopPropagation();
      openUrl(item.url, false);
    });
    resultsEl.appendChild(card);
  }
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function setCardMedia(card, preview) {
  const slot = card.querySelector(".media-slot");
  if (!slot) return;
  if (preview?.video && /\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(preview.video)) {
    slot.innerHTML = `<video class="media" src="${escapeHtml(preview.video)}" muted loop playsinline preload="metadata"></video>`;
    const v = slot.querySelector("video");
    v.addEventListener("mouseenter", () => v.play().catch(() => {}));
    v.addEventListener("mouseleave", () => v.pause());
    return;
  }
  if (preview?.image) {
    const label = preview.kind === "video" ? "video" : "image";
    slot.innerHTML = `<img class="media" src="${escapeHtml(preview.image)}" alt="${escapeHtml(preview.title || label)}" />`;
    slot.querySelector("img").addEventListener("error", () => {
      slot.innerHTML = `<div class="media-fallback">No preview</div>`;
    });
    return;
  }
  slot.innerHTML = `<div class="media-fallback">No preview</div>`;
}

async function hydratePreview(card, url, seed) {
  try {
    if (seed?.image || seed?.video) setCardMedia(card, seed);
    if (api?.preview) {
      setCardMedia(card, await api.preview(url, shownKeywords()));
      return;
    }
    const id = (() => {
      try {
        const u = new URL(url);
        if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
        if (u.hostname.includes("youtube.com")) return u.searchParams.get("v");
      } catch (_) {}
      return "";
    })();
    if (id) setCardMedia(card, { image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, kind: "video", title: "" });
    else slotNoPreview(card);
  } catch (_) {
    slotNoPreview(card);
  }
}

function slotNoPreview(card) {
  const slot = card.querySelector(".media-slot");
  if (slot) slot.innerHTML = `<div class="media-fallback">No preview</div>`;
}

function openUrl(url, newTab) {
  if (api) {
    if (newTab) api.createTab(url);
    else if (activeId) api.navigate(activeId, url);
    else api.createTab(url);
    return;
  }
  if (newTab) demoCreate(url);
  else demoNavigate(url);
}

// Run a search with the current pins and page keywords.
async function crawl() {
  if (crawlBusy) return;
  const current = tabs.find((t) => t.id === activeId);
  if (!shownKeywords().length) {
    statusEl.textContent = "No keywords yet. Add one, or load a page.";
    return;
  }
  crawlBusy = true;
  statusEl.textContent = "Searching…";
  try {
    let data;
    if (api?.suggestFor) {
      data = await api.suggestFor({
        pinned,
        ranked: autoTerms(),
        title: current?.title || "",
        excludeUrl: current?.url || "",
      });
    } else if (api) {
      data = await api.suggest(shownKeywords(), current?.url);
    } else {
      data = { results: await wikiFallback(shownKeywords().join(" ")), queries: [] };
    }
    const qs = (data.queries || []).map((q) => `"${q}"`).join(" · ");
    statusEl.textContent = `${data.results.length} results` + (qs ? ` for ${qs}` : "");
    if (data.notes?.length) statusEl.textContent += " — " + data.notes.join(" ");
    renderResults(data.results);
  } catch (err) {
    statusEl.textContent = "Search failed: " + errText(err);
  } finally {
    crawlBusy = false;
  }
}

// Read the active page and decide whether to search again (B11).
// reason: "settle" (page finished loading), "tick" (5 s timer), "manual" (Crawl button)
async function crawlViewport(reason) {
  const tab = tabs.find((t) => t.id === activeId);
  if (!tab) return;
  if (!api) {
    auto = deriveKeywords({ names: [tab.title] }).map((term) => ({ term }));
    renderKeys();
    await crawl();
    return;
  }
  if (!tab.url || (reason === "tick" && (tab.loading || !autoOn || crawlBusy))) return;
  try {
    let ranked;
    let selection = "";
    if (api.keywords) {
      const res = await api.keywords(tab.id, banned);
      ranked = res.ranked || [];
      selection = res.page?.selection || "";
    } else {
      ranked = deriveKeywords(await api.extract(tab.id)).map((term) => ({ term }));
    }
    const terms = ranked.map((r) => r.term).slice(0, 6);
    const now = Date.now();
    const newPage = tab.url !== lastCrawl.url;
    const newSelection = selection && selection !== lastCrawl.selection;
    const drifted = overlap(terms, lastCrawl.terms) < 0.5;
    const due = now - lastCrawl.at >= RECRAWL_GAP_MS;
    // Same page finishing another load (frames, lazy content): only re-search if due.
    if (reason === "settle" && !newPage && !due) return;
    if (reason === "tick") {
      const go = newPage || (newSelection && now - lastCrawl.at >= 3000) || (drifted && due);
      if (!go) return;
    }
    auto = ranked;
    lastCrawl = { at: now, url: tab.url, terms, selection };
    renderKeys();
    await crawl();
  } catch (err) {
    statusEl.textContent = "Could not read the page: " + errText(err);
  }
}

function startCrawlClock() {
  if (crawlClock) clearInterval(crawlClock);
  crawlClock = setInterval(() => crawlViewport("tick"), 5000);
}

async function afterSettle(tab) {
  if (!tab?.url || tab.id !== activeId) return;
  await crawlViewport("settle");
}

async function wikiFallback(q) {
  const url =
    "https://en.wikipedia.org/w/api.php?origin=*&action=opensearch&limit=8&namespace=0&format=json&search=" +
    encodeURIComponent(q);
  const res = await fetch(url);
  const data = await res.json();
  return (data[1] || []).map((title, i) => ({
    title,
    snippet: data[2][i] || "",
    url: data[3][i],
    source: "wiki",
  }));
}

document.getElementById("new-tab").addEventListener("click", () => {
  api ? api.createTab("https://en.wikipedia.org/wiki/Main_Page") : demoCreate("https://en.wikipedia.org/wiki/Main_Page");
});
document.getElementById("back").addEventListener("click", () => api && activeId && api.goBack(activeId));
document.getElementById("forward").addEventListener("click", () => api && activeId && api.goForward(activeId));
document.getElementById("reload").addEventListener("click", () => api && activeId && api.reload(activeId));
document.getElementById("refresh-suggest").addEventListener("click", () => crawlViewport("manual"));
const autoBtn = document.getElementById("auto-btn");
const paintAuto = () => {
  autoBtn.classList.toggle("active", autoOn);
  autoBtn.textContent = autoOn ? "Auto" : "Auto off";
};
autoBtn.addEventListener("click", () => {
  autoOn = !autoOn;
  store.set("scout.auto", autoOn);
  paintAuto();
});
paintAuto();

omniForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (api && activeId) api.navigate(activeId, omni.value);
  else demoNavigate(omni.value);
});

document.getElementById("key-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = keyInput.value.trim();
  keyInput.value = "";
  if (!v || isPinned(v)) return;
  pinned = [...pinned, v].slice(0, 6);
  banned = banned.filter((b) => b !== lower(v));
  store.set("scout.banned", banned);
  renderKeys();
  crawl();
});

layoutBtn.addEventListener("click", async () => {
  layout = layout === "mosaic" ? "focus" : "mosaic";
  layoutBtn.classList.toggle("active", layout === "mosaic");
  layoutBtn.textContent = layout === "mosaic" ? "Focus" : "Mosaic";
  if (api) await api.setLayout(layout);
});

const libraryEl = document.getElementById("shelf");
const libraryList = document.getElementById("library-list");
let shelfFolder = "all";

async function openLibrary() {
  libraryEl.hidden = false;
  if (api?.setLibraryOpen) await api.setLibraryOpen(true);
  const rows = api?.libraryList ? await api.libraryList() : [];
  const shown = shelfFolder === "all" ? rows : rows.filter((row) => row.folder === shelfFolder);
  libraryList.innerHTML = "";
  if (!shown.length) {
    libraryList.innerHTML = `<p class="help">Nothing in this shelf yet. Shot, Save, or Media to add some.</p>`;
    return;
  }
  for (const item of shown) {
    const card = document.createElement("article");
    card.className = "poster";
    if (item.kind === "video") {
      card.innerHTML = `<video src="${item.mediaUrl}" controls preload="metadata"></video>`;
    } else if (item.kind === "audio") {
      card.innerHTML = `<audio src="${item.mediaUrl}" controls></audio>`;
    } else if (item.kind === "image") {
      card.innerHTML = `<img src="${item.mediaUrl}" alt="" />`;
    } else {
      card.innerHTML = `<div class="media-fallback">Save</div>`;
    }
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `<strong>${escapeHtml(item.note || item.name)}</strong><p>${escapeHtml(item.folder)}</p>`;
    if (item.sourceUrl) {
      const go = document.createElement("button");
      go.className = "link";
      go.textContent = "Open source";
      go.addEventListener("click", async () => {
        await closeLibrary();
        if (api) api.createTab(item.sourceUrl);
      });
      meta.append(go);
    }
    const show = document.createElement("button");
    show.className = "link";
    show.textContent = "Show file";
    show.addEventListener("click", () => api?.revealFile?.(item.file));
    const remove = document.createElement("button");
    remove.className = "danger";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      await api?.removeLibraryItem?.(item.id);
      openLibrary();
    });
    meta.append(show, remove);
    card.append(meta);
    libraryList.append(card);
  }
}

async function closeLibrary() {
  libraryEl.hidden = true;
  if (api?.setLibraryOpen) await api.setLibraryOpen(false);
}

async function runShot() {
  if (!api?.shot || !activeId) return;
  const item = await api.shot(activeId);
  const status = document.getElementById("suggest-status");
  if (status) status.textContent = "Saved screenshot · " + (item.sourceUrl || "");
  openLibrary();
}

const noticeEl = document.getElementById("notice");

// Short message in the sidebar, with optional action buttons. Replaces alert().
function showNotice(text, actions = []) {
  noticeEl.hidden = false;
  noticeEl.innerHTML = "";
  const p = document.createElement("div");
  p.textContent = text;
  noticeEl.appendChild(p);
  const row = document.createElement("div");
  row.className = "row";
  for (const a of [...actions, { label: "Dismiss", run: () => {} }]) {
    const b = document.createElement("button");
    b.textContent = a.label;
    b.addEventListener("click", () => {
      noticeEl.hidden = true;
      a.run();
    });
    row.appendChild(b);
  }
  noticeEl.appendChild(row);
}

function errText(e) {
  // Electron prefixes IPC errors with "Error invoking remote method ...: Error: "
  return String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

document.getElementById("shot-btn").addEventListener("click", () => runShot().catch((e) => showNotice(errText(e))));
document.getElementById("save-btn").addEventListener("click", () => {
  if (!api?.savePage || !activeId) return;
  api.savePage(activeId).then(openLibrary).catch((e) => showNotice(errText(e)));
});
document.getElementById("media-btn").addEventListener("click", () => {
  if (!api?.grabMedia || !activeId) return;
  api.grabMedia(activeId).then(openLibrary).catch((e) => showNotice(errText(e)));
});
document.getElementById("library-btn").addEventListener("click", () => openLibrary());
document.getElementById("library-close").addEventListener("click", () => closeLibrary());
document.getElementById("shelf-filters").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  shelfFolder = btn.dataset.folder;
  document.querySelectorAll("#shelf-filters .chip").forEach((chip) => chip.classList.toggle("active", chip === btn));
  openLibrary();
});
document.getElementById("library-folder").addEventListener("click", () => api?.openLibraryFolder?.());

window.addEventListener("keydown", (e) => {
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
  if (e.key.toLowerCase() === "s" && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    runShot().catch((err) => showNotice(errText(err)));
  }
});

startCrawlClock();

if (api) {
  api.onTabEvent((payload) => {
    if (payload.tabs) tabs = payload.tabs;
    if (payload.activeId) activeId = payload.activeId;
    if (payload.tab) {
      tabs = tabs.map((t) => (t.id === payload.tab.id ? payload.tab : t));
    }
    renderTabs();
    if (payload.type === "popup-blocked") {
      showNotice(`Blocked a popup: ${payload.url}`, [
        { label: "Open in new tab", run: () => api.createTab(payload.url) },
      ]);
      return;
    }
    if (payload.type === "settled") {
      clearTimeout(suggestTimer);
      suggestTimer = setTimeout(() => afterSettle(payload.tab), 400);
    }
  });
  api.onCommand?.((msg) => {
    if (msg.cmd === "focus-omni") {
      omni.focus();
      omni.select();
    } else if (msg.cmd === "toggle-layout") {
      layoutBtn.click();
    } else if (msg.cmd === "shot-done") {
      statusEl.textContent = "Saved screenshot · " + (msg.item?.sourceUrl || "");
      openLibrary();
    } else if (msg.cmd === "error") {
      showNotice(msg.message);
    }
  });
} else {
  demoCreate("https://en.wikipedia.org/wiki/Main_Page");
}

function demoCreate(url) {
  const id = String(Date.now());
  tabs.push({ id, url, title: hostOf(url), loading: false });
  activeId = id;
  renderTabs();
  afterSettle(tabs.find((t) => t.id === id));
}
function demoActivate(id) {
  activeId = id;
  renderTabs();
}
function demoClose(id) {
  tabs = tabs.filter((t) => t.id !== id);
  if (activeId === id) activeId = tabs.at(-1)?.id || null;
  if (!tabs.length) demoCreate("https://en.wikipedia.org/wiki/Main_Page");
  else renderTabs();
}
function demoNavigate(input) {
  const raw = input.trim();
  const url = /^https?:/i.test(raw)
    ? raw
    : raw.includes(" ") || !raw.includes(".")
      ? "https://en.wikipedia.org/wiki/" + encodeURIComponent(raw)
      : "https://" + raw;
  const t = tabs.find((x) => x.id === activeId);
  if (!t) return demoCreate(url);
  t.url = url;
  t.title = hostOf(url);
  renderTabs();
  afterSettle(t);
}

renderKeys();
renderResults([]);
