const { app, BrowserWindow, BrowserView, ipcMain, session, shell, protocol, net, Menu, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { URL } = require("url");
const { rankTerms, buildQueries, SessionDF } = require("./keywords");

const HOME_URL = "https://en.wikipedia.org/wiki/Main_Page";
const CHROME_TOP = 112;
const SIDEBAR_DEFAULT = 225;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

let win;
let sidebarWidth = SIDEBAR_DEFAULT;
let libraryOpen = false;
const LIBRARY_W = 225;
let layout = "focus"; // focus | mosaic
const tabs = new Map();
let activeId = null;
let idSeq = 1;

function chromeBounds() {
  const [width, height] = win.getContentSize();
  return { width, height };
}

function contentRect() {
  const { width, height } = chromeBounds();
  const right = libraryOpen ? LIBRARY_W : sidebarWidth;
  return {
    x: 0,
    y: CHROME_TOP,
    width: Math.max(280, width - right),
    height: Math.max(200, height - CHROME_TOP),
  };
}

function applyLayout() {
  if (!win) return;
  applyAudio();
  if (libraryOpen) {
    for (const tab of tabs.values()) tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    return;
  }
  const ids = [...tabs.keys()];
  const rect = contentRect();

  if (layout !== "mosaic" || ids.length <= 1) {
    for (const [id, tab] of tabs) {
      if (id === activeId) {
        tab.view.setBounds(rect);
      } else {
        tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
    }
    return;
  }

  const n = ids.length;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const gap = 4;
  const cellW = Math.floor((rect.width - gap * (cols - 1)) / cols);
  const cellH = Math.floor((rect.height - gap * (rows - 1)) / rows);

  ids.forEach((id, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    tabs.get(id).view.setBounds({
      x: rect.x + col * (cellW + gap),
      y: rect.y + row * (cellH + gap),
      width: cellW,
      height: cellH,
    });
  });
}

function emit(payload) {
  win?.webContents.send("tab:event", payload);
}

function tabState(tab) {
  const wc = tab.view.webContents;
  return {
    id: tab.id,
    url: wc.getURL(),
    title: wc.getTitle() || "New tab",
    canBack: wc.canGoBack(),
    canForward: wc.canGoForward(),
    loading: wc.isLoading(),
    muted: wc.isAudioMuted(),
    audible: wc.isCurrentlyAudible(),
    audio: tab.audio,
  };
}

function emitList() {
  emit({ type: "list", tabs: [...tabs.values()].map(tabState), activeId });
}

// Sound policy (B03). "auto": only the active tab is audible; background and
// non-focused Mosaic tiles keep playing but muted. "on"/"off" are user overrides.
function applyAudio() {
  for (const tab of tabs.values()) {
    const muted = tab.audio === "off" ? true : tab.audio === "on" ? false : tab.id !== activeId;
    if (tab.view.webContents.isAudioMuted() !== muted) tab.view.webContents.setAudioMuted(muted);
  }
}

function normalizeUrl(input) {
  const raw = (input || "").trim();
  if (!raw) return "https://en.wikipedia.org/wiki/Special:Search";
  if (/^[a-z]+:\/\//i.test(raw)) return raw;
  if (raw.includes(" ") || !raw.includes(".")) {
    return "https://duckduckgo.com/?q=" + encodeURIComponent(raw);
  }
  return "https://" + raw;
}

function tryAutoplay(wc) {
  const script = `(() => {
    const kick = (el) => {
      if (!el || !el.play) return;
      el.autoplay = true;
      const run = () => el.play().catch(() => {
        el.muted = true;
        el.play().catch(() => {});
      });
      if (el.readyState >= 2) run();
      else el.addEventListener("canplay", run, { once: true });
    };
    document.querySelectorAll("video, audio").forEach(kick);
    document.querySelectorAll("iframe").forEach((f) => {
      try {
        const raw = f.getAttribute("src") || "";
        if (!/youtube|youtu\\.be|vimeo|dailymotion/.test(raw)) return;
        const u = new URL(raw, location.href);
        if (u.searchParams.get("autoplay") === "1") return;
        u.searchParams.set("autoplay", "1");
        f.allow = ((f.allow || "") + "; autoplay; fullscreen").trim();
        f.src = u.toString();
      } catch (_) {}
    });
  })()`;
  wc.executeJavaScript(script, true).catch(() => {});
}

function attachListeners(tab) {
  const wc = tab.view.webContents;
  const ping = () => emit({ type: "update", tab: tabState(tab), activeId });
  wc.on("focus", () => {
    if (activeId !== tab.id) activateTab(tab.id);
  });
  wc.on("page-title-updated", ping);
  wc.on("did-navigate", ping);
  wc.on("did-navigate-in-page", ping);
  wc.on("did-start-loading", ping);
  wc.on("did-stop-loading", () => {
    ping();
    tryAutoplay(wc);
    emit({ type: "settled", tab: tabState(tab) });
  });
  wc.on("audio-state-changed", ping);
  // Popups (B04): only open a new tab if the user clicked or typed in this
  // page in the last 2 s. Everything else is blocked and reported to the UI.
  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (Date.now() - tab.lastGesture < 2000) {
      createTab(url, { background: disposition === "background-tab" });
    } else {
      emit({ type: "popup-blocked", tabId: tab.id, url });
    }
    return { action: "deny" };
  });
  // Shortcuts typed while a web page has focus (B02). Menu accelerators cover
  // Cmd/Ctrl combos; this only records user activity for the popup check.
  wc.on("before-input-event", (_e, input) => {
    if (input.type === "keyDown" || input.type === "mouseDown") tab.lastGesture = Date.now();
  });
}

function createTab(url, opts = {}) {
  const id = String(idSeq++);
  const view = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, "view-preload.js"),
      additionalArguments: [`--scout-tab=${id}`],
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  view.setBackgroundColor("#ffffff"); // pages without their own background expect white
  view.webContents.setUserAgent(USER_AGENT);
  const tab = { id, view, audio: "auto", lastGesture: 0 };
  tabs.set(id, tab);
  win.addBrowserView(view);
  attachListeners(tab);
  if (!opts.background || !activeId) activeId = id;
  view.webContents.loadURL(normalizeUrl(url));
  applyLayout();
  emitList();
  return id;
}

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  win.removeBrowserView(tab.view);
  try {
    tab.view.webContents.destroy();
  } catch (_) {}
  tabs.delete(id);
  if (activeId === id) {
    activeId = [...tabs.keys()].at(-1) || null;
  }
  if (!activeId) createTab(HOME_URL);
  applyLayout();
  emitList();
}

