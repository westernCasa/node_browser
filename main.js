const { app, BrowserWindow, BrowserView, ipcMain, session, shell, protocol, net } = require("electron");
const path = require("path");
const fs = require("fs");
const { URL } = require("url");

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
        tab.view.setBackgroundColor("#111111");
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
  };
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
  wc.setWindowOpenHandler(({ url }) => {
    createTab(url);
    return { action: "deny" };
  });
}

function createTab(url) {
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
  view.webContents.setUserAgent(USER_AGENT);
  const tab = { id, view };
  tabs.set(id, tab);
  win.addBrowserView(view);
  attachListeners(tab);
  activeId = id;
  view.webContents.loadURL(normalizeUrl(url));
  applyLayout();
  emit({ type: "list", tabs: [...tabs.values()].map(tabState), activeId });
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
  if (!activeId) createTab("https://en.wikipedia.org/wiki/Main_Page");
  applyLayout();
  emit({ type: "list", tabs: [...tabs.values()].map(tabState), activeId });
}

function activateTab(id) {
  if (!tabs.has(id)) return;
  activeId = id;
  applyLayout();
  emit({ type: "list", tabs: [...tabs.values()].map(tabState), activeId });
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
    return {
      url: location.href,
      title: document.title || "",
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

function keywordize(page, extra = []) {
  const stop = new Set(
    "a an the and or of to in on for with from by as at is are was were be this that these those it its into over about after before between than then so if but not no yes you your we they he she their our my page wikipedia free encyclopedia search home skip content official site www com org net".split(
      " "
    )
  );
  const blob = [
    page?.title,
    page?.description,
    page?.keywords,
    page?.selection,
    ...(page?.headings || []),
    ...(extra || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9+#.\-\s]/g, " ");

  const counts = new Map();
  for (const raw of blob.split(/\s+/)) {
    const w = raw.replace(/^\.+|\.+$/g, "");
    if (w.length < 3 || stop.has(w) || /^\d+$/.test(w)) continue;
    counts.set(w, (counts.get(w) || 0) + (w.length > 6 ? 2 : 1));
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w);
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function ddgSearch(query) {
  const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  const html = await res.text();
  const results = [];
  const re =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/)/gi;
  let m;
  while ((m = re.exec(html)) && results.length < 8) {
    let href = decodeEntities(m[1]);
    try {
      const u = new URL(href, "https://duckduckgo.com/");
      if (u.pathname === "/l/" && u.searchParams.get("uddg")) {
        href = u.searchParams.get("uddg");
      } else {
        href = u.href;
      }
    } catch (_) {}
    results.push({
      url: href,
      title: decodeEntities(m[2]),
      snippet: decodeEntities(m[3] || ""),
      source: "search",
    });
  }
  if (results.length) return results;

  const alt = /<a rel="nofollow" class="result-link" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = alt.exec(html)) && results.length < 8) {
    results.push({
      url: decodeEntities(m[1]),
      title: decodeEntities(m[2]),
      snippet: "",
      source: "search",
    });
  }
  return results;
}

async function wikiSearch(query) {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=" +
    encodeURIComponent(query) +
    "&gsrlimit=5&prop=pageimages|extracts|info&inprop=url&exintro=1&explaintext=1&pithumbsize=640&format=json";
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  const data = await res.json();
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

async function suggest(keywords, excludeUrl) {
  const q = (Array.isArray(keywords) ? keywords.join(" ") : String(keywords || "")).trim();
  if (!q) return { keywords: [], results: [] };
  const [web, wiki] = await Promise.allSettled([ddgSearch(q), wikiSearch(q)]);
  const merged = [];
  const seen = new Set();
  const skip = (excludeUrl || "").replace(/\/$/, "");
  for (const item of [...(wiki.value || []), ...(web.value || [])]) {
    if (!item?.url || !item.title) continue;
    const key = item.url.replace(/\/$/, "");
    if (seen.has(key) || key === skip) continue;
    seen.add(key);
    merged.push(item);
  }
  return { keywords: q.split(/\s+/).filter(Boolean).slice(0, 8), results: merged.slice(0, 12) };
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
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      redirect: "follow",
    });
    const html = (await res.text()).slice(0, 280000);
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

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#121212",
    title: "Scout 3",
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
    if (!tabs.size) createTab("https://en.wikipedia.org/wiki/Main_Page");
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
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === "media" || permission === "fullscreen");
  });
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
  if (id && tabs.has(String(id))) activateTab(String(id));
});
ipcMain.handle("page:extract", (_e, id) => extractPage(id));
ipcMain.handle("suggest:search", (_e, keywords, excludeUrl) => suggest(keywords, excludeUrl));
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

ipcMain.handle("library:root", () => libraryRoot());
ipcMain.handle("library:list", () =>
  readIndex().map((item) => ({
    ...item,
    mediaUrl: `scoutlib://${item.id}/file`,
    kind: /\.(mp4|webm|mov|m4v)$/i.test(item.name)
      ? "video"
      : /\.(mp3|m4a|wav)$/i.test(item.name)
        ? "audio"
        : /\.(png|jpe?g|gif|webp|svg)$/i.test(item.name)
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

ipcMain.handle("library:shot", async (_e, id) => {
  const tab = tabs.get(id) || tabs.get(activeId);
  if (!tab) throw new Error("No tab");
  const image = await tab.view.webContents.capturePage();
  const name = stamp("shot", "png");
  const file = path.join(libraryRoot(), "screenshots", name);
  fs.writeFileSync(file, image.toPNG());
  const url = tab.view.webContents.getURL();
  const title = tab.view.webContents.getTitle();
  return addRecord("screenshots", name, url, title);
});

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
  if (!found?.url || found.url.startsWith("blob:") || found.url.startsWith("data:")) {
    throw new Error("No downloadable media on this page");
  }
  const res = await fetch(found.url, { headers: { "User-Agent": USER_AGENT, Referer: tab.view.webContents.getURL() } });
  if (!res.ok) throw new Error("Download failed");
  const buf = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get("content-type") || "";
  const fromUrl = (found.url.split("?")[0].match(/\.([a-z0-9]{2,4})$/i) || [])[1];
  const ext = found.kind === "video" ? "mp4" : fromUrl || (type.includes("png") ? "png" : type.includes("svg") ? "svg" : type.includes("webp") ? "webp" : "jpg");
  const name = stamp("media", ext.toLowerCase());
  const file = path.join(libraryRoot(), "media", name);
  fs.writeFileSync(file, buf);
  return addRecord("media", name, tab.view.webContents.getURL(), found.url);
});

exports.keywordize = keywordize;
