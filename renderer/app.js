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

function renderRuleLine() {
  const el = document.getElementById("rule-line");
  const t = tabs.find((x) => x.id === activeId);
  const names = t?.rule?.matched || [];
  el.hidden = !names.length;
  el.textContent = names.length ? "Site rule: " + names.join(" · ") : "";
}

function renderZoom() {
  const badge = document.getElementById("zoom-badge");
  const t = tabs.find((x) => x.id === activeId);
  const z = t?.zoom || 100;
  badge.hidden = z === 100;
  badge.textContent = z + "%";
}

function renderTabs() {
  renderRuleLine();
  renderZoom();
  // Find bar open while switching tabs: clear the old tab, search the new one.
  if (typeof findbar !== "undefined" && !findbar.hidden && findTabId && findTabId !== activeId) {
    api.findStop(findTabId);
    runFind(true, false);
  }
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
  // Pins belong to the current research session (B17). Only save once the
  // session has loaded, so the empty startup render cannot wipe saved pins.
  if (session) api?.researchPins?.(pinned);
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

// ---- Lazy previews (B14) ----
// A card's preview is fetched only when the card scrolls into view, and at
// most 3 previews load at once. A new result list cancels pending ones.
const PREVIEW_PARALLEL = 3;
let previewGen = 0;
let previewRunning = 0;
const previewQueue = [];
const previewObserver =
  "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            previewObserver.unobserve(e.target);
            const job = e.target.__preview;
            if (job && job.gen === previewGen) {
              previewQueue.push(job);
              pumpPreviews();
            }
          }
        },
        { root: document.getElementById("rail"), rootMargin: "120px 0px" }
      )
    : null;

function queuePreview(card, item) {
  // Wikipedia and Brave results often arrive with an image already: no fetch needed.
  if (item.image) {
    setCardMedia(card, item);
    return;
  }
  const job = { card, item, gen: previewGen };
  if (!previewObserver) {
    previewQueue.push(job);
    pumpPreviews();
    return;
  }
  card.__preview = job;
  previewObserver.observe(card);
}

function pumpPreviews() {
  while (previewRunning < PREVIEW_PARALLEL && previewQueue.length) {
    const job = previewQueue.shift();
    if (job.gen !== previewGen || !job.card.isConnected) continue;
    previewRunning++;
    hydratePreview(job.card, job.item.url, job.item).finally(() => {
      previewRunning--;
      pumpPreviews();
    });
  }
}

// ---- Research session (B17) ----
let session = null; // snapshot from main: { id, name, pins, trail, opened, dismissed, threads }

function notDismissed(items) {
  const gone = new Set(session?.dismissed || []);
  return (items || []).filter((x) => !gone.has(x.url));
}

function readUrls() {
  return new Set([...(session?.trail || []).map((r) => r.url), ...(session?.opened || []).map((o) => o.url)]);
}

// Marks cards already read in this session and adds a dismiss button.
function decorateCard(card, item) {
  card.classList.toggle("read", readUrls().has(item.url));
  const src = card.querySelector(".src");
  if (src && card.classList.contains("read") && !src.querySelector(".badge")) {
    src.insertAdjacentHTML("beforeend", `<span class="badge">read</span>`);
  }
  if (card.__decorated || !api?.researchDismiss) return;
  card.__decorated = true;
  const x = document.createElement("button");
  x.className = "dismiss";
  x.title = "Not useful: hide this result for this session";
  x.textContent = "×";
  x.addEventListener("click", async (e) => {
    e.stopPropagation();
    await api.researchDismiss(item.url);
    session?.dismissed.push(item.url);
    card.remove();
  });
  card.prepend(x);
  for (const b of card.querySelectorAll(".card-actions button")) {
    b.addEventListener("click", () => {
      api.researchOpened?.(item);
      session?.opened.push({ url: item.url, title: item.title, query: item.query || "" });
      card.classList.add("read");
    });
  }
}