function activateTab(id) {
  if (!tabs.has(id)) return;
  activeId = id;
  applyLayout();
  emitList();
}

async function extractPage(id) {
  const tab = tabs.get(id);
  if (!tab) return null;
  const script = `(() => {
    const MEDIA_EXT = /\\.(mp4|webm|ogv|ogg|mov|m4v|mp3|wav|m4a|aac|flac|jpg|jpeg|png|webp|gif|avif|m3u8)([?#].*)?$/i;
    const inView = (el) => {
      if (!el || !el.getBoundingClientRect) return false;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 0;
      const vw = window.innerWidth || 0;
      return r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw && r.width > 8 && r.height > 8;
    };
    const clean = (s) => (s || "").replace(/\\s+/g, " ").trim();
    const fileStem = (href) => {
      try {
        const path = new URL(href, location.href).pathname.split("/").pop() || "";
        return decodeURIComponent(path.replace(MEDIA_EXT, "").replace(/[-_]+/g, " "));
      } catch (_) { return ""; }
    };
    const namesFrom = (text) => {
      const out = [];
      const t = clean(text);
      if (!t) return out;
      const hits = t.match(/\\b[A-Z][a-z]+(?:\\s+[A-Z][a-z]+){0,3}\\b/g) || [];
      for (const h of hits) {
        if (h.length < 3) continue;
        if (/^(The|A|An|And|For|With|From|This|That|You|Your|Home|Page|Video|Image|Photo)$/.test(h)) continue;
        out.push(h);
      }
      return out;
    };

    const mediaEls = [...document.querySelectorAll("img,video,audio,source,picture,figure,figcaption,track,iframe")];
    const mediaMeta = [];
    const names = [];
    const mediaLinks = [];

    const takeMeta = (el) => {
      const bits = [
        el.getAttribute && el.getAttribute("alt"),
        el.getAttribute && el.getAttribute("title"),
        el.getAttribute && el.getAttribute("aria-label"),
        el.getAttribute && el.getAttribute("data-title"),
        el.getAttribute && el.getAttribute("data-caption"),
        el.getAttribute && el.getAttribute("data-name"),
        el.getAttribute && el.getAttribute("itemprop") === "name" ? el.textContent : "",
      ];
      if (el.tagName === "VIDEO" || el.tagName === "AUDIO") bits.push(el.getAttribute("media-title"));
      const fig = el.closest && el.closest("figure");
      if (fig) {
        const cap = fig.querySelector("figcaption");
        if (cap) bits.push(cap.innerText);
      }
      const labeled = el.getAttribute && el.getAttribute("aria-labelledby");
      if (labeled) {
        const lab = document.getElementById(labeled);
        if (lab) bits.push(lab.innerText);
      }
      const joined = bits.map(clean).filter(Boolean).join(" | ");
      if (joined) mediaMeta.push(joined.slice(0, 240));
      names.push(...namesFrom(joined));
      const srcs = [
        el.currentSrc, el.src, el.getAttribute && el.getAttribute("src"),
        el.getAttribute && el.getAttribute("data-src"),
        el.getAttribute && el.getAttribute("poster"),
      ].filter(Boolean);
      for (const s of srcs) {
        const stem = fileStem(s);
        if (stem && stem.length > 2) {
          mediaMeta.push(stem);
          names.push(...namesFrom(stem.replace(/\\b\\w/g, c => c.toUpperCase())));
        }
      }
    };

    for (const el of mediaEls) {
      if (!inView(el.tagName === "SOURCE" ? el.parentElement : el) && el.tagName !== "META") continue;
      takeMeta(el);
    }

    for (const a of document.querySelectorAll("a[href]")) {
      if (!inView(a)) continue;
      const href = a.href || "";
      const looksMedia = MEDIA_EXT.test(href) || /\\/(watch|video|videos|media|photo|photos|image|gallery|embed)\\b/i.test(href);
      if (!looksMedia) continue;
      const label = clean(a.getAttribute("title") || a.getAttribute("aria-label") || a.innerText);
      mediaLinks.push(label || fileStem(href));
      names.push(...namesFrom(label));
      const stem = fileStem(href);
      if (stem) mediaMeta.push(stem);
    }

    const pageMeta = [
      document.querySelector('meta[property="og:video"]')?.content,
      document.querySelector('meta[property="og:audio"]')?.content,
      document.querySelector('meta[property="og:image"]')?.content,
      document.querySelector('meta[property="og:video:title"]')?.content,
      document.querySelector('meta[name="twitter:player"]')?.content,
      document.querySelector('meta[itemprop="name"]')?.content,
      document.querySelector('meta[name="author"]')?.content,
      document.querySelector('meta[property="og:title"]')?.content,
    ].filter(Boolean);
    for (const m of pageMeta) {
      if (MEDIA_EXT.test(m)) mediaLinks.push(fileStem(m));
      names.push(...namesFrom(m));
      if (/og:title|author|name|video:title/i.test(m) || namesFrom(m).length) mediaMeta.push(String(m).slice(0, 160));
    }
    names.push(...namesFrom(document.querySelector('meta[property="og:title"]')?.content || ""));
    names.push(...namesFrom(document.querySelector('meta[name="author"]')?.content || ""));
    names.push(...namesFrom(document.querySelector('[itemprop="author"],[rel="author"],.author,.byline')?.innerText || ""));

    const uniq = (arr) => [...new Set(arr.map(clean).filter((x) => x && x.length > 1))].slice(0, 16);

    // Page text (B07): title, description, headings, selection, and the
    // readable text currently in the viewport (navigation and footers skipped).
    const SKIP = "nav, footer, aside, header nav, [role=navigation], [role=contentinfo], [role=banner] nav, [aria-hidden=true], .navbox, .sidebar, .menu, .cookie, #cookie, .ad, .ads";
    const meta = (sel) => document.querySelector(sel)?.content || "";
    const description = clean(meta('meta[name="description"]') || meta('meta[property="og:description"]'));
    const headings = [];
    for (const h of document.querySelectorAll("h1, h2, h3")) {
      if (h.closest(SKIP)) continue;
      const t = clean(h.innerText);
      if (t && t.length < 160) headings.push({ t, inView: inView(h), top: h.tagName === "H1" });
    }
    headings.sort((a, b) => (b.top - a.top) || (b.inView - a.inView));
    let text = "";
    for (const el of document.querySelectorAll("p, li, dd, blockquote, td, figcaption, h1, h2, h3, h4, article div:not(:has(*))")) {
      if (text.length > 6000) break;
      if (!inView(el) || el.closest(SKIP)) continue;
      const t = clean(el.innerText);
      if (t.length > 20) text += t + " . ";
    }
    const selection = clean(String(window.getSelection ? window.getSelection() : "")).slice(0, 600);
    return {
      url: location.href,
      title: document.title || "",
      description,
      headings: headings.slice(0, 20).map((h) => h.t),
      selection,
      text: text.slice(0, 6000),
      lang: document.documentElement.lang || "",
      names: uniq(names),
      mediaMeta: uniq(mediaMeta),
      mediaLinks: uniq(mediaLinks),
      viewport: true
    };
  })()`;
  try {
    return await tab.view.webContents.executeJavaScript(script, true);
  } catch (err) {
    return { url: tab.view.webContents.getURL(), title: tab.view.webContents.getTitle(), error: String(err) };
  }
}

// ---- Network layer (B12, B13) ----
// Every outbound request goes through getText(): results are cached for 30 min,
// identical requests in flight are shared, each host has a minimum gap between
// requests, at most 4 requests run at once, and every request times out.
const CACHE_TTL = 30 * 60 * 1000;
const CACHE_MAX = 500;
const HOST_GAP_MS = { "html.duckduckgo.com": 2500, default: 400 };
const MAX_PARALLEL = 4;
const cache = new Map();
const inflight = new Map();
const hostNext = new Map();
const providerCooldown = new Map(); // provider -> time it may be used again
let running = 0;
const waiting = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet(key, value) {
  cache.delete(key);
  cache.set(key, { at: Date.now(), value });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

async function slot() {
  if (running < MAX_PARALLEL) {
    running++;
    return;
  }
  await new Promise((r) => waiting.push(r));
  running++;
}

function release() {
  running--;
  const next = waiting.shift();
  if (next) next();
}

async function hostTurn(host) {
  const gap = HOST_GAP_MS[host] ?? HOST_GAP_MS.default;
  const now = Date.now();
  const at = Math.max(now, hostNext.get(host) || 0);
  hostNext.set(host, at + gap);
  if (at > now) await sleep(at - now);
}

async function getText(url, { headers = {}, maxBytes = 300000, timeout = 10000 } = {}) {
  const key = "GET " + url;
  const hit = cacheGet(key);
  if (hit) return hit;
  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    await slot();
    try {
      await hostTurn(new URL(url).hostname);
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, ...headers },
        redirect: "follow",
        signal: AbortSignal.timeout(timeout),
      });
      const text = (await res.text()).slice(0, maxBytes);
      const out = { ok: res.ok, status: res.status, url: res.url || url, text };
      if (res.ok) cacheSet(key, out);
      return out;
    } finally {
      release();
    }
  })();
  inflight.set(key, job);
  try {
    return await job;
  } finally {
    inflight.delete(key);
  }
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---- Search providers ----
// Each provider: async (query) => [{url, title, snippet, source, image?}]
// Phase 2 (B15) turns this into a pluggable list with Brave / SearXNG options.
async function ddgSearch(query) {
  if ((providerCooldown.get("ddg") || 0) > Date.now()) return [];
  const res = await getText("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query), {
    headers: { Accept: "text/html" },
  });
  const html = res.text;
  // DuckDuckGo answers rate-limited clients with HTTP 202 or a challenge page.
  if (res.status === 202 || res.status === 403 || /anomaly-modal|challenge-form/i.test(html)) {
    providerCooldown.set("ddg", Date.now() + 10 * 60 * 1000);
    cache.delete("GET https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query));
    return [];
  }
  const results = [];
  const re =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/)/gi;
  let m;
  while ((m = re.exec(html)) && results.length < 8) {
    let href = decodeEntities(m[1]);
    try {
      const u = new URL(href, "https://duckduckgo.com/");
      href = u.pathname === "/l/" && u.searchParams.get("uddg") ? u.searchParams.get("uddg") : u.href;
    } catch (_) {}
    if (/duckduckgo\.com\/y\.js/.test(href)) continue; // ads
    results.push({ url: href, title: decodeEntities(m[2]), snippet: decodeEntities(m[3] || ""), source: "search" });
  }
  return results;
}