function buildCard(item) {
  const card = document.createElement("article");
  card.className = "card";
  card.dataset.url = item.url;
  card.innerHTML = `
    <div class="media-slot">${
      item.image
        ? `<img class="media" src="${escapeHtml(item.image)}" alt="" />`
        : `<div class="media-fallback">Preview loads when visible</div>`
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
  card.__item = item;
  card.querySelector('[data-act="open"]').addEventListener("click", (e) => {
    e.stopPropagation();
    openUrl(item.url, true);
  });
  card.querySelector('[data-act="here"]').addEventListener("click", (e) => {
    e.stopPropagation();
    openUrl(item.url, false);
  });
  return card;
}

// Cards already on screen for the same URL are kept (with their loaded
// preview), so the second, fuller result list does not flicker (B25).
function renderResults(items) {
  previewGen++;
  previewQueue.length = 0;
  previewObserver?.disconnect();
  const existing = new Map([...resultsEl.querySelectorAll(".card")].map((c) => [c.dataset.url, c]));
  resultsEl.innerHTML = "";
  if (!items?.length) {
    resultsEl.innerHTML = `<p class="empty">No suggestions yet. Load a page, or add keywords and press Crawl.</p>`;
    return;
  }
  for (const item of items) {
    let card = existing.get(item.url);
    if (!card) card = buildCard(item);
    if (!card.__hydrated) queuePreview(card, item);
    decorateCard?.(card, item);
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
  card.__hydrated = true;
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
    const slot = card.querySelector(".media-slot .media-fallback");
    if (slot) slot.textContent = "Fetching preview";
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
let crawlAgain = false; // a search was requested while one was running

async function crawl() {
  if (crawlBusy) {
    crawlAgain = true; // run once more with the latest keywords when this one ends
    return;
  }
  const current = tabs.find((t) => t.id === activeId);
  if (!shownKeywords().length) {
    statusEl.textContent = "No keywords yet. Add one, or load a page.";
    return;
  }
  crawlBusy = true;
  statusEl.textContent = "Searching…";
  // Results for a page the user has already left are dropped.
  const startedFor = { id: activeId, url: current?.url };
  const stale = () => {
    const now = tabs.find((t) => t.id === activeId);
    return activeId !== startedFor.id || now?.url !== startedFor.url;
  };
  try {
    let data;
    if (api?.suggestFor) {
      const payload = { pinned, ranked: autoTerms(), title: current?.title || "", excludeUrl: current?.url || "" };
      // Wikipedia first (fast), then the full list once web results arrive (B25).
      const first = await api.suggestFor({ ...payload, part: "reference" });
      if (stale()) return;
      first.results = notDismissed(first.results);
      if (first.results.length) {
        renderResults(first.results);
        statusEl.textContent = `${first.results.length} Wikipedia results · loading web results…`;
      }
      data = await api.suggestFor({ ...payload, part: "all" });
    } else if (api) {
      data = await api.suggest(shownKeywords(), current?.url);
    } else {
      data = { results: await wikiFallback(shownKeywords().join(" ")), queries: [] };
    }
    if (stale()) return;
    data.results = notDismissed(data.results);
    const aiSet = new Set(data.aiQueries || []);
    const qs = (data.queries || []).map((q) => `"${q}"` + (aiSet.has(q) ? " (AI)" : "")).join(" · ");
    statusEl.textContent = `${data.results.length} results` + (qs ? ` for ${qs}` : "");
    if (data.notes?.length) statusEl.textContent += " — " + data.notes.join(" ");
    renderResults(data.results);
  } catch (err) {
    statusEl.textContent = "Search failed: " + errText(err);
  } finally {
    crawlBusy = false;
    if (crawlAgain) {
      crawlAgain = false;
      crawl();
    }
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
      if (res.disabled) {
        // Site rule "suggest": false. Do not read the page or search with its words.
        if (reason !== "tick" || lastCrawl.url !== tab.url) {
          auto = [];
          lastCrawl = { at: Date.now(), url: tab.url, terms: [], selection: "" };
          renderKeys();
          renderResults([]);
          statusEl.textContent = "Suggestions are off for this site (site rule). Pinned keywords still work with Crawl.";
        }
        return;
      }
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
    api.researchVisit?.(tab.url, tab.title, terms.slice(0, 5));
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

function whenText(ms) {
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString();
}

async function renderHistoryShelf(filter = "") {
  libraryList.innerHTML = "";
  const tools = document.createElement("div");
  tools.className = "history-tools";
  const input = document.createElement("input");
  input.placeholder = "Search history";
  input.value = filter;
  const clear = document.createElement("button");
  clear.className = "chip";
  clear.textContent = "Clear all history";
  clear.addEventListener("click", async () => {
    await api.historyClear();
    renderHistoryShelf();
  });
  tools.append(input, clear);
  libraryList.appendChild(tools);
  const list = document.createElement("div");
  list.className = "history-list";
  libraryList.appendChild(list);
  const fill = async () => {
    const rows = await api.historySearch(input.value, 300);
    list.innerHTML = rows.length ? "" : `<p class="help">No history yet.</p>`;
    for (const r of rows) {
      const row = document.createElement("div");
      row.className = "history-row";
      const text = document.createElement("div");
      text.innerHTML = `<div class="t">${escapeHtml(r.title || r.url)}</div><div class="u">${escapeHtml(r.url)}</div>`;
      const when = document.createElement("span");
      when.className = "when";
      when.textContent = `${whenText(r.lastVisit)} · ${r.visits}×`;
      const open = document.createElement("button");
      open.textContent = "Open";
      open.addEventListener("click", async () => {
        await closeLibrary();
        api.createTab(r.url);
      });
      const del = document.createElement("button");
      del.textContent = "Remove";
      del.addEventListener("click", async () => {
        await api.historyRemove(r.url);
        row.remove();
      });
      row.append(text, when, open, del);
      list.appendChild(row);
    }
  };
  let t = null;
  input.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(fill, 150);
  });
  await fill();
  input.focus();
}

async function openLibrary() {
  libraryEl.hidden = false;
  if (api?.setLibraryOpen) await api.setLibraryOpen(true);
  if (shelfFolder === "history") {
    if (api?.historySearch) await renderHistoryShelf();
    return;
  }
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

// ---- Sources panel (B15) ----
const suggestPane = document.getElementById("suggest-pane");
const sourcesPane = document.getElementById("sources-pane");
const sourcesList = document.getElementById("sources-list");
const sourcesMsg = document.getElementById("sources-msg");
let sourcesDraft = null; // { providers: { id: {...} } } edits not yet saved

function minutesAgo(ms) {
  if (!ms) return "";
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? "just now" : `${m} min ago`;
}

function stateLine(st) {
  if (!st.enabled) return { text: "Off", cls: "" };
  if (!st.ready) return { text: "Needs setup (see the field above).", cls: "bad" };
  if (st.paused) return { text: `Paused ${st.pausedFor} min: ${st.lastError}`, cls: "bad" };
  if (st.lastError) return { text: st.lastError, cls: "bad" };
  if (st.lastOk) return { text: `Working · ${st.lastCount} results ${minutesAgo(st.lastOk)}`, cls: "ok" };
  return { text: "Not used yet", cls: "" };
}

// AI section of the Settings pane (B20).
const aiEls = {
  enabled: document.getElementById("ai-enabled"),
  provider: document.getElementById("ai-provider"),
  localUrl: document.getElementById("ai-local-url"),
  localModel: document.getElementById("ai-local-model"),
  grokKey: document.getElementById("ai-grok-key"),
  grokModel: document.getElementById("ai-grok-model"),
  state: document.getElementById("ai-state"),
  privacy: document.getElementById("ai-privacy"),
  models: document.getElementById("ai-models"),
};

function paintAIProvider() {
  const grok = aiEls.provider.value === "grok";
  document.getElementById("ai-local").hidden = grok;
  document.getElementById("ai-grok").hidden = !grok;
  aiEls.privacy.textContent = grok
    ? "Grok runs on xAI's servers: your keywords and page titles are sent to xAI. Sites with suggestions turned off by a site rule are never sent."
    : "A local model runs on this computer, so nothing leaves it. Install Ollama (ollama.com) and run: ollama pull llama3.2. LM Studio works too (address http://localhost:1234/v1).";
}

function fillAI(ai, status) {
  aiEls.enabled.checked = Boolean(ai.enabled);
  aiEls.provider.value = ai.provider;
  aiEls.localUrl.value = ai.local.url || "";
  aiEls.localModel.value = ai.local.model || "";
  aiEls.grokModel.value = ai.grok.model || "";
  aiEls.grokKey.value = "";
  aiEls.grokKey.placeholder = ai.grok.keySet ? "Saved. Type to replace." : "Starts with xai-";
  paintAIProvider();
  aiEls.state.className = "state " + (status?.lastError ? "bad" : status?.lastOk ? "ok" : "");
  aiEls.state.textContent = !ai.enabled
    ? "Off"
    : status?.lastError
      ? status.lastError
      : status?.lastOk
        ? `Working · last ideas: ${status.lastQueries.join(" · ")}`
        : "Not used yet";
}

function aiDraft() {
  const d = {
    enabled: aiEls.enabled.checked,
    provider: aiEls.provider.value,
    local: { url: aiEls.localUrl.value, model: aiEls.localModel.value },
    grok: { model: aiEls.grokModel.value },
  };
  if (aiEls.grokKey.value) d.grok.key = aiEls.grokKey.value; // blank keeps the saved key
  return d;
}

aiEls.provider.addEventListener("change", paintAIProvider);
document.getElementById("ai-test").addEventListener("click", async () => {
  await saveSources(false);
  aiEls.state.className = "state";
  aiEls.state.textContent = "Testing…";
  const r = await api.testAI();
  aiEls.models.innerHTML = "";
  for (const m of r.models || []) {
    const o = document.createElement("option");
    o.value = m;
    aiEls.models.appendChild(o);
  }
  aiEls.state.className = "state " + (r.ok ? "ok" : "bad");
  aiEls.state.textContent = r.ok
    ? `Working. Sample ideas: ${r.queries.join(" · ")}${r.models.length ? ` · ${r.models.length} model${r.models.length === 1 ? "" : "s"} on the server` : ""}`
    : r.error;
});

async function renderSources() {
  const [settings, status] = await Promise.all([api.getSettings(), api.searchStatus()]);
  fillAI(settings.ai, settings.aiStatus);
  sourcesDraft = { providers: {} };
  sourcesList.innerHTML = "";
  for (const meta of settings.meta) {
    const conf = settings.providers[meta.id] || {};
    const st = status.find((x) => x.id === meta.id) || {};
    const draft = (sourcesDraft.providers[meta.id] = { enabled: Boolean(conf.enabled) });

    const box = document.createElement("div");
    box.className = "source";
    const top = document.createElement("div");
    top.className = "top";
    const toggle = document.createElement("label");
    toggle.className = "toggle";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = draft.enabled;
    cb.addEventListener("change", () => (draft.enabled = cb.checked));
    toggle.append(cb, document.createTextNode(meta.label));
    const role = document.createElement("span");
    role.className = "role";
    role.textContent = meta.role === "reference" ? "reference" : "web";
    top.append(toggle, role);
    box.appendChild(top);

    for (const f of meta.fields) {
      const wrap = document.createElement("label");
      wrap.className = "field";
      const lab = document.createElement("span");
      lab.textContent = f.label;
      const input = document.createElement("input");
      input.type = f.secret ? "password" : "text";
      input.spellcheck = false;
      if (f.secret) {
        input.placeholder = conf[f.key + "Set"] ? "Saved. Type to replace." : f.placeholder || "";
        // Blank means "keep the saved key"; only typed values are sent.
        input.addEventListener("input", () => (draft[f.key] = input.value));
      } else {
        input.value = conf[f.key] || "";
        input.placeholder = f.placeholder || "";
        input.addEventListener("input", () => (draft[f.key] = input.value));
      }
      wrap.append(lab, input);
      box.appendChild(wrap);
    }

    const state = document.createElement("div");
    const line = stateLine(st);
    state.className = "state " + line.cls;
    state.textContent = line.text;
    box.appendChild(state);

    const actions = document.createElement("div");
    actions.className = "actions";
    const test = document.createElement("button");
    test.textContent = "Test";
    test.title = "Save, then run one search with this source";
    test.addEventListener("click", async () => {
      await saveSources(false);
      state.className = "state";
      state.textContent = "Testing…";
      const r = await api.testSource(meta.id);
      state.className = "state " + (r.ok ? "ok" : "bad");
      state.textContent = r.ok ? `Working · ${r.count} results in ${r.ms} ms` : r.error;
    });
    actions.appendChild(test);
    for (const f of meta.fields.filter((x) => x.secret && conf[x.key + "Set"])) {
      const clear = document.createElement("button");
      clear.textContent = "Remove key";
      clear.addEventListener("click", async () => {
        draft[f.key] = "";
        draft.enabled = false;
        await saveSources(true);
      });
      actions.appendChild(clear);
    }
    box.appendChild(actions);
    sourcesList.appendChild(box);
  }
  sourcesMsg.textContent = settings.encrypted
    ? "API keys are stored encrypted with your system keychain."
    : "Your system keychain is not available, so API keys are stored as plain text in Scout's settings file.";
}

async function saveSources(rerender = true) {
  if (!sourcesDraft) return;
  await api.setSettings({ ...sourcesDraft, ai: aiDraft() });
  if (rerender) await renderSources();
}

async function openSources() {
  if (!api?.getSettings) {
    showNotice("Search sources can only be changed in the desktop app.");
    return;
  }
  showPane("sources");
  await renderSources();
}

function closeSources() {
  showPane("suggest");
}

// One sidebar pane at a time: suggestions, trail or settings.
function showPane(name) {
  suggestPane.hidden = name !== "suggest";
  sourcesPane.hidden = name !== "sources";
  document.getElementById("trail-pane").hidden = name !== "trail";
}

document.getElementById("sources-btn").addEventListener("click", openSources);
document.getElementById("rules-edit").addEventListener("click", () => api?.editRules?.());
document.getElementById("rules-reload").addEventListener("click", async () => {
  const r = await api?.reloadRules?.();
  if (r) document.getElementById("rules-msg").textContent = `${r.count} rules loaded.` + (r.errors.length ? " Problems: " + r.errors.join(" ") : "");
});
document.getElementById("sources-back").addEventListener("click", closeSources);
document.getElementById("sources-save").addEventListener("click", async () => {
  await saveSources(true);
  sourcesMsg.textContent = "Saved. " + sourcesMsg.textContent.replace(/^Saved\. /, "");
  closeSources();
  crawl();
});

// ---- Find in page (B19) ----
const findbar = document.getElementById("findbar");
const findInput = document.getElementById("find-input");
const findCount = document.getElementById("find-count");
let findTabId = null;

function openFind() {
  if (!api?.findStart || !activeId) return;
  findbar.hidden = false;
  findInput.focus();
  findInput.select();
  if (findInput.value) runFind(true, false);
}

function runFind(forward = true, findNext = false) {
  const text = findInput.value;
  if (!text) {
    findCount.textContent = "";
    if (findTabId) api.findStop(findTabId);
    return;
  }
  findTabId = activeId;
  api.findStart(activeId, text, { forward, findNext });
}

function stepFind(forward) {
  if (findbar.hidden) return openFind();
  runFind(forward, true);
}

function closeFind() {
  findbar.hidden = true;
  findCount.textContent = "";
  if (findTabId) api.findStop(findTabId);
  findTabId = null;
}

let findTimer = null;
findInput.addEventListener("input", () => {
  clearTimeout(findTimer);
  findTimer = setTimeout(() => runFind(true, false), 120);
});
findInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    runFind(!e.shiftKey, true);
  } else if (e.key === "Escape") {
    closeFind();
  }
});
document.getElementById("find-next").addEventListener("click", () => runFind(true, true));
document.getElementById("find-prev").addEventListener("click", () => runFind(false, true));
document.getElementById("find-close").addEventListener("click", closeFind);
document.getElementById("zoom-badge").addEventListener("click", () => activeId && api?.zoom?.(activeId, 0));

// ---- Address-bar suggestions from history (B19) ----
const historyList = document.getElementById("history-list");
let omniTimer = null;
omni.addEventListener("input", () => {
  if (!api?.historySearch) return;
  clearTimeout(omniTimer);
  omniTimer = setTimeout(async () => {
    const rows = await api.historySearch(omni.value, 8);
    historyList.innerHTML = "";
    for (const r of rows) {
      const o = document.createElement("option");
      o.value = r.url;
      o.label = r.title || r.url;
      historyList.appendChild(o);
    }
  }, 120);
});

// ---- Trail pane (B17) ----
const trailList = document.getElementById("trail-list");
const sessionName = document.getElementById("session-name");
const sessionSelect = document.getElementById("session-select");

async function refreshSession() {
  if (!api?.researchGet) return;
  session = await api.researchGet();
}

function adoptSession(s) {
  session = s;
  pinned = [...(s.pins || [])];
  renderKeys();
  // Re-mark visible cards for the new session.
  for (const c of resultsEl.querySelectorAll(".card")) if (c.__item) decorateCard(c, c.__item);
}

async function renderTrail() {
  await refreshSession();
  if (!session) return;
  sessionName.value = session.name;
  const list = await api.researchList();
  sessionSelect.innerHTML = "";
  for (const s of list) {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = `${s.name} (${s.pages})`;
    o.selected = s.current;
    sessionSelect.appendChild(o);
  }
  document.getElementById("session-meta").textContent =
    `${session.trail.length} pages read · ${session.opened.length} suggestions opened · ${session.dismissed.length} hidden` +
    (session.pins.length ? ` · pinned: ${session.pins.join(", ")}` : "");

  const pin = (term) => {
    if (!isPinned(term)) pinned = [...pinned, term];
    renderKeys();
    showPane("suggest");
    crawl();
  };
  const threadsEl = document.getElementById("threads");
  threadsEl.innerHTML = session.threads.length ? "" : `<p class="help">Keywords that show up on more than one page appear here.</p>`;
  for (const t of session.threads) {
    const chip = document.createElement("span");
    chip.className = "key";
    chip.title = "Click to pin";
    chip.textContent = `${t.term} · ${t.pages}`;
    chip.addEventListener("click", () => pin(t.term));
    threadsEl.appendChild(chip);
  }

  trailList.innerHTML = session.trail.length ? "" : `<p class="help">Pages you read appear here, newest first.</p>`;
  for (const r of [...session.trail].reverse()) {
    const row = document.createElement("div");
    row.className = "trail-row";
    const t = document.createElement("div");
    t.className = "t";
    t.textContent = r.title;
    t.title = r.url;
    t.addEventListener("click", () => openUrl(r.url, false));
    const m = document.createElement("div");
    m.className = "m";
    m.textContent = `${hostOf(r.url)} · ${whenText(r.lastAt)}${r.visits > 1 ? ` · ${r.visits}×` : ""}`;
    const ks = document.createElement("div");
    ks.className = "ks";
    for (const k of r.keywords) {
      const span = document.createElement("span");
      span.textContent = k;
      span.title = "Pin this keyword";
      span.addEventListener("click", () => pin(k));
      ks.appendChild(span);
    }
    row.append(t, m, ks);
    trailList.appendChild(row);
  }
}

document.getElementById("trail-btn").addEventListener("click", async () => {
  if (!api?.researchGet) return showNotice("The research trail needs the desktop app.");
  showPane("trail");
  await renderTrail();
});
document.getElementById("trail-back").addEventListener("click", () => showPane("suggest"));
let renameTimer = null;
sessionName.addEventListener("input", () => {
  clearTimeout(renameTimer);
  renameTimer = setTimeout(() => api.researchRename(sessionName.value), 400);
});
sessionSelect.addEventListener("change", async () => {
  adoptSession(await api.researchSwitch(sessionSelect.value));
  await renderTrail();
});
document.getElementById("session-new").addEventListener("click", async () => {
  adoptSession(await api.researchNew());
  auto = [];
  lastCrawl = { at: 0, url: "", terms: [], selection: "" };
  renderKeys();
  renderResults([]);
  await renderTrail();
  sessionName.focus();
  sessionName.select();
});
document.getElementById("session-export").addEventListener("click", async () => {
  const item = await api.researchExport();
  showNotice(`Saved session notes to the Library: ${item.name}`, [{ label: "Show file", run: () => api.revealFile(item.file) }]);
});

// Load the current session (and its pins) at startup.
if (api?.researchGet) {
  api.researchGet().then((s) => {
    adoptSession(s);
    if (pinned.length) statusEl.textContent = `Session "${s.name}" · pinned: ${pinned.join(", ")}`;
  });
}

startCrawlClock();

if (api) {
  api.onTabEvent((payload) => {
    if (payload.tabs) tabs = payload.tabs;
    if (payload.activeId) activeId = payload.activeId;
    if (payload.tab) {
      tabs = tabs.map((t) => (t.id === payload.tab.id ? payload.tab : t));
    }
    renderTabs();
    if (payload.type === "find") {
      if (payload.tabId === activeId) findCount.textContent = payload.total ? `${payload.active}/${payload.total}` : "0/0";
      return;
    }
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
    } else if (msg.cmd === "find-open") {
      openFind();
    } else if (msg.cmd === "find-step") {
      stepFind(msg.forward);
    } else if (msg.cmd === "open-history") {
      shelfFolder = "history";
      document.querySelectorAll("#shelf-filters .chip").forEach((c) => c.classList.toggle("active", c.dataset.folder === "history"));
      openLibrary();
    } else if (msg.cmd === "rules-reloaded") {
      const text = `Site rules: ${msg.count} rules in use.` + (msg.errors?.length ? " Problems: " + msg.errors.join(" ") : "");
      if (msg.errors?.length) showNotice(text);
      const m = document.getElementById("rules-msg");
      if (m) m.textContent = text;
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