async function wikiSearch(query) {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=" +
    encodeURIComponent(query) +
    "&gsrlimit=5&prop=pageimages|extracts|info&inprop=url&exintro=1&explaintext=1&exchars=300&pithumbsize=640&format=json";
  const res = await getText(url);
  const data = JSON.parse(res.text || "{}");
  const pages = Object.values(data.query?.pages || {});
  pages.sort((a, b) => (a.index || 0) - (b.index || 0));
  return pages.map((p) => ({
    url: p.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
    title: p.title,
    snippet: (p.extract || "").slice(0, 220),
    source: "wiki",
    image: p.thumbnail?.source || "",
    kind: p.thumbnail?.source ? "image" : "page",
  }));
}

function sameUrl(a, b) {
  const norm = (u) => String(u || "").replace(/#.*$/, "").replace(/\/$/, "").replace(/^http:/, "https:");
  return norm(a) === norm(b);
}

// Run several queries against the providers and merge the lists round-robin,
// so each query and each provider gets a share of the top results.
async function runQueries(queries, excludeUrl) {
  const jobs = [];
  queries.forEach((q, i) => {
    jobs.push(wikiSearch(q).then((r) => r.map((x) => ({ ...x, query: q }))));
    if (i < 2) jobs.push(ddgSearch(q).then((r) => r.map((x) => ({ ...x, query: q }))));
  });
  const lists = (await Promise.allSettled(jobs)).map((r) => (r.status === "fulfilled" ? r.value : []));
  const merged = [];
  const seen = new Set();
  for (let i = 0; merged.length < 12 && lists.some((l) => l.length > i); i++) {
    for (const list of lists) {
      const item = list[i];
      if (!item?.url || !item.title) continue;
      const key = item.url.replace(/#.*$/, "").replace(/\/$/, "");
      if (seen.has(key) || sameUrl(item.url, excludeUrl)) continue;
      if (/wikipedia\.org\/wiki\/(Main_Page|Special:)/.test(item.url)) continue;
      seen.add(key);
      merged.push(item);
      if (merged.length >= 12) break;
    }
  }
  const notes = [];
  if ((providerCooldown.get("ddg") || 0) > Date.now()) notes.push("Web search is rate-limited for a few minutes; showing Wikipedia only.");
  return { results: merged, notes };
}

// Legacy entry point (Tauri bridge and manual keyword list): one query from the list.
async function suggest(keywords, excludeUrl) {
  const words = Array.isArray(keywords) ? keywords : String(keywords || "").split(/\s+/);
  const queries = buildQueries({ pinned: [], ranked: words.filter(Boolean) });
  if (!queries.length) return { keywords: [], results: [], queries: [] };
  const { results, notes } = await runQueries(queries, excludeUrl);
  return { keywords: words.slice(0, 8), results, queries, notes };
}

// Main entry point (B09): pinned keywords + ranked terms -> short queries -> results.
async function suggestFor({ pinned = [], ranked = [], title = "", excludeUrl = "" } = {}) {
  const queries = buildQueries({ pinned, ranked, title });
  if (!queries.length) return { results: [], queries: [], notes: [] };
  const { results, notes } = await runQueries(queries, excludeUrl);
  return { results, queries, notes };
}

// Session-wide document frequency, so words that appear on every page lose weight.
const sessionDF = new SessionDF();

async function pageKeywords(id, banned = []) {
  const page = await extractPage(id);
  if (!page || page.error) return { page, ranked: [] };
  const ranked = rankTerms(page, { df: sessionDF, banned, limit: 12 });
  return { page: { url: page.url, title: page.title, selection: page.selection }, ranked };
}

function youtubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("/")[0];
    if (u.hostname.includes("youtube.com")) return u.searchParams.get("v") || "";
  } catch (_) {}
  return "";
}

function youtubeThumb(url) {
  const id = youtubeId(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : "";
}

function isMediaUrl(url) {
  return /\.(mp4|webm|ogg|ogv|mov|m4v|mp3|wav)(\?|$)/i.test(url || "");
}

function isJunkMedia(url) {
  const u = (url || "").toLowerCase();
  return (
    !u ||
    u.startsWith("data:image/svg") ||
    u.startsWith("data:image/gif") ||
    /sprite|pixel|tracking|1x1|spacer|blank|placeholder|icon[-_]?|favicon|logo[-_.]|avatar|emoji|badge|spinner|loading\.gif/.test(u)
  );
}

function absUrl(href, base) {
  try {
    return new URL(href, base).href;
  } catch (_) {
    return "";
  }
}

function scoreMedia(item, keywords) {
  let score = item.base || 0;
  const hay = `${item.src} ${item.alt || ""} ${item.poster || ""}`.toLowerCase();
  for (const k of keywords || []) {
    if (k && hay.includes(String(k).toLowerCase())) score += 28;
  }
  if (item.w && item.h) {
    score += Math.min(40, Math.log((item.w * item.h) / 1000 + 1) * 8);
    if (item.w < 64 || item.h < 64) score -= 40;
  }
  if (item.kind === "video") score += 18;
  return score;
}

function collectMedia(html, pageUrl, keywords) {
  const found = [];
  const push = (src, extra = {}) => {
    if (!src) return;
    const abs = absUrl(decodeEntities(src), pageUrl);
    if (!abs || isJunkMedia(abs)) return;
    found.push({ src: abs, ...extra });
  };

  const meta = (re, base = 80) => {
    const reG = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m;
    while ((m = reG.exec(html))) push(m[1], { base, kind: extraKind(m[1]) });
  };
  const extraKind = (s) => (isMediaUrl(s) ? "video" : "image");

  meta(/<meta[^>]+property=["']og:image(?::url|:secure_url)?["'][^>]+content=["']([^"']+)/gi, 90);
  meta(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)/gi, 85);
  meta(/<meta[^>]+property=["']og:video(?::url|:secure_url)?["'][^>]+content=["']([^"']+)/gi, 88);
  meta(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)/gi, 70);

  const jsonBlocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const block of jsonBlocks) {
    const raw = block.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "");
    try {
      const data = JSON.parse(raw);
      const walk = (node) => {
        if (!node) return;
        if (Array.isArray(node)) return node.forEach(walk);
        if (typeof node === "string") {
          if (/\.(jpe?g|png|webp|gif|avif|mp4|webm)(\?|$)/i.test(node)) push(node, { base: 72, kind: extraKind(node) });
          return;
        }
        if (typeof node !== "object") return;
        for (const key of ["image", "thumbnail", "thumbnailUrl", "contentUrl", "poster"]) {
          if (node[key]) walk(node[key]);
        }
        if (node["@graph"]) walk(node["@graph"]);
      };
      walk(data);
    } catch (_) {}
  }

  const imgRe = /<img\b([^>]*)>/gi;
  let im;
  while ((im = imgRe.exec(html))) {
    const attrs = im[1];
    const get = (n) => {
      const m = attrs.match(new RegExp(n + "=[\"']([^\"']+)", "i"));
      return m ? m[1] : "";
    };
    const srcset = get("srcset") || get("data-srcset");
    const src = get("src") || get("data-src") || get("data-lazy-src") || get("data-original");
    let best = src;
    if (srcset) {
      const parts = srcset.split(",").map((p) => p.trim().split(/\s+/));
      parts.sort((a, b) => parseInt(b[1] || "0", 10) - parseInt(a[1] || "0", 10));
      if (parts[0]?.[0]) best = parts[0][0];
    }
    push(best, {
      base: 40,
      kind: "image",
      alt: decodeEntities(get("alt") || get("title")),
      w: parseInt(get("width"), 10) || 0,
      h: parseInt(get("height"), 10) || 0,
    });
  }

  const vidRe = /<(?:video|source)\b([^>]*)>/gi;
  let vm;
  while ((vm = vidRe.exec(html))) {
    const attrs = vm[1];
    const get = (n) => {
      const m = attrs.match(new RegExp(n + "=[\"']([^\"']+)", "i"));
      return m ? m[1] : "";
    };
    const src = get("src") || get("data-src");
    const poster = get("poster");
    if (poster) push(poster, { base: 60, kind: "image", alt: "poster" });
    if (src && isMediaUrl(src)) push(src, { base: 75, kind: "video" });
  }

  const iframeRe = /<iframe\b([^>]*)>/gi;
  let ifr;
  while ((ifr = iframeRe.exec(html))) {
    const attrs = ifr[1];
    const sm = attrs.match(/src=["']([^"']+)/i);
    const src = sm ? sm[1] : "";
    const yt = youtubeThumb(absUrl(src, pageUrl));
    if (yt) push(yt, { base: 82, kind: "video" });
  }

  const ytPage = youtubeThumb(pageUrl);
  if (ytPage) push(ytPage, { base: 95, kind: "video" });

  const ranked = found
    .map((item) => ({ ...item, score: scoreMedia(item, keywords) }))
    .sort((a, b) => b.score - a.score);

  const seen = new Set();
  const unique = [];
  for (const item of ranked) {
    if (seen.has(item.src)) continue;
    seen.add(item.src);
    unique.push(item);
  }
  return unique;
}

async function preview(url, keywords = []) {
  const keys = Array.isArray(keywords) ? keywords : String(keywords || "").split(/\s+/).filter(Boolean);
  const quickImage = youtubeThumb(url);
  if (isMediaUrl(url)) {
    return { url, title: url, description: "", image: "", video: url, kind: "video" };
  }
  try {
    const res = await getText(url, { headers: { Accept: "text/html" }, maxBytes: 280000, timeout: 8000 });
    const html = res.text;
    const pick = (re) => {
      const m = html.match(re);
      return m ? decodeEntities(m[1]) : "";
    };
    const pageUrl = res.url || url;
    const media = collectMedia(html, pageUrl, keys);
    const topVideo = media.find((m) => m.kind === "video" && isMediaUrl(m.src));
    const topImage = media.find((m) => m.kind !== "video" || !isMediaUrl(m.src)) || media[0];
    const image = topImage?.src || quickImage;
    const video = topVideo?.src || "";
    return {
      url: pageUrl,
      title:
        pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) ||
        pick(/<title[^>]*>([\s\S]*?)<\/title>/i) ||
        url,
      description:
        pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i) ||
        pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i),
      image,
      video,
      kind: video ? "video" : image ? "image" : "page",
    };
  } catch (err) {
    return {
      url,
      title: url,
      description: "",
      image: quickImage,
      video: "",
      kind: quickImage ? "video" : "page",
      error: String(err.message || err),
    };
  }
}

// ---- Site permissions (B01) ----
// Camera, microphone, location, notifications and screen capture always ask.
// Decisions marked "remember" are stored per origin in userData/permissions.json.
const ALWAYS_ALLOW = new Set(["fullscreen", "clipboard-sanitized-write", "pointerLock"]);
const ASK = {
  media: "use your camera or microphone",
  geolocation: "know your location",
  notifications: "show notifications",
  "display-capture": "record your screen",
  "clipboard-read": "read your clipboard",
  midiSysex: "control MIDI devices",
};
let permissionStore = null;

function permissionsFile() {
  return path.join(app.getPath("userData"), "permissions.json");
}

function permissions() {
  if (!permissionStore) {
    try {
      permissionStore = JSON.parse(fs.readFileSync(permissionsFile(), "utf8"));
    } catch {
      permissionStore = {};
    }
  }
  return permissionStore;
}

function savePermissions() {
  try {
    fs.writeFileSync(permissionsFile(), JSON.stringify(permissionStore || {}, null, 2));
  } catch (_) {}
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function resetPermissions() {
  permissionStore = {};
  savePermissions();
}

function installPermissionHandlers(ses) {
  const pending = new Map();
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    if (ALWAYS_ALLOW.has(permission)) return cb(true);
    if (!ASK[permission]) return cb(false);
    const origin = originOf(details?.requestingUrl || wc.getURL());
    if (!origin || !win) return cb(false);
    const key = `${origin}|${permission}`;
    const stored = permissions()[key];
    if (stored === "allow") return cb(true);
    if (stored === "block") return cb(false);
    // One dialog per origin+permission at a time; later requests wait for it.
    if (pending.has(key)) return pending.get(key).push(cb);
    pending.set(key, [cb]);
    dialog
      .showMessageBox(win, {
        type: "question",
        buttons: ["Block", "Allow"],
        defaultId: 0,
        cancelId: 0,
        message: `${new URL(origin).host} wants to ${ASK[permission]}.`,
        detail: origin,
        checkboxLabel: "Remember for this site",
        checkboxChecked: true,
      })
      .then(({ response, checkboxChecked }) => {
        const allow = response === 1;
        if (checkboxChecked) {
          permissions()[key] = allow ? "allow" : "block";
          savePermissions();
        }
        for (const fn of pending.get(key) || []) fn(allow);
        pending.delete(key);
      })
      .catch(() => {
        for (const fn of pending.get(key) || []) fn(false);
        pending.delete(key);
      });
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (ALWAYS_ALLOW.has(permission)) return true;
    if (ASK[permission]) return permissions()[`${requestingOrigin}|${permission}`] === "allow";
    return true;
  });
}

// ---- Menu and shortcuts (B02) ----
// Menu accelerators fire no matter which tab or panel has focus.
function sendUi(cmd, extra = {}) {
  win?.webContents.send("ui:command", { cmd, ...extra });
}

function activeWc() {
  return tabs.get(activeId)?.view.webContents || null;
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Tab",
          accelerator: "CmdOrCtrl+T",
          click: () => {
            createTab(HOME_URL);
            sendUi("focus-omni");
          },
        },
        { label: "Close Tab", accelerator: "CmdOrCtrl+W", click: () => activeId && closeTab(activeId) },
        { label: "Open Location", accelerator: "CmdOrCtrl+L", click: () => sendUi("focus-omni") },
        { type: "separator" },
        { label: "Screenshot Tab", accelerator: "CmdOrCtrl+Shift+S", click: () => runShotFromMain(activeId) },
        { label: "Reset Site Permissions", click: resetPermissions },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => activeWc()?.reload() },
        {
          label: "Back",
          accelerator: "CmdOrCtrl+[",
          click: () => activeWc()?.canGoBack() && activeWc().goBack(),
        },
        {
          label: "Forward",
          accelerator: "CmdOrCtrl+]",
          click: () => activeWc()?.canGoForward() && activeWc().goForward(),
        },
        { label: "Toggle Mosaic", accelerator: "CmdOrCtrl+Shift+M", click: () => sendUi("toggle-layout") },
        {
          label: "Mute or Unmute Tab",
          accelerator: "CmdOrCtrl+Shift+U",
          click: () => {
            const tab = tabs.get(activeId);
            if (!tab) return;
            tab.audio = tab.view.webContents.isAudioMuted() ? "on" : "off";
            applyAudio();
            emitList();
          },
        },
        { type: "separator" },
        { label: "Developer Tools for Page", accelerator: "CmdOrCtrl+Alt+I", click: () => activeWc()?.toggleDevTools() },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function shotTab(id) {
  const tab = tabs.get(id) || tabs.get(activeId);
  if (!tab) throw new Error("No tab");
  const image = await tab.view.webContents.capturePage();
  const name = stamp("shot", "png");
  const file = path.join(libraryRoot(), "screenshots", name);
  fs.writeFileSync(file, image.toPNG());
  return addRecord("screenshots", name, tab.view.webContents.getURL(), tab.view.webContents.getTitle());
}

async function runShotFromMain(id) {
  try {
    const item = await shotTab(id);
    sendUi("shot-done", { item });
  } catch (err) {
    sendUi("error", { message: String(err.message || err) });
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#121212",
    title: "Scout",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.on("resize", applyLayout);
  win.webContents.on("did-finish-load", () => {
    if (!tabs.size) createTab(HOME_URL);
  });
}

protocol.registerSchemesAsPrivileged([
  { scheme: "scoutlib", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
]);

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-features", "PreloadMediaEngagementData");

app.whenReady().then(() => {
  protocol.handle("scoutlib", (request) => {
    try {
      const id = new URL(request.url).hostname;
      const item = readIndex().find((row) => row.id === id);
      if (!item || !fs.existsSync(item.file)) return new Response("missing", { status: 404 });
      return net.fetch(require("url").pathToFileURL(item.file).toString());
    } catch (err) {
      return new Response(String(err), { status: 400 });
    }
  });
  installPermissionHandlers(session.defaultSession);
  buildMenu();
  createWindow();
});

app.on("window-all-closed", () => app.quit());

ipcMain.handle("tab:create", (_e, url) => createTab(url));
ipcMain.handle("tab:close", (_e, id) => closeTab(id));
ipcMain.handle("tab:activate", (_e, id) => activateTab(id));
ipcMain.handle("tab:navigate", (_e, id, url) => {
  const tab = tabs.get(id);
  if (!tab) return;
  tab.view.webContents.loadURL(normalizeUrl(url));
});
ipcMain.handle("tab:back", (_e, id) => {
  const t = tabs.get(id);
  if (t?.view.webContents.canGoBack()) t.view.webContents.goBack();
});
ipcMain.handle("tab:forward", (_e, id) => {
  const t = tabs.get(id);
  if (t?.view.webContents.canGoForward()) t.view.webContents.goForward();
});
ipcMain.handle("tab:reload", (_e, id) => tabs.get(id)?.view.webContents.reload());
ipcMain.handle("layout:set", (_e, mode) => {
  layout = mode === "mosaic" ? "mosaic" : "focus";
  applyLayout();
  return layout;
});
ipcMain.handle("layout:sidebar", (_e, w) => {
  sidebarWidth = Math.max(160, Math.min(360, Number(w) || SIDEBAR_DEFAULT));
  applyLayout();
});
ipcMain.handle("layout:library", (_e, open) => {
  libraryOpen = Boolean(open);
  applyLayout();
  return libraryOpen;
});
ipcMain.on("tab:clicked", (_e, id) => {
  const tab = tabs.get(String(id));
  if (!tab) return;
  tab.lastGesture = Date.now();
  if (activeId !== tab.id) activateTab(tab.id);
});
// Plain-key shortcuts pressed inside a web page (sent by view-preload.js only
// when focus is not in a text field).
ipcMain.on("tab:hotkey", (_e, id, key) => {
  if (key === "shot" && tabs.has(String(id))) runShotFromMain(String(id));
});
ipcMain.handle("tab:audio", (_e, id) => {
  const tab = tabs.get(id);
  if (!tab) return null;
  tab.audio = tab.view.webContents.isAudioMuted() ? "on" : "off";
  applyAudio();
  emitList();
  return tab.audio;
});
ipcMain.handle("tab:audio-reset", (_e, id) => {
  const tab = tabs.get(id);
  if (!tab) return null;
  tab.audio = "auto";
  applyAudio();
  emitList();
  return tab.audio;
});
ipcMain.handle("page:extract", (_e, id) => extractPage(id));
ipcMain.handle("suggest:search", (_e, keywords, excludeUrl) => suggest(keywords, excludeUrl));
ipcMain.handle("suggest:for", (_e, payload) => suggestFor(payload));
ipcMain.handle("page:keywords", (_e, id, banned) => pageKeywords(id, banned));
ipcMain.handle("suggest:preview", (_e, url, keywords) => preview(url, keywords));

function libraryRoot() {
  const root = path.join(app.getPath("userData"), "library");
  for (const folder of ["screenshots", "saves", "media"]) {
    fs.mkdirSync(path.join(root, folder), { recursive: true });
  }
  return root;
}

function indexPath() {
  return path.join(libraryRoot(), "index.json");
}

function readIndex() {
  try {
    return JSON.parse(fs.readFileSync(indexPath(), "utf8"));
  } catch {
    return [];
  }
}

function writeIndex(rows) {
  fs.writeFileSync(indexPath(), JSON.stringify(rows, null, 2));
}

function stamp(prefix, ext) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${prefix}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}

function addRecord(folder, name, sourceUrl, note) {
  const rows = readIndex();
  const item = {
    id: String(Date.now()),
    folder,
    name,
    file: path.join(libraryRoot(), folder, name),
    sourceUrl: sourceUrl || "",
    note: note || "",
    created: Date.now(),
  };
  rows.unshift(item);
  writeIndex(rows);
  return item;
}

// File extension from the server's content-type first, then the URL (B05).
const MIME_EXT = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/ogg": "ogv",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

function extensionFor(contentType, url, kind) {
  const mime = contentType.split(";")[0].trim().toLowerCase();
  if (MIME_EXT[mime]) return MIME_EXT[mime];
  const fromUrl = (String(url).split(/[?#]/)[0].match(/\.([a-z0-9]{2,4})$/i) || [])[1];
  if (fromUrl) return fromUrl.toLowerCase();
  return kind === "video" ? "mp4" : "jpg";
}

ipcMain.handle("library:root", () => libraryRoot());
ipcMain.handle("library:list", () =>
  readIndex().map((item) => ({
    ...item,
    mediaUrl: `scoutlib://${item.id}/file`,
    kind: /\.(mp4|webm|ogv|mov|m4v)$/i.test(item.name)
      ? "video"
      : /\.(mp3|m4a|wav|ogg)$/i.test(item.name)
        ? "audio"
        : /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(item.name)
          ? "image"
          : "file",
  }))
);
ipcMain.handle("library:remove", (_e, id) => {
  const rows = readIndex();
  const item = rows.find((row) => row.id === id);
  if (item && fs.existsSync(item.file)) fs.unlinkSync(item.file);
  writeIndex(rows.filter((row) => row.id !== id));
  return true;
});
ipcMain.handle("library:open-folder", () => shell.openPath(libraryRoot()));
ipcMain.handle("library:reveal", (_e, file) => {
  if (file && fs.existsSync(file)) shell.showItemInFolder(file);
});

ipcMain.handle("library:shot", (_e, id) => shotTab(id));

ipcMain.handle("library:save", async (_e, id) => {
  const tab = tabs.get(id) || tabs.get(activeId);
  if (!tab) throw new Error("No tab");
  const page = await extractPage(tab.id);
  const name = stamp("page", "json");
  const file = path.join(libraryRoot(), "saves", name);
  const payload = {
    title: tab.view.webContents.getTitle(),
    url: tab.view.webContents.getURL(),
    names: page?.names || [],
    mediaMeta: page?.mediaMeta || [],
    mediaLinks: page?.mediaLinks || [],
    savedAt: new Date().toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return addRecord("saves", name, payload.url, payload.title);
});

ipcMain.handle("library:grab", async (_e, id, explicitUrl) => {
  const tab = tabs.get(id) || tabs.get(activeId);
  if (!tab) throw new Error("No tab");
  const found = explicitUrl
    ? { url: explicitUrl, kind: "file" }
    : await tab.view.webContents.executeJavaScript(`(() => {
        const abs = (u) => { try { return new URL(u, location.href).href; } catch (e) { return ""; } };
        const videos = [...document.querySelectorAll("video")];
        const v = videos.find((el) => el.currentSrc || el.src);
        if (v) return { url: abs(v.currentSrc || v.src), kind: "video" };
        const og = document.querySelector('meta[property="og:image"],meta[name="twitter:image"]')?.content;
        const imgs = [...document.querySelectorAll("img")].map((img) => ({
          url: abs(img.currentSrc || img.src || img.getAttribute("data-src") || ""),
          area: (img.naturalWidth || img.clientWidth || 0) * (img.naturalHeight || img.clientHeight || 0)
        })).filter((x) => x.url && !x.url.startsWith("data:") && x.area >= 1600);
        imgs.sort((a, b) => b.area - a.area);
        if (imgs[0]) return { url: imgs[0].url, kind: "image" };
        if (og) return { url: abs(og), kind: "image" };
        const file = document.querySelector(".fullImageLink a, a.internal")?.href;
        if (file && /\\.(svg|png|jpe?g|gif|webp|mp4|webm)(\\?|$)/i.test(file)) return { url: file, kind: "image" };
        return null;
      })()`, true);
  if (!found?.url) throw new Error("No downloadable media on this page");
  if (found.url.startsWith("blob:")) {
    throw new Error("This site streams its video in pieces (blob URL), so it can't be saved as one file. Use Shot instead.");
  }
  if (found.url.startsWith("data:")) throw new Error("This media is embedded inline and has no file to download.");
  if (/\.(m3u8|mpd)(\?|$)/i.test(found.url)) {
    throw new Error("This is a streaming playlist (HLS/DASH), not a single file, so it can't be saved.");
  }
  const res = await fetch(found.url, { headers: { "User-Agent": USER_AGENT, Referer: tab.view.webContents.getURL() } });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = extensionFor(res.headers.get("content-type") || "", found.url, found.kind);
  const name = stamp("media", ext.toLowerCase());
  const file = path.join(libraryRoot(), "media", name);
  fs.writeFileSync(file, buf);
  return addRecord("media", name, tab.view.webContents.getURL(), found.url);
});

