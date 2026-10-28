const api = window.scout || null;

const tabsEl = document.getElementById("tabs");
let starUrl = ""; // address the bookmark star was last painted for
let omniTyping = false; // the user has typed in the address bar since the last navigation
let omniTabId = null;
// Double-click the empty part of the tab bar to open a new tab.
tabsEl.addEventListener("dblclick", (e) => {
  if (e.target !== tabsEl) return;
  document.getElementById("new-tab").click();
});
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
// Keywords hidden with ×, per site ("*" = every site: lists saved before
// hiding became per site).
let hiddenBySite = store.get("node.hiddenBySite", null);
if (!hiddenBySite) {
  const old = store.get("scout.banned", []);
  hiddenBySite = old.length ? { "*": old } : {};
  store.set("node.hiddenBySite", hiddenBySite);
}
const siteOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch (_) {
    return "";
  }
};
const activeSite = () => siteOf(tabs.find((t) => t.id === activeId)?.url || "");
let banned = [];
function refreshBanned() {
  banned = [...new Set([...(hiddenBySite["*"] || []), ...(hiddenBySite[activeSite()] || [])])];
  return banned;
}
function saveHidden() {
  for (const k of Object.keys(hiddenBySite)) if (!hiddenBySite[k]?.length) delete hiddenBySite[k];
  store.set("node.hiddenBySite", hiddenBySite);
  refreshBanned();
  if (typeof renderHiddenList === "function") renderHiddenList();
}
function hideKeyword(term) {
  api?.usageCount?.("hides");
  const site = activeSite() || "*";
  hiddenBySite[site] = [...new Set([...(hiddenBySite[site] || []), lower(term)])];
  saveHidden();
}
function unhideKeyword(term, site = null) {
  for (const k of site ? [site] : Object.keys(hiddenBySite)) hiddenBySite[k] = (hiddenBySite[k] || []).filter((b) => b !== lower(term));
  saveHidden();
}
let auto = []; // ranked terms from the page: [{term, score, kind}]
let autoOn = store.get("scout.auto", true);
let fromTopic = false; // keywords came from the running topic (thin page)
let lastCrawl = { at: 0, url: "", terms: [], selection: "" };
const RECRAWL_GAP_MS = 20000; // B11: minimum time between automatic searches
const AUTO_SHOWN = 8;

const lower = (s) => String(s).toLowerCase();
const isPinned = (t) => pinned.some((p) => lower(p) === lower(t));
const isBanned = (t) => refreshBanned().includes(lower(t));

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
  if (typeof tourCheck === "function") setTimeout(tourCheck, 0);
  paintShield();
  renderRuleLine();
  paintAgentButtons();
  if (typeof loadTalk === "function" && talkOpen) loadTalk();
  if (typeof paintStar === "function" && (tabs.find((t) => t.id === activeId)?.url || "") !== starUrl) paintStar();
  renderZoom();
  // Find bar open while switching tabs: clear the old tab, search the new one.
  if (typeof findbar !== "undefined" && !findbar.hidden && findTabId && findTabId !== activeId) {
    api.findStop(findTabId);
    runFind(true, false);
  }
  tabsEl.innerHTML = "";
  for (const t of tabs) {
    const el = document.createElement("div");
    el.className = "tab" + (t.id === activeId ? " active" : "") + (t.sleeping ? " asleep" : "") + (t.audible && !t.muted ? " playing" : "") + (typeof mosaicShown !== "undefined" && mosaicShown.includes(t.id) ? " in-mosaic" : "");
    if (t.sleeping) el.title = "Asleep to save memory. Opens again when you click it.";
    // The monogram shows only in the sidebar layout (the rail shows nothing else).
    el.innerHTML = `<span class="mono" aria-hidden="true">${escapeHtml(monogram(t.title, t.url))}</span><span title="${escapeHtml(t.url || "")}">${escapeHtml(t.title || "New tab")}</span>`;
    if (document.body.classList.contains("sb-rail")) el.title = `${t.title || "New tab"}${t.sleeping ? " · asleep" : ""}${t.audible && !t.muted ? " · playing" : ""}`;
    if (t.tile) {
      // Chosen for Mosaic (B69).
      const m = document.createElement("i");
      m.className = "tile-mark";
      m.innerHTML = icon("mosaic");
      m.title = "Shown in Mosaic. Right-click to remove.";
      el.appendChild(m);
    }
    if (t.loop) {
      // A section of the video loops (B70). Click to stop.
      const lp = document.createElement("button");
      lp.className = "loop-mark";
      lp.textContent = "↻ " + t.loop.label;
      lp.title = `Looping ${t.loop.label}. Click to stop.`;
      lp.setAttribute("aria-label", `Looping ${t.loop.label}. Stop looping`);
      lp.addEventListener("click", (e) => {
        e.stopPropagation();
        api?.loopTab?.(t.id, "stop");
      });
      el.appendChild(lp);
    }
    if (t.agentShared) {
      const m = document.createElement("i");
      m.className = "agent-mark";
      m.textContent = "◆";
      m.title = "Shared with AI agents";
      el.appendChild(m);
    }
    if (t.pausedByLimit) {
      const p = document.createElement("i");
      p.className = "limit";
      p.textContent = "⏸";
      p.title = "Paused: media was already playing in 4 other tabs. Open this tab to resume it.";
      el.appendChild(p);
    }
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
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      api?.tabMenu?.(t.id, e.clientX, e.clientY);
    });
    // Middle-click closes the tab (as in Chrome, Firefox and Safari).
    el.addEventListener("auxclick", (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      api ? api.closeTab(t.id) : demoClose(t.id);
    });
    el.addEventListener("mousedown", (e) => e.button === 1 && e.preventDefault()); // no autoscroll icon
    // Drag a tab to reorder it.
    el.draggable = true;
    el.dataset.id = t.id;
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/scout-tab", t.id);
      e.dataTransfer.effectAllowed = "move";
      el.classList.add("dragging");
    });
    el.addEventListener("dragend", () => el.classList.remove("dragging"));
    el.addEventListener("dragover", (e) => {
      if (!e.dataTransfer.types.includes("text/scout-tab")) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const after = document.body.classList.contains("side") ? e.clientY >= r.top + r.height / 2 : e.clientX >= r.left + r.width / 2;
      el.classList.toggle("drop-before", !after);
      el.classList.toggle("drop-after", after);
    });
    el.addEventListener("dragleave", () => el.classList.remove("drop-before", "drop-after"));
    el.addEventListener("drop", (e) => {
      const id = e.dataTransfer.getData("text/scout-tab");
      el.classList.remove("drop-before", "drop-after");
      if (!id || id === t.id) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const order = tabs.map((x) => x.id).filter((x) => x !== id);
      const after = document.body.classList.contains("side") ? e.clientY >= r.top + r.height / 2 : e.clientX >= r.left + r.width / 2;
      let at = order.indexOf(t.id) + (after ? 1 : 0);
      order.splice(at, 0, id);
      api?.moveTabs?.(order);
    });
    tabsEl.appendChild(el);
  }
  if (typeof paintSide === "function") paintSide();
  const current = tabs.find((t) => t.id === activeId);
  // The address bar shows the page's real address, except while the user is
  // typing in it. After Enter (or picking a suggestion) it follows the page again.
  if (activeId !== omniTabId) {
    omniTabId = activeId; // switching tabs drops what was typed for the old tab
    omniTyping = false;
  }
  if (current && (!omniTyping || document.activeElement !== omni)) {
    if (omni.value !== (current.url || "")) omni.value = current.url || "";
    omniTyping = false;
  }
}

// ---- 06 Keyword chips ----
// Chips are kept, one per keyword, instead of being rebuilt on every change, so
// they can move from their old place to their new one. Their visual order comes
// from the CSS `order` property while they move; the page order is tidied up
// once they stop. Changes run one after another (a fast second click waits).
const keyChips = new Map(); // lower-case keyword -> chip element
let keysQueue = Promise.resolve();
const rootStyle = () => getComputedStyle(document.documentElement);
const motionMs = (name) => parseFloat(rootStyle().getPropertyValue(name)) || 0; // "200ms" -> 200
const motionCurve = (name) => rootStyle().getPropertyValue(name).trim();
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function makeKeyChip() {
  const el = document.createElement("span");
  el.className = "key";
  const label = document.createElement("span");
  label.className = "label";
  const btn = document.createElement("button");
  btn.textContent = "×";
  el.append(label, btn);
  el.addEventListener("click", () => {
    const term = el.__term;
    if (isPinned(term)) pinned = pinned.filter((p) => lower(p) !== lower(term));
    else {
      pinned = [...pinned, term];
      api?.usageCount?.("pins");
    }
    renderKeys({ animate: true });
    crawl();
  });
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const term = el.__term;
    if (isPinned(term)) pinned = pinned.filter((p) => lower(p) !== lower(term));
    else hideKeyword(term);
    renderKeys({ animate: true });
    crawl();
  });
  return el;
}

// Puts the chips in page order to match what is on screen, then clears `order`
// (so keyboard Tab order matches the visual order again).
function tidyKeyChips() {
  const els = [...keyChips.values()].sort((a, b) => Number(a.style.order) - Number(b.style.order));
  for (const el of els) {
    keysEl.appendChild(el);
    el.style.order = "";
  }
}

async function drawKeys(animate) {
  const reduced = reducedMotion();
  const fast = motionMs("--motion-fast");
  const base = motionMs("--motion-base");
  const want = [...pinned.map((t) => ({ term: t, pin: true })), ...autoTerms().slice(0, AUTO_SHOWN).map((t) => ({ term: t, pin: false }))];
  const wantKeys = new Set(want.map((w) => lower(w.term)));
  const leaving = [...keyChips].filter(([k]) => !wantKeys.has(k));

  // Which × had keyboard focus, by its place in the list.
  const focusedChip = document.activeElement?.closest?.(".key");
  const focusIndex = focusedChip && keysEl.contains(focusedChip) ? [...keysEl.children].indexOf(focusedChip) : -1;

  // 1. A chip that is leaving fades and shrinks while still holding its place.
  if (animate && leaving.length) {
    const outs = leaving.map(([, el]) =>
      el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: reduced ? "none" : "scale(0.9)" }], { duration: fast, easing: motionCurve("--ease-exit"), fill: "forwards" }).finished
    );
    await Promise.all(outs).catch(() => {});
  }

  // 2. FLIP, "First": where every chip is now.
  const first = new Map([...keyChips].map(([k, el]) => [k, el.getBoundingClientRect()]));
  for (const [k, el] of leaving) {
    el.remove();
    keyChips.delete(k);
  }

  // Apply the new list: reuse chips, add new ones, set their order.
  const entering = [];
  want.forEach((w, i) => {
    const k = lower(w.term);
    let el = keyChips.get(k);
    if (!el) {
      el = makeKeyChip();
      keyChips.set(k, el);
      keysEl.appendChild(el);
      entering.push(el);
    }
    el.__term = w.term;
    el.classList.toggle("pinned", w.pin);
    el.querySelector(".label").textContent = (w.pin ? "📌 " : "") + w.term;
    el.title = w.pin ? "Pinned. Click to unpin." : "Click to pin. Pinned keywords go into every search.";
    el.querySelector("button").title = w.pin ? "Unpin" : "Hide this keyword";
    el.style.order = String(i);
  });

  // The × that had focus is gone: move focus to the × now in its place.
  const restoreFocus = () => {
    if (focusIndex < 0 || keysEl.contains(document.activeElement)) return;
    const sorted = [...keyChips.values()].sort((a, b) => Number(a.style.order) - Number(b.style.order));
    sorted[Math.min(focusIndex, sorted.length - 1)]?.querySelector("button")?.focus();
  };

  if (!animate) {
    tidyKeyChips();
    restoreFocus();
    return;
  }

  // 3. FLIP, "Last, Invert, Play": each chip starts drawn at its old place and
  // slides to the new one. Reduced motion: chips jump to their new places.
  const moves = [];
  if (!reduced) {
    for (const [k, el] of keyChips) {
      const f = first.get(k);
      if (!f) continue;
      const l = el.getBoundingClientRect();
      const dx = f.left - l.left;
      const dy = f.top - l.top;
      if (dx || dy) moves.push(el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: base, easing: motionCurve("--ease-move") }).finished);
    }
  }
  // New chips scale up from 0.95 and fade in.
  for (const el of entering) {
    moves.push(
      el.animate([{ opacity: 0, transform: reduced ? "none" : "scale(0.95)" }, { opacity: 1, transform: "none" }], { duration: reduced ? fast : base, easing: motionCurve("--ease-enter") }).finished
    );
  }
  restoreFocus();
  await Promise.all(moves).catch(() => {});
  tidyKeyChips();
}

// animate: true only for the user's own pin, unpin, hide and add.
function renderKeys({ animate = false } = {}) {
  // Pins belong to the current research session (B17). Only save once the
  // session has loaded, so the empty startup render cannot wipe saved pins.
  if (session) api?.researchPins?.(pinned);
  keysQueue = keysQueue.then(() => drawKeys(animate)).catch(() => {});
  renderHiddenKeys();
}

function renderHiddenKeys() {
  const hiddenEl = document.getElementById("hidden-keys");
  refreshBanned();
  hiddenEl.hidden = !banned.length;
  hiddenEl.innerHTML = "";
  if (banned.length) {
    const label = document.createElement("span");
    label.textContent = "Hidden on this site: " + banned.slice(-6).join(", ") + (banned.length > 6 ? ` +${banned.length - 6}` : "");
    const clear = document.createElement("button");
    clear.textContent = "Show all";
    clear.addEventListener("click", () => {
      delete hiddenBySite[activeSite()];
      delete hiddenBySite["*"];
      saveHidden();
      renderKeys();
      crawl();
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

// ---- Motion helpers (docs/motion) ----
// Adds a class that runs a CSS animation once, then removes it, so the
// animation does not play again when the element is redrawn or moved.
function playOnce(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth; // forces the browser to notice the removal, so the animation restarts
  el.classList.add(cls);
  el.addEventListener("animationend", () => el.classList.remove(cls), { once: true });
}

// 02: a card turns "read". animate: only when the user just opened it.
function markRead(card, animate = false) {
  card.classList.add("read");
  const src = card.querySelector(".src");
  if (!src || src.querySelector(".badge")) return;
  src.insertAdjacentHTML("beforeend", `<span class="badge">read</span>`);
  if (animate) playOnce(src.querySelector(".badge"), "is-new");
}

// Marks cards already read in this session and adds a dismiss button.
function decorateCard(card, item) {
  if (readUrls().has(item.url)) markRead(card);
  else card.classList.remove("read");
  if (card.__decorated || !api?.researchDismiss) return;
  card.__decorated = true;
  const x = document.createElement("button");
  x.className = "dismiss";
  x.title = "Not useful: hide this result for this session";
  x.textContent = "×";
  // 07: the card fades out, then the gap it leaves closes; only then is it
  // dismissed and removed (same order of calls as before, just later).
  x.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (card.__leaving) return;
    card.__leaving = true;
    const hadFocus = card.contains(document.activeElement);
    const reduced = reducedMotion();
    await card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: motionMs("--motion-fast"), easing: motionCurve("--ease-exit"), fill: "forwards" }).finished.catch(() => {});
    if (!reduced) {
      // Height is an agreed exception: the list has to close the gap.
      const gap = parseFloat(getComputedStyle(resultsEl).rowGap) || 0;
      card.style.overflow = "hidden";
      await card
        .animate(
          [
            { height: `${card.offsetHeight}px`, marginBottom: "0px" },
            { height: "0px", paddingTop: "0px", paddingBottom: "0px", borderTopWidth: "0px", borderBottomWidth: "0px", marginBottom: `${-gap}px` },
          ],
          { duration: motionMs("--motion-slow"), easing: motionCurve("--ease-move"), fill: "forwards" }
        )
        .finished.catch(() => {});
    }
    await api.researchDismiss(item.url);
    session?.dismissed.push(item.url);
    const next = card.nextElementSibling?.classList.contains("card") ? card.nextElementSibling : card.previousElementSibling;
    card.remove();
    if (hadFocus) next?.querySelector(".dismiss")?.focus();
  });
  card.prepend(x);
  for (const b of card.querySelectorAll(".card-actions button")) {
    b.addEventListener("click", () => {
      api.researchOpened?.(item);
      session?.opened.push({ url: item.url, title: item.title, query: item.query || "" });
      markRead(card, true);
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
  if (!items?.length) {
    resultsEl.innerHTML = `<p class="empty">No suggestions yet. Load a page, or add keywords and press Crawl.</p>`;
    return;
  }
  resultsEl.querySelector(".empty")?.remove();
  // 07: cards already on screen stay where they are in the page (moving them
  // would restart their animation); new cards fade in one after another.
  let fresh = 0;
  items.forEach((item, i) => {
    let card = existing.get(item.url);
    if (!card) {
      card = buildCard(item);
      card.style.setProperty("--enter-index", String(fresh++));
      playOnce(card, "entering");
    }
    existing.delete(item.url);
    if (!card.__hydrated) queuePreview(card, item);
    decorateCard?.(card, item);
    if (resultsEl.children[i] !== card) resultsEl.insertBefore(card, resultsEl.children[i] || null);
  });
  if (fresh) api?.usageCount?.("suggestionsShown", fresh);
  for (const old of existing.values()) old.remove();
  while (resultsEl.children.length > items.length) resultsEl.lastElementChild.remove();
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
    // The search source already sent an image: use it and leave the site alone.
    if (seed?.image || seed?.video) return setCardMedia(card, seed);
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
    statusEl.textContent = (fromTopic ? "Not much to read on this page, so these come from your current topic. " : "") + `${data.results.length} results` + (qs ? ` for ${qs}` : "");
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
  if (!tab.url) {
    // New tab page (or a tutorial practice page): nothing to read.
    const key = tab.tutorial ? "tutorial" : "";
    if (lastCrawl.url !== key) {
      lastCrawl = { at: Date.now(), url: key, terms: [], selection: "" };
      auto = [];
      renderKeys();
      renderResults([]);
      statusEl.textContent = tab.tutorial ? "A practice page for the tutorial. NODE does not suggest from it." : "Open a page and NODE suggests what to read next.";
    }
    return;
  }
  if (reason === "tick" && (tab.loading || !autoOn || crawlBusy)) return;
  try {
    let ranked;
    let topic = null;
    let selection = "";
    if (api.keywords) {
      const res = await api.keywords(tab.id, refreshBanned(), { ifChanged: reason === "tick" && tab.url === lastCrawl.url });
      if (res.unchanged) return;
      if (res.disabled) {
        // Site rule "suggest": false. Do not read the page or search with its words.
        if (reason !== "tick" || lastCrawl.url !== tab.url) {
          auto = [];
          lastCrawl = { at: Date.now(), url: tab.url, terms: [], selection: "" };
          renderKeys();
          renderResults([]);
          statusEl.textContent = res.page?.google
            ? "This page is open in the Google window, so NODE does not suggest from it."
            : res.page?.tutorial
            ? "A practice page for the tutorial. NODE does not suggest from it."
            : !res.page?.url
            ? "Open a page and NODE suggests what to read next."
            : "Suggestions are off for this site (site rule). Pinned keywords still work with Crawl.";
        }
        return;
      }
      if (res.thin && !res.fromTopic) {
        // A home screen, feed, sign-in wall or bot check, and no running topic yet.
        if (reason !== "tick" || lastCrawl.url !== tab.url) {
          auto = [];
          fromTopic = false;
          lastCrawl = { at: Date.now(), url: tab.url, terms: [], selection: "" };
          renderKeys();
          renderResults([]);
          statusEl.textContent = res.blocked
            ? "This page is a bot check or an access block, so NODE does not suggest from it."
            : "Not much to read on this page yet. Keywords appear when you open an article, video or post.";
          // The visit still goes in the trail (without keywords); pinned keywords still search.
          if (!res.blocked) api.researchVisit?.(tab.url, tab.title, []);
          if (pinned.length) await crawl();
        }
        return;
      }
      fromTopic = Boolean(res.fromTopic);
      ranked = res.ranked || [];
      topic = res.topic || null;
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
    api.researchVisit?.(tab.url, tab.title, (topic || terms).slice(0, 6));
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
  if (!tab?.url || tab.id !== activeId || tab.google) return;
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
  api ? api.createTab() : demoCreate("https://en.wikipedia.org/wiki/Main_Page");
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

omni.addEventListener("input", () => (omniTyping = true));
omni.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    omniTyping = false;
    const current = tabs.find((t) => t.id === activeId);
    omni.value = current?.url || "";
    omni.blur();
  }
});
omniForm.addEventListener("submit", (e) => {
  e.preventDefault();
  omniTyping = false;
  omni.blur();
  if (api && activeId) api.navigate(activeId, omni.value);
  else demoNavigate(omni.value);
});

function pinKeyword(text) {
  const v = String(text || "").trim();
  if (!v || isPinned(v)) return;
  api?.usageCount?.("pins");
  pinned = [...pinned, v].slice(0, 6);
  unhideKeyword(v);
  renderKeys({ animate: true });
  crawl();
}

document.getElementById("key-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = keyInput.value.trim();
  keyInput.value = "";
  if (!v || isPinned(v)) return;
  api?.usageCount?.("pins");
  pinned = [...pinned, v].slice(0, 6);
  unhideKeyword(v);
  renderKeys({ animate: true });
  crawl();
});

// 03: the button changes once the main process confirms the new layout. The
// new label rises into place; the old one is replaced at once.
function paintLayout(animate = false) {
  const mosaic = layout === "mosaic";
  layoutBtn.classList.toggle("active", mosaic);
  layoutBtn.setAttribute("aria-pressed", String(mosaic));
  setTip(layoutBtn, mosaic ? "Focus: back to one tab" : "Mosaic: tile your tabs");
  layoutBtn.innerHTML = icon(mosaic ? "focus" : "mosaic", "label");
  if (animate) playOnce(layoutBtn.firstElementChild, "rise");
  if (typeof paintSide === "function") paintSide(false);
  if (typeof tourCheck === "function") setTimeout(tourCheck, 0);
}
// Right-click the Mosaic button: the tab overview, to pick the tiles (B71).
layoutBtn.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  openOverview();
});
layoutBtn.addEventListener("click", async () => {
  const next = layout === "mosaic" ? "focus" : "mosaic";
  layout = api ? await api.setLayout(next) : next;
  paintLayout(true);
});

// Sound from every playing tab, or only the current one. Remembered between runs.
const soundBtn = document.getElementById("sound-btn");
let soundAll = store.get("scout.soundAll", false);
const paintSound = () => {
  soundBtn.classList.toggle("active", soundAll);
  soundBtn.setAttribute("aria-pressed", String(soundAll));
  setTip(soundBtn, soundAll ? "Sound: all playing tabs" : "Sound: this tab only");
  soundBtn.innerHTML = icon(soundAll ? "sound-all" : "sound");
  if (typeof paintSide === "function") paintSide(false);
};
soundBtn.addEventListener("click", () => api?.setSoundAll?.(!soundAll));
paintSound();
if (soundAll) api?.setSoundAll?.(true);

const libraryEl = document.getElementById("shelf");
const libraryList = document.getElementById("library-list");
let shelfFolder = "all";

function whenText(ms) {
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString();
}

// ---- Downloads ----
function sizeText(n) {
  if (!n) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function renderDownloadsShelf(list) {
  libraryList.innerHTML = "";
  const tools = document.createElement("div");
  tools.className = "history-tools";
  const note = document.createElement("p");
  note.className = "help";
  note.textContent = "Files are saved to your Downloads folder.";
  const clear = document.createElement("button");
  clear.className = "chip";
  clear.textContent = "Clear list";
  clear.addEventListener("click", async () => renderDownloadsShelf(await api.clearDownloads()));
  tools.append(note, clear);
  libraryList.appendChild(tools);
  if (!list.length) {
    libraryList.insertAdjacentHTML("beforeend", `<p class="help">No downloads yet.</p>`);
    return;
  }
  for (const d of list) {
    const row = document.createElement("div");
    row.className = "history-row download-row";
    const pct = d.total ? Math.round((d.received / d.total) * 100) : 0;
    const status =
      d.state === "completed" ? sizeText(d.total || d.received) : d.state === "progressing" ? `${pct || "…"}${pct ? "%" : ""} · ${sizeText(d.received)}${d.total ? ` of ${sizeText(d.total)}` : ""}` : d.state === "cancelled" ? "Cancelled" : d.state === "paused" ? "Paused" : "Failed";
    row.innerHTML = `<div><div class="t">${escapeHtml(d.name)}</div><div class="u">${escapeHtml(d.url)}</div></div><span class="when">${escapeHtml(status)}</span>`;
    const actions = [];
    if (d.state === "completed") actions.push(["Open", () => api.openDownload(d.id)], ["Show in folder", () => api.showDownload(d.id)]);
    if (d.state === "progressing" || d.state === "paused") actions.push(["Cancel", () => api.cancelDownload(d.id)]);
    for (const [label, run] of actions) {
      const b = document.createElement("button");
      b.textContent = label;
      b.addEventListener("click", run);
      row.appendChild(b);
    }
    libraryList.appendChild(row);
  }
}

function paintDownloads(msg) {
  const btn = document.getElementById("dl-btn");
  btn.hidden = !msg.active;
  document.getElementById("dl-count").textContent = msg.active;
  setTip(btn, `Downloads in progress: ${msg.active}`);
  if (menuOpen && menuSection === "downloads") renderDownloadsShelf(msg.list);
}

document.getElementById("dl-btn").addEventListener("click", () => {
  shelfFolder = "downloads";
  document.querySelectorAll("#shelf-filters .chip").forEach((c) => c.classList.toggle("active", c.dataset.folder === "downloads"));
  openLibrary();
});

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

// Bookmarks shelf: search, open, remove.
async function renderBookmarksShelf() {
  libraryList.innerHTML = "";
  const tools = document.createElement("div");
  tools.className = "history-tools";
  const input = document.createElement("input");
  input.placeholder = "Search bookmarks";
  tools.append(input);
  libraryList.appendChild(tools);
  const list = document.createElement("div");
  list.className = "history-list";
  libraryList.appendChild(list);
  const fill = async () => {
    const rows = await api.bookmarkSearch(input.value, 500);
    list.innerHTML = rows.length ? "" : `<p class="help">No bookmarks yet. Press ☆ next to the address bar, or Cmd/Ctrl+D, to add the page you are on.</p>`;
    for (const r of rows) {
      const row = document.createElement("div");
      row.className = "history-row";
      const text = document.createElement("div");
      text.innerHTML = `<div class="t">${escapeHtml(r.title || r.url)}</div><div class="u">${escapeHtml(r.url)}</div>`;
      const when = document.createElement("span");
      when.className = "when";
      when.textContent = whenText(r.addedAt);
      const open = document.createElement("button");
      open.textContent = "Open";
      open.addEventListener("click", async () => {
        await closeLibrary();
        api.createTab(r.url);
      });
      const del = document.createElement("button");
      del.textContent = "Remove";
      del.addEventListener("click", async () => {
        await api.bookmarkRemove(r.url);
        row.remove();
        paintStar();
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

// The Library, Bookmarks, History and Downloads shelves live in the menu overlay.
function openLibrary() {
  return openMenu(["bookmarks", "history", "downloads"].includes(shelfFolder) ? shelfFolder : "library");
}

async function renderShelf() {
  if (shelfFolder === "history") {
    if (api?.historySearch) await renderHistoryShelf();
    return;
  }
  if (shelfFolder === "bookmarks") {
    if (api?.bookmarkSearch) await renderBookmarksShelf();
    return;
  }
  if (shelfFolder === "downloads") {
    if (api?.downloads) renderDownloadsShelf(await api.downloads());
    return;
  }
  const rows = api?.libraryList ? await api.libraryList() : [];
  const shown = shelfFolder === "all" ? rows : rows.filter((row) => row.folder === shelfFolder);
  libraryList.innerHTML = "";
  if (!shown.length) {
    libraryList.innerHTML = `<p class="help">Nothing here yet. Use Capture in the toolbar to save a screenshot, the page or its media.</p>`;
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
    meta.innerHTML = `<strong>${escapeHtml(item.note || item.name)}</strong><p>${escapeHtml(item.folder)}${item.session?.name ? ` · trail: ${escapeHtml(item.session.name)}` : ""}</p>`;
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

function closeLibrary() {
  return closeMenu();
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
let googleNoticeShown = false;

function showNotice(text, actions = [], { dismiss = true } = {}) {
  noticeEl.hidden = false;
  noticeEl.innerHTML = "";
  const p = document.createElement("div");
  p.textContent = text;
  noticeEl.appendChild(p);
  const row = document.createElement("div");
  row.className = "row";
  for (const a of [...actions, ...(dismiss ? [{ label: "Dismiss", run: () => {} }] : [])]) {
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
document.getElementById("pip-btn").addEventListener("click", async () => {
  if (!api?.pip || !activeId) return;
  const r = await api.pip(activeId);
  if (r === "none") showNotice("No video on this page for picture-in-picture.");
});

document.getElementById("media-btn").addEventListener("click", () => {
  if (!api?.grabMedia || !activeId) return;
  api.grabMedia(activeId).then(openLibrary).catch((e) => showNotice(errText(e)));
});
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
  if (menuOpen) return; // S is a screenshot of the page, which the menu covers
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
  if (!st.ready) return { text: st.setupHint || "Needs setup (see the field above).", cls: "bad" };
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

// Saved passwords (B47): site and username only; a login can be removed.
async function renderPasswords() {
  if (!api?.passwordsList) return;
  const r = await api.passwordsList();
  const state = document.getElementById("passwords-state");
  const list = document.getElementById("passwords-list");
  const never = document.getElementById("passwords-never");
  list.innerHTML = "";
  never.innerHTML = "";
  if (!r.available) {
    state.textContent = "This computer has no secure storage for passwords, so NODE does not save them.";
    document.getElementById("passwords-never-head").hidden = true;
    return;
  }
  state.textContent = r.logins.length ? `${r.logins.length} saved login${r.logins.length === 1 ? "" : "s"}` : "No saved logins yet.";
  const button = (label, name, run) => {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = label;
    b.setAttribute("aria-label", `${label} ${name}`);
    b.addEventListener("click", run);
    return b;
  };
  const row = (ul, site, user, buttons, secret = null) => {
    const li = document.createElement("li");
    const a = document.createElement("span");
    a.className = "pw-site";
    a.textContent = site;
    const u = document.createElement("span");
    u.className = "pw-user";
    u.textContent = user;
    const box = document.createElement("span");
    box.className = "pw-buttons";
    box.append(...buttons);
    li.append(a, u);
    if (secret) li.append(secret);
    li.append(box);
    ul.appendChild(li);
  };
  const again = () => renderPasswords().catch(() => {});
  for (const l of r.logins) {
    const name = `${l.site}${l.username ? ` (${l.username})` : ""}`;
    const secret = document.createElement("span");
    secret.className = "pw-secret";
    secret.textContent = "••••••••";
    const show = button("Show", name, async () => {
      if (show.textContent === "Hide") {
        secret.textContent = "••••••••";
        show.textContent = "Show";
        return;
      }
      const pw = await api.passwordsReveal(l.id);
      if (!pw) return;
      secret.textContent = pw;
      show.textContent = "Hide";
      // Hidden again after 30 seconds.
      setTimeout(() => {
        if (secret.isConnected) {
          secret.textContent = "••••••••";
          show.textContent = "Show";
        }
      }, 30000);
    });
    const copy = button("Copy", name, async () => {
      if (await api.passwordsCopy(l.id)) showNotice("Password copied. It is cleared from the clipboard in a minute.");
    });
    const remove = button("Remove", name, async () => {
      await api.passwordsRemove(l.id);
      again();
    });
    row(list, l.site, l.username || "No username", [show, copy, remove], secret);
  }
  for (const n of r.never) row(never, n.site, "", [button("Allow", n.site, async () => (await api.passwordsAllow(n.origin), again()))]);
  document.getElementById("passwords-never-head").hidden = !r.never.length;
}

document.getElementById("passwords-import")?.addEventListener("click", async () => {
  if (!api?.passwordsImport) return;
  const r = await api.passwordsImport();
  if (r?.error) showNotice(r.error);
  else if (r && !r.cancelled) showNotice(`Imported: ${r.added} new, ${r.updated} updated${r.same ? `, ${r.same} already saved` : ""}.${r.trashed ? " The exported file is in the Trash." : ""}`);
  renderPasswords().catch(() => {});
});

async function renderSources() {
  const [settings, status] = await Promise.all([api.getSettings(), api.searchStatus()]);
  fillAI(settings.ai, settings.aiStatus);
  document.getElementById("adblock-enabled").checked = settings.adblock !== false;
  document.getElementById("adblock-cookies").checked = settings.adblockCookies === true;
  document.getElementById("passwords-offer").checked = settings.passwordsOffer !== false;
  renderPasswords().catch(() => {});
  const ab = settings.adblockStats || {};
  document.getElementById("adblock-state").textContent =
    settings.adblock === false ? "Off" : ab.status === "ready" || String(ab.status).startsWith("ready") ? `On · ${ab.blocked} requests blocked since NODE started` : `On · ${ab.status}`;
  document.getElementById("google-mode").value = settings.google?.mode || "apps";
  document.getElementById("google-browser").value = settings.google?.browser || "";
  fillGoogleState(settings.googleWindow);
  fillAgents(settings.agents);
  document.getElementById("restore-tabs").checked = settings.restoreTabs !== false;
  document.getElementById("start-page").value = settings.startPage || "";
  document.getElementById("display-name").value = settings.displayName || "";
  document.getElementById("mosaic-max").value = String(settings.mosaicMax ?? 4);
  document.getElementById("tab-sleep").value = String(settings.tabSleep ?? 30);
  document.getElementById("chrome-layout").value = settings.chromeLayout === "side" ? "side" : "top";
  document.getElementById("auto-update").checked = settings.autoUpdate !== false;
  document.getElementById("passkeys").checked = settings.passkeys === true;
  document.getElementById("passkeys").closest(".top").hidden = document.getElementById("passkeys-help").hidden = !/Mac/.test(navigator.platform);
  fillUpdate(settings.update);
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
        await saveSources(true);
      });
      actions.appendChild(clear);
    }
    box.appendChild(actions);
    sourcesList.appendChild(box);
  }
  sourcesMsg.textContent = settings.encrypted
    ? "API keys are stored encrypted with your system keychain."
    : "Your system keychain is not available, so API keys are stored as plain text in NODE's settings file.";
}

function fillGoogleState(st) {
  const el = document.getElementById("google-state");
  if (!el) return;
  if (!st) return (el.textContent = "");
  if (!st.browser) {
    el.className = "state bad";
    el.textContent = "No Chromium-based browser found. Google pages will open in your default browser.";
    return;
  }
  el.className = "state" + (st.link === "linked" ? " ok" : "");
  const link =
    st.link === "linked"
      ? "connected to NODE"
      : st.link === "waiting"
      ? "started; NODE extension not connected yet (basic mode if the browser refuses it)"
      : "starts when you open a Google account page";
  el.textContent = `${st.browser} · ${link}${st.error ? ` · ${st.error}` : ""}`;
}

// ---- AI agents (MCP) ----
var agentState = null; // var: renderTabs can run before this part of the file

function paintAgentButtons() {
  const agentShareBtn = document.getElementById("agent-share-btn");
  const agentBtn = document.getElementById("agent-btn");
  const on = Boolean(agentState?.running);
  agentBtn.hidden = !on;
  agentShareBtn.hidden = !on;
  if (!on) return;
  const tab = tabs.find((t) => t.id === activeId);
  const shared = Boolean(tab?.agentShared);
  agentShareBtn.classList.toggle("shared", shared);
  agentShareBtn.classList.toggle("active", shared);
  agentShareBtn.setAttribute("aria-pressed", String(shared));
  setTip(agentShareBtn, shared ? "Shared with agents. Click to stop sharing this tab" : "Share this tab with agents");
  const n = agentState.log?.length || 0;
  agentBtn.classList.add("on");
  setTip(agentBtn, `Agents on${n ? ` (${n} requests)` : ""}. Click to stop them`);
}

function fillAgents(st) {
  agentState = st;
  paintAgentButtons();
  const box = document.getElementById("agents-box");
  if (!box || !st) return;
  document.getElementById("agents-enabled").checked = Boolean(st.enabled);
  const portEl = document.getElementById("agents-port");
  if (document.activeElement !== portEl) portEl.value = st.port;
  const state = document.getElementById("agents-state");
  state.className = "state" + (st.running ? " ok" : st.error ? " bad" : "");
  state.textContent = st.running
    ? `On · ${st.url} · ${st.shared} shared tab${st.shared === 1 ? "" : "s"}`
    : st.error
    ? st.error
    : "Off";
  document.getElementById("agents-connect").hidden = !st.running;
  document.getElementById("agents-cmd").value = st.running
    ? `claude mcp add --transport http node ${st.url} --header "Authorization: Bearer ${st.token}"`
    : "";
  const log = document.getElementById("agents-log");
  log.innerHTML = "";
  for (const a of st.log || []) {
    const row = document.createElement("div");
    if (!a.ok) row.className = "bad";
    row.innerHTML = `<b>${escapeHtml(a.tool)}</b> · ${new Date(a.at).toLocaleTimeString()}${a.detail ? ` · ${escapeHtml(a.detail)}` : ""}`;
    log.appendChild(row);
  }
}

if (api?.agentsStatus) {
  api.agentsStatus().then(fillAgents);
  document.getElementById("agent-share-btn").addEventListener("click", async () => {
    const tab = tabs.find((t) => t.id === activeId);
    if (tab) await api.shareTab(tab.id, !tab.agentShared);
  });
  document.getElementById("agent-btn").addEventListener("click", async () => fillAgents(await api.setAgents(false)));
  const claudeState = document.getElementById("agents-claude-state");
  document.getElementById("agents-claude-add").addEventListener("click", async () => {
    try {
      const r = await api.claudeDesktop("add");
      claudeState.className = "state ok";
      claudeState.textContent = `Added to ${r.file}. Quit and reopen the Claude app to load NODE's tools.`;
    } catch (err) {
      claudeState.className = "state bad";
      claudeState.textContent = errText(err);
    }
  });
  document.getElementById("agents-claude-copy").addEventListener("click", async () => {
    const r = await api.claudeDesktop("config");
    await navigator.clipboard.writeText(r.config).catch(() => {});
    claudeState.className = "state";
    claudeState.textContent = `Copied. Paste the "node" entry under "mcpServers" in ${r.file}.`;
  });
  document.getElementById("agents-enabled").addEventListener("change", async (e) => fillAgents(await api.setAgents(e.target.checked)));
  document.getElementById("agents-port").addEventListener("change", async (e) => {
    await api.setSettings({ agents: { port: Number(e.target.value) } });
    fillAgents(await api.agentsStatus());
  });
  document.getElementById("agents-copy").addEventListener("click", () => navigator.clipboard.writeText(document.getElementById("agents-cmd").value));
  document.getElementById("agents-token").addEventListener("click", async () => fillAgents(await api.agentsNewToken()));
}

// ---- Updates (B46) ----
function fillUpdate(st) {
  const el = document.getElementById("update-state");
  if (!el || !st) return;
  const words = {
    idle: `NODE ${st.current}.`,
    checking: "Checking for updates…",
    current: `NODE ${st.current} is the latest version.`,
    downloading: `Downloading NODE ${st.version}…`,
    ready: `NODE ${st.version} is ready. Restart NODE to install it.`,
    error: `Could not update: ${st.error}`,
    unavailable: st.error,
  };
  el.className = "state" + (st.status === "error" ? " bad" : st.status === "ready" ? " ok" : "");
  el.textContent = words[st.status] || "";
}
if (api?.checkUpdates) {
  document.getElementById("update-check").addEventListener("click", async () => {
    document.getElementById("update-state").textContent = "Checking for updates…";
    fillUpdate(await api.checkUpdates());
  });
  document.getElementById("update-releases").addEventListener("click", () => api.openReleases());
}

// ---- Help: diagnostics (B31) ----
if (api?.copyDiagnostics) {
  document.getElementById("diag-copy").addEventListener("click", async () => {
    const text = await api.copyDiagnostics();
    document.getElementById("diag-state").textContent = `Copied ${text.split("\n").length} lines to the clipboard.`;
  });
  document.getElementById("diag-folder").addEventListener("click", () => api.openLogFolder());
}

// ---- Beta survey (B64, B65) ----
// Settings → Help: the survey link and the usage summary to paste into it.
if (api?.copyUsage) {
  document.getElementById("usage-copy").addEventListener("click", async () => {
    const text = await api.copyUsage();
    document.getElementById("usage-state").textContent = `Copied ${text.split("\n").length} lines to the clipboard. Paste them into the survey's usage question.`;
  });
  document.getElementById("survey-open").addEventListener("click", () => {
    store.set("node.survey", { state: "done" });
    closeMenu?.();
    api.openSurvey();
  });
}
// One prompt in the suggestions widget once NODE has been used on 3
// different days. Later asks again on the next day of use; Don't ask again
// and Take survey end it. The survey stays in Settings → Help either way.
const SURVEY_AFTER_DAYS = 3;
async function maybeSurveyPrompt() {
  if (!api?.usageDays || !api?.openSurvey) return;
  const survey = store.get("node.survey", { state: "ask" });
  if (survey.state !== "ask") return;
  const days = await api.usageDays();
  if (days < SURVEY_AFTER_DAYS || (survey.laterDays && days <= survey.laterDays)) return;
  if (!noticeEl.hidden || tourOn()) return; // another notice or the tutorial is showing: ask on the next start
  showNotice(
    `Thanks for trying NODE. You've used it on ${days} days. Would you answer a short survey? About 4 minutes, anonymous. It decides what gets fixed next.`,
    [
      { label: "Take survey", run: () => (store.set("node.survey", { state: "done" }), api.openSurvey()) },
      { label: "Later", run: () => store.set("node.survey", { state: "ask", laterDays: days }) },
      { label: "Don't ask again", run: () => store.set("node.survey", { state: "never" }) },
    ],
    { dismiss: false }
  );
}
setTimeout(() => maybeSurveyPrompt().catch(() => {}), 8000);

// ---- First-run setup (B30) ----
async function maybeFirstRun() {
  if (!api?.getSettings) return;
  const settings = await api.getSettings();
  if (settings.firstRunDone) return;
  const box = document.getElementById("firstrun");
  box.hidden = false;
  await api.setLibraryOpen(true); // hide the page views under the setup screen
  document.querySelectorAll('input[name="fr-ai"]').forEach((r) =>
    r.addEventListener("change", () => (document.getElementById("fr-grok-row").hidden = document.querySelector('input[name="fr-ai"]:checked').value !== "grok"))
  );
  let openKeyPage = false;
  document.getElementById("fr-brave-get").addEventListener("click", () => {
    openKeyPage = true;
    document.getElementById("fr-brave-get").textContent = "The key page opens when you finish here.";
  });
  document.getElementById("fr-done").addEventListener("click", async () => {
    const brave = document.getElementById("fr-brave").value.trim();
    const ai = document.querySelector('input[name="fr-ai"]:checked').value;
    const next = {
      firstRunDone: true,
      restoreTabs: document.getElementById("fr-restore").checked,
      adblock: document.getElementById("fr-adblock").checked,
      providers: brave ? { brave: { enabled: true, key: brave } } : {},
    };
    if (ai === "local") next.ai = { provider: "local" };
    if (ai === "grok") next.ai = { provider: "grok", grok: { key: document.getElementById("fr-grok").value.trim() } };
    await api.setSettings(next);
    box.hidden = true;
    await api.setLibraryOpen(false);
    setTimeout(() => maybeTourPrompt(true), 1500);
    if (openKeyPage) api.createTab("https://brave.com/search/api/");
  });
}
maybeFirstRun();

// ---- Site rules editor (B28) ----
let rulesDraft = [];
let editingRule = -1; // index in rulesDraft, or rulesDraft.length for a new rule
const RF_ENUMS = ["autoplay", "sound", "popups"];
const RF_BOOLS = ["suggest", "mosaic", "center", "adblock", "talk"];
const RF_WORDS = {
  autoplay: { on: "autoplay on", muted: "autoplay muted", off: "no autoplay" },
  sound: { auto: "sound: active tab", on: "sound always on", off: "sound off" },
  popups: { gesture: "popups after a click", block: "popups blocked", allow: "popups allowed" },
  suggest: { true: "suggestions on", false: "never read" },
  mosaic: { true: "in Mosaic", false: "out of Mosaic" },
  center: { true: "center on click", false: "no centering" },
  adblock: { true: "ads blocked", false: "ads allowed" },
  talk: { true: "Talk on", false: "Talk off" },
};

function ruleSummary(r) {
  const parts = [];
  for (const k of [...RF_ENUMS, ...RF_BOOLS]) if (r[k] !== undefined) parts.push(RF_WORDS[k][String(r[k])] || `${k} ${r[k]}`);
  if (r.extract?.include?.length) parts.push(`reads ${r.extract.include.length} area${r.extract.include.length === 1 ? "" : "s"} first`);
  if (r.extract?.skip?.length) parts.push(`skips ${r.extract.skip.length} area${r.extract.skip.length === 1 ? "" : "s"}`);
  return parts.join(" · ") || "no changes";
}

async function renderRulesList() {
  if (!api?.rulesGet) return;
  const r = await api.rulesGet();
  rulesDraft = r.rules;
  const list = document.getElementById("rules-list");
  list.innerHTML = "";
  if (r.unreadable) {
    list.innerHTML = `<li class="bad">${escapeHtml(r.errors[0])} Fix the file with Edit rules file.</li>`;
    return;
  }
  rulesDraft.forEach((rule, i) => {
    const li = document.createElement("li");
    const match = Array.isArray(rule.match) ? rule.match.join(", ") : String(rule.match || "");
    li.innerHTML = `<div class="rn">${escapeHtml(rule.name || match)}</div><div class="rm">${escapeHtml(match === "*" ? "every site" : match)}</div><div class="rs">${escapeHtml(ruleSummary(rule))}</div>`;
    const bar = document.createElement("div");
    bar.className = "rb";
    const btn = (label, run, title) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      if (title) b.title = title;
      b.addEventListener("click", run);
      bar.appendChild(b);
    };
    btn("Edit", () => openRuleForm(i));
    if (i > 0) btn("↑", () => moveRule(i, -1), "Move up (earlier rules lose to later ones)");
    if (i < rulesDraft.length - 1) btn("↓", () => moveRule(i, 1), "Move down");
    btn("Delete", () => deleteRule(i));
    li.appendChild(bar);
    list.appendChild(li);
  });
  document.getElementById("rules-msg").textContent = r.errors.length ? "Problems: " + r.errors.join(" ") : `${rulesDraft.length} rules in use.`;
}

function openRuleForm(index, preset = {}) {
  editingRule = index;
  const rule = index < rulesDraft.length ? rulesDraft[index] : { name: "", match: "", ...preset };
  const form = document.getElementById("rule-form");
  form.hidden = false;
  document.getElementById("rf-name").value = rule.name || "";
  document.getElementById("rf-match").value = Array.isArray(rule.match) ? rule.match.join(", ") : rule.match || "";
  for (const k of [...RF_ENUMS, ...RF_BOOLS]) document.getElementById(`rf-${k}`).value = rule[k] === undefined ? "" : String(rule[k]);
  document.getElementById("rf-include").value = (rule.extract?.include || []).join(", ");
  document.getElementById("rf-skip").value = (rule.extract?.skip || []).join(", ");
  document.getElementById("rf-errors").textContent = "";
  form.scrollIntoView({ block: "nearest" });
  document.getElementById(preset.match ? "rf-autoplay" : "rf-name").focus();
}

function ruleFromForm(old = {}) {
  const split = (v) => v.split(",").map((x) => x.trim()).filter(Boolean);
  const match = split(document.getElementById("rf-match").value);
  // Keep fields the form does not show (written by hand in the file).
  const rule = { ...old, name: document.getElementById("rf-name").value.trim(), match: match.length === 1 ? match[0] : match };
  for (const k of RF_ENUMS) {
    const v = document.getElementById(`rf-${k}`).value;
    if (v) rule[k] = v;
    else delete rule[k];
  }
  for (const k of RF_BOOLS) {
    const v = document.getElementById(`rf-${k}`).value;
    if (v) rule[k] = v === "true";
    else delete rule[k];
  }
  const include = split(document.getElementById("rf-include").value);
  const skip = split(document.getElementById("rf-skip").value);
  if (include.length || skip.length) rule.extract = { ...(include.length ? { include } : {}), ...(skip.length ? { skip } : {}) };
  else delete rule.extract;
  if (!rule.name) delete rule.name;
  return rule;
}

async function saveRules(list) {
  const r = await api.rulesSave(list);
  if (!r.ok) {
    document.getElementById("rf-errors").textContent = r.errors.join(" ");
    return false;
  }
  await renderRulesList();
  return true;
}

async function moveRule(i, dir) {
  const list = rulesDraft.slice();
  [list[i], list[i + dir]] = [list[i + dir], list[i]];
  await saveRules(list);
}

async function deleteRule(i) {
  const list = rulesDraft.slice();
  list.splice(i, 1);
  await saveRules(list);
}

if (api?.rulesGet) {
  document.getElementById("rule-add").addEventListener("click", () => openRuleForm(rulesDraft.length));
  document.getElementById("rule-this-site").addEventListener("click", async () => {
    const host = await api.rulesHost();
    if (!host) return (document.getElementById("rules-msg").textContent = "Open a web page first.");
    const existing = rulesDraft.findIndex((r) => r.match === host);
    if (existing >= 0) openRuleForm(existing);
    else openRuleForm(rulesDraft.length, { name: host, match: host });
  });
  document.getElementById("rf-cancel").addEventListener("click", () => (document.getElementById("rule-form").hidden = true));
  document.getElementById("rule-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const list = rulesDraft.slice();
    const rule = ruleFromForm(editingRule < list.length ? list[editingRule] : {});
    if (editingRule < list.length) list[editingRule] = rule;
    else list.push(rule);
    if (await saveRules(list)) document.getElementById("rule-form").hidden = true;
  });
}

async function saveSources(rerender = true) {
  if (!sourcesDraft) return;
  await api.setSettings({ ...sourcesDraft, ai: aiDraft(), adblock: document.getElementById("adblock-enabled").checked, adblockCookies: document.getElementById("adblock-cookies").checked,
    google: { mode: document.getElementById("google-mode").value, browser: document.getElementById("google-browser").value },
    restoreTabs: document.getElementById("restore-tabs").checked,
    startPage: document.getElementById("start-page").value,
    displayName: document.getElementById("display-name").value,
    mosaicMax: Number(document.getElementById("mosaic-max").value),
    tabSleep: Number(document.getElementById("tab-sleep").value),
    passwordsOffer: document.getElementById("passwords-offer").checked,
    autoUpdate: document.getElementById("auto-update").checked,
    passkeys: document.getElementById("passkeys").checked,
  });
  if (rerender) await renderSources();
}

function openSources() {
  return openMenu("settings");
}

function closeSources() {
  return closeMenu();
}

// One sidebar pane at a time: suggestions, trail or settings.
function showPane(name) {
  // Trail and Settings moved to the menu overlay.
  if (name === "trail" || name === "sources") return openMenu(name === "sources" ? "settings" : "trail");
  if (typeof closeMenu === "function" && menuOpen) closeMenu();
  if (panelOpen === false) setPanelOpen(true, { animate: true }); // undefined until the widget code below has run
  for (const [id, pane] of [["suggest-tab", "suggest"], ["ask-btn", "ask"], ["agent-run-btn", "agent"], ["talk-btn", "talk"]]) {
    const tab = document.getElementById(id);
    tab.setAttribute("aria-selected", String(name === pane));
    tab.tabIndex = name === pane ? 0 : -1;
  }
  suggestPane.hidden = name !== "suggest";
  document.getElementById("ask-pane").hidden = name !== "ask";
  document.getElementById("agent-pane").hidden = name !== "agent";
  document.getElementById("talk-pane").hidden = name !== "talk";
  talkOpen = name === "talk";
}

// ---- Talk (social layer stage 1) ----
var talkOpen = false; // var: showPane can run before this part of the file
let talkUrl = "";

function ago(ms) {
  if (!ms) return "";
  const d = (Date.now() - ms) / 86400000;
  if (d < 1) return "today";
  if (d < 2) return "yesterday";
  if (d < 60) return `${Math.floor(d)} days ago`;
  if (d < 730) return `${Math.floor(d / 30)} months ago`;
  return `${Math.floor(d / 365)} years ago`;
}

async function loadTalk(force = false) {
  const tab = tabs.find((t) => t.id === activeId);
  if (!tab || !talkOpen || !api?.talk) return;
  if (!force && tab.url === talkUrl) return;
  talkUrl = tab.url;
  const status = document.getElementById("talk-status");
  const list = document.getElementById("talk-list");
  status.className = "state";
  status.textContent = "Looking for discussions…";
  list.innerHTML = "";
  const r = await api.talk(tab.id);
  if (tab.url !== talkUrl) return; // the page changed while loading
  if (r.off) {
    status.textContent = r.off;
    return;
  }
  const count = r.hn.length + r.bluesky.length;
  const failed = Object.keys(r.errors || {}).length;
  status.textContent = count
    ? `${r.hn.length} on Hacker News · ${r.bluesky.length} on Bluesky`
    : failed
    ? "No discussions found on the sources that answered."
    : "No discussions found for this page.";
  const section = (title, rows, error) => {
    const h = document.createElement("p");
    h.className = "kicker talk-head";
    h.textContent = title;
    list.appendChild(h);
    if (error) {
      const e = document.createElement("p");
      e.className = "help bad";
      e.textContent = error;
      list.appendChild(e);
    }
    for (const row of rows) {
      const el = document.createElement("a");
      el.className = "talk-item";
      el.href = "#";
      el.innerHTML = row.title
        ? `<b>${escapeHtml(row.title)}</b><span class="meta">${row.points} points · ${row.comments} comments · ${escapeHtml(row.author)} · ${ago(row.at)}</span>`
        : `<span class="txt">${escapeHtml(row.text)}</span><span class="meta">${escapeHtml(row.author)} · ${row.likes} likes · ${row.comments} replies · ${ago(row.at)}</span>`;
      el.addEventListener("click", (e) => {
        e.preventDefault();
        api.createTab(row.url);
      });
      list.appendChild(el);
    }
    if (!rows.length && !error) {
      const n = document.createElement("p");
      n.className = "help";
      n.textContent = "Nothing yet.";
      list.appendChild(n);
    }
  };
  section("Hacker News", r.hn, r.errors.hn ? `Hacker News search failed: ${r.errors.hn}` : "");
  section("Bluesky", r.bluesky, r.errors.bluesky || "");
  const rd = document.createElement("a");
  rd.className = "talk-item talk-reddit";
  rd.href = "#";
  rd.textContent = "Search Reddit for this page";
  rd.addEventListener("click", (e) => {
    e.preventDefault();
    api.createTab(r.reddit);
  });
  list.appendChild(rd);
}

document.getElementById("talk-btn").addEventListener("click", () => {
  showPane("talk");
  loadTalk(true);
});

// ---- Research agent pane ----
// thread: the reports of this line of questions, oldest first; a follow-up
// builds on the last one's sources and notes.
let agentRun = { running: false, steps: [], result: null, thread: [] };

// Report Markdown to HTML. Everything is escaped first; the only links are
// the [n] marks and the sources list, both built from the sources the app read.
function reportHtml(md, sources) {
  const body = String(md).split(/\n## Sources\n/)[0];
  const out = [];
  let list = "";
  const inline = (t) =>
    t
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/\*([^*]+)\*/g, "<i>$1</i>")
      .replace(/\[(\d{1,2})\]/g, (m, n) => (sources.some((s) => s.n === Number(n)) ? `<a class="cite" data-n="${n}">[${n}]</a>` : m));
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = "";
  };
  for (const line of escapeHtml(body).split("\n")) {
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      close();
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
    } else if ((m = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/))) {
      const kind = /^\s*\d/.test(line) ? "ol" : "ul";
      if (list !== kind) {
        close();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if (line.trim()) {
      close();
      out.push(`<p>${inline(line)}</p>`);
    } else close();
  }
  close();
  out.push("<h2>Sources</h2><ol>" + sources.map((s) => `<li><a data-n="${s.n}">${escapeHtml(s.title)}</a></li>`).join("") + "</ol>");
  return out.join("");
}

// 05: lines already in the list stay as they are; only new steps are added,
// and each new one is typed out left to right.
let agentShown = { steps: null, count: 0 }; // which run's steps are drawn, and how many

function renderAgent() {
  const steps = document.getElementById("agent-steps");
  let animate = true;
  if (agentShown.steps !== agentRun.steps || agentRun.steps.length < agentShown.count) {
    // A different run: start the list again. Steps that already exist (the pane
    // was redrawn) appear without typing; steps arriving from now on type out.
    steps.innerHTML = "";
    animate = agentRun.steps.length === 0;
    agentShown = { steps: agentRun.steps, count: 0 };
  }
  for (const s of agentRun.steps.slice(agentShown.count)) {
    if (s.kind === "view") continue;
    const li = document.createElement("li");
    li.className = s.kind;
    const line = document.createElement("span");
    line.className = "line";
    line.textContent = s.text;
    li.appendChild(line);
    steps.appendChild(li);
    if (animate) playOnce(line, "typing");
  }
  agentShown.count = agentRun.steps.length;
  steps.scrollTop = steps.scrollHeight;
  const following = agentRun.thread.length > 0;
  document.getElementById("agent-form").hidden = following;
  document.getElementById("agent-start").hidden = agentRun.running;
  document.getElementById("agent-stop").hidden = !agentRun.running;
  // Live view: the latest page the agent opened, while it runs.
  const view = document.getElementById("agent-view");
  const last = [...agentRun.steps].reverse().find((s) => s.kind === "view");
  view.hidden = !(agentRun.running && last);
  if (!view.hidden && /^data:image\/jpeg;base64,/.test(last.thumb || "")) {
    document.getElementById("agent-view-img").src = last.thumb;
    document.getElementById("agent-view-cap").textContent = last.text;
  }
  const rep = document.getElementById("agent-report");
  const r = agentRun.result;
  rep.hidden = !r && !following;
  document.getElementById("agent-after").hidden = !following || agentRun.running;
  document.getElementById("agent-followup-form").hidden = !following || agentRun.running;
  let html = agentRun.thread.map((t) => `<section class="agent-turn">${reportHtml(t.report, t.sources)}</section>`).join("");
  if (r && !r.ok) html += `<p class="bad">${escapeHtml(r.stopped ? "Stopped." : r.error)}</p>`;
  rep.innerHTML = html;
  if (r?.ok) rep.lastElementChild?.scrollIntoView({ block: "start" });
}

async function openAgent() {
  if (!api?.runAgent) return showNotice("The research agent needs the desktop app.");
  showPane("agent");
  const info = await api.chatInfo();
  document.getElementById("agent-privacy").textContent = info.ready
    ? `Uses ${info.provider === "grok" ? "Grok (xAI)" : "your local model"} (${info.model}) and your search sources. Pages are read in a separate logged-out session; the agent only reads search results and never signs in, clicks or fills forms.`
    : "Set up a model first in Settings → AI: a local model (Ollama or LM Studio) or a Grok API key.";
  renderAgent();
  document.getElementById("agent-input").focus();
}

async function startAgent(followUp = false) {
  const box = document.getElementById(followUp ? "agent-followup" : "agent-input");
  const goal = box.value.trim();
  if (!goal || agentRun.running) return;
  const prev = followUp ? agentRun.thread.at(-1) : null;
  agentRun = { running: true, steps: [], result: null, thread: followUp ? agentRun.thread : [] };
  renderAgent();
  const r = await api.runAgent(goal, prev ? { question: prev.question, sources: prev.allSources } : null);
  agentRun.running = false;
  agentRun.result = r;
  if (r.ok) {
    agentRun.thread.push(r);
    box.value = "";
  }
  renderAgent();
}

document.getElementById("agent-run-btn").addEventListener("click", openAgent);
document.getElementById("agent-form").addEventListener("submit", (e) => {
  e.preventDefault();
  startAgent();
});
document.getElementById("agent-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    startAgent();
  }
});
document.getElementById("agent-stop").addEventListener("click", () => api.stopAgent());
document.getElementById("agent-followup-form").addEventListener("submit", (e) => {
  e.preventDefault();
  startAgent(true);
});
document.getElementById("agent-followup").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    startAgent(true);
  }
});
document.getElementById("agent-new").addEventListener("click", () => {
  agentRun = { running: false, steps: [], result: null, thread: [] };
  renderAgent();
  document.getElementById("agent-input").focus();
});
document.getElementById("agent-report").addEventListener("click", (e) => {
  const a = e.target.closest("a[data-n]");
  const turn = a?.closest(".agent-turn");
  const idx = turn ? [...turn.parentElement.querySelectorAll(".agent-turn")].indexOf(turn) : -1;
  const src = a && agentRun.thread[idx]?.sources?.find((s) => s.n === Number(a.dataset.n));
  if (src) api.createTab(src.url);
});
document.getElementById("agent-mosaic").addEventListener("click", async () => {
  for (const s of (agentRun.thread.at(-1)?.sources || []).slice(0, 4)) await api.createTab(s.url);
  if (layout !== "mosaic") layoutBtn.click();
});
document.getElementById("agent-library").addEventListener("click", () => document.getElementById("library-btn").click());

document.getElementById("rules-edit").addEventListener("click", () => api?.editRules?.());
document.getElementById("rules-reload").addEventListener("click", async () => {
  const r = await api?.reloadRules?.();
  if (r) document.getElementById("rules-msg").textContent = `${r.count} rules loaded.` + (r.errors.length ? " Problems: " + r.errors.join(" ") : "");
});
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
  holdChrome("find", true);
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
  holdChrome("find", false);
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

// ---- Bookmarks star ----
const starBtn = document.getElementById("star-btn");
// animate: only when the user saved or removed the bookmark (04). A repaint
// from switching tabs shows the star with no animation.
async function paintStar({ animate = false } = {}) {
  const tab = tabs.find((t) => t.id === activeId);
  starUrl = tab?.url || "";
  const on = api?.bookmarkHas && /^https?:/i.test(starUrl) ? await api.bookmarkHas(starUrl) : false;
  starBtn.innerHTML = `<span class="glyph">${icon("star")}</span>`;
  if (animate) playOnce(starBtn.firstElementChild, on ? "save" : "unsave");
  starBtn.classList.toggle("on", on);
  starBtn.setAttribute("aria-pressed", String(on));
  setTip(starBtn, on ? "Bookmarked. Click to remove" : "Bookmark this page");
}
async function toggleBookmark() {
  const tab = tabs.find((t) => t.id === activeId);
  if (!api?.bookmarkToggle || !tab || !/^https?:/i.test(tab.url || "")) return;
  const on = await api.bookmarkToggle(tab.url, tab.title);
  statusEl.textContent = on ? `Bookmarked: ${tab.title || tab.url}` : "Bookmark removed.";
  paintStar({ animate: true });
}
starBtn.addEventListener("click", toggleBookmark);

// ---- Address-bar suggestions from bookmarks and history (B19) ----
const historyList = document.getElementById("history-list");
let omniTimer = null;
omni.addEventListener("input", () => {
  if (!api?.historySearch) return;
  clearTimeout(omniTimer);
  omniTimer = setTimeout(async () => {
    const marks = api.bookmarkSearch ? await api.bookmarkSearch(omni.value, 4) : [];
    const rows = await api.historySearch(omni.value, 8);
    historyList.innerHTML = "";
    const seen = new Set();
    for (const r of [...marks.map((m) => ({ ...m, star: true })), ...rows]) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      const o = document.createElement("option");
      o.value = r.url;
      o.label = (r.star ? "★ " : "") + (r.title || r.url);
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
  if (typeof paintSide === "function") paintSide();
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
    `${session.trail.length} pages read · ${session.opened.length} suggestions opened · ${(session.captures || []).length} ${(session.captures || []).length === 1 ? "capture" : "captures"} · ${session.dismissed.length} hidden` +
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

  await renderThreads();

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
    row.appendChild(notesBlock(r));
    // Screenshots and saves taken on this page (files are in the Library).
    const caps = (session.captures || []).filter((c) => c.url === r.url);
    if (caps.length) {
      const strip = document.createElement("div");
      strip.className = "caps";
      for (const c of caps.slice(-6)) {
        const cell = document.createElement("button");
        cell.className = "cap";
        cell.title = `${c.kind === "shot" ? "Screenshot" : c.kind === "media" ? "Saved media" : "Saved page"} · ${new Date(c.at).toLocaleString()} · open in the Library`;
        if (c.kind === "shot") {
          const img = document.createElement("img");
          img.src = `scoutlib://item/${c.libraryId}`;
          img.alt = "Screenshot";
          img.addEventListener("error", () => (cell.textContent = "Shot"));
          cell.appendChild(img);
        } else cell.textContent = c.kind === "media" ? "Media" : "Save";
        cell.addEventListener("click", () => openLibrary());
        strip.appendChild(cell);
      }
      row.appendChild(strip);
    }
    trailList.appendChild(row);
  }
}

// ---- Threads and notes (B82) ----
// A thread is a question in the trail with replies that can be answered, like
// a Reddit thread. Everything written carries the display name (Settings →
// Sharing); the first time, the Trail section asks for it.
let nameWaiting = null;
async function withName(fn) {
  const s = await api.getSettings();
  if (s.displayName) return fn();
  nameWaiting = fn;
  const box = document.getElementById("name-ask");
  box.hidden = false;
  document.getElementById("name-ask-input").focus();
}
async function saveAskedName() {
  const name = document.getElementById("name-ask-input").value.trim();
  if (!name) return document.getElementById("name-ask-input").focus();
  await api.setSettings({ displayName: name });
  document.getElementById("display-name").value = name;
  document.getElementById("name-ask").hidden = true;
  const fn = nameWaiting;
  nameWaiting = null;
  if (fn) await fn();
}
document.getElementById("name-ask-save").addEventListener("click", saveAskedName);
document.getElementById("name-ask-input").addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), saveAskedName()));

// Re-render after a change, keeping the threads that were folded open.
async function threadsChanged(snapshot) {
  if (snapshot) adoptSession(snapshot);
  await renderTrail();
}

document.getElementById("thread-new").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("thread-title");
  const title = input.value.trim();
  if (!title) return input.focus();
  withName(async () => {
    const snap = await api.threadAdd({ title });
    input.value = "";
    if (snap) {
      const t = snap.threadList[snap.threadList.length - 1];
      threadOpen.add(t.id);
    }
    await threadsChanged(snap);
  });
});

const threadOpen = new Set();
const whenShort = (ms) => new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

// A small inline form (Electron has no window.prompt): one text field and a button.
function inlineForm({ placeholder, button, multiline = true, value = "", onSubmit }) {
  const f = el("form", "inline-form");
  const field = multiline ? el("textarea") : el("input");
  if (!multiline) field.type = "text";
  field.placeholder = placeholder;
  field.value = value;
  if (multiline) field.rows = 2;
  const go = el("button", "chip", button);
  go.type = "submit";
  const cancel = el("button", "chip ghost", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => f.remove());
  f.append(field, go, cancel);
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    await onSubmit(field.value.trim(), f);
  });
  field.addEventListener("keydown", (e) => {
    if (e.key === "Escape") (e.stopPropagation(), f.remove());
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !multiline)) (e.preventDefault(), f.requestSubmit());
  });
  setTimeout(() => field.focus(), 0);
  return f;
}

function replyNode(thread, r, depth) {
  const li = el("li", "reply");
  li.dataset.id = r.id;
  const head = el("div", "reply-head");
  head.append(el("b", "", r.by || "Someone"), el("span", "when", ` · ${whenShort(r.at)}`));
  const body = el("div", "reply-text", r.text);
  const actions = el("div", "reply-actions");
  if (depth < 8) {
    const answer = el("button", "link-btn", "Reply");
    answer.addEventListener("click", () => {
      if (li.querySelector(":scope > .inline-form")) return;
      li.insertBefore(
        inlineForm({ placeholder: `Answer ${r.by || "this reply"}`, button: "Reply", onSubmit: (text) => text && withName(async () => threadsChanged(await api.threadReply(thread.id, r.id, text))) }),
        li.querySelector(":scope > ul"),
      );
    });
    actions.appendChild(answer);
  }
  li.append(head, body, actions);
  if (r.replies?.length) {
    const ul = el("ul", "replies");
    for (const c of r.replies) ul.appendChild(replyNode(thread, c, depth + 1));
    li.appendChild(ul);
  }
  return li;
}

const countReplies = (list) => (list || []).reduce((n, r) => n + 1 + countReplies(r.replies), 0);

function threadNode(t) {
  const box = el("div", `thread ${t.status}`);
  box.dataset.id = t.id;
  const open = threadOpen.has(t.id);
  const head = el("button", "thread-head");
  head.setAttribute("aria-expanded", String(open));
  const n = countReplies(t.replies);
  head.append(el("span", "thread-title", t.title), el("span", "thread-meta", `${t.status === "resolved" ? "Resolved" : "Open"} · ${n} ${n === 1 ? "reply" : "replies"}${t.by ? ` · ${t.by}` : ""}`));
  head.addEventListener("click", () => {
    if (threadOpen.has(t.id)) threadOpen.delete(t.id);
    else threadOpen.add(t.id);
    renderThreads();
  });
  box.appendChild(head);
  if (t.tags?.length) {
    const tags = el("div", "ks thread-tags");
    for (const tag of t.tags) tags.appendChild(el("span", "", tag));
    box.appendChild(tags);
  }
  if (!open) return box;
  if (t.conclusion) box.appendChild(el("p", "thread-conclusion", `Conclusion: ${t.conclusion}`));
  if (t.pages?.length) {
    const pages = el("div", "thread-pages");
    for (const url of t.pages) {
      const row = session.trail.find((r) => r.url === url);
      const a = el("button", "link-btn", row?.title || hostOf(url));
      a.title = url;
      a.addEventListener("click", () => openUrl(url, false));
      pages.appendChild(a);
    }
    box.appendChild(pages);
  }
  const ul = el("ul", "replies top");
  for (const r of t.replies || []) ul.appendChild(replyNode(t, r, 1));
  box.appendChild(ul);

  const actions = el("div", "thread-actions");
  const add = (label, fn, title) => {
    const b = el("button", "chip", label);
    if (title) b.title = title;
    b.addEventListener("click", fn);
    actions.appendChild(b);
    return b;
  };
  const formHere = (form) => {
    actions.querySelector(".inline-form")?.remove();
    actions.appendChild(form);
  };
  add("Reply", () => formHere(inlineForm({ placeholder: "Write a reply", button: "Post", onSubmit: (text) => text && withName(async () => threadsChanged(await api.threadReply(t.id, "", text))) })));
  const here = currentTabUrl();
  if (here && /^https?:/i.test(here) && !(t.pages || []).includes(here)) add("Add This Page", async () => threadsChanged(await api.threadEdit(t.id, { pages: [...(t.pages || []), here] })), "Link the page in the current tab to this thread");
  if (t.status === "open")
    add("Resolve…", () => formHere(inlineForm({ placeholder: "Conclusion (optional)", button: "Mark Resolved", multiline: false, value: t.conclusion || "", onSubmit: async (text) => threadsChanged(await api.threadResolve(t.id, text)) })));
  else add("Reopen", async () => threadsChanged(await api.threadReopen(t.id)));
  add("Tags…", () => formHere(inlineForm({ placeholder: "Tags, separated by commas", button: "Save Tags", multiline: false, value: (t.tags || []).join(", "), onSubmit: async (text) => threadsChanged(await api.threadEdit(t.id, { tags: text.split(",").map((x) => x.trim()).filter(Boolean) })) })));
  const del = add("Remove", async () => {
    if (del.dataset.armed !== "1") {
      del.dataset.armed = "1";
      del.textContent = "Remove thread and replies?";
      return;
    }
    threadOpen.delete(t.id);
    await threadsChanged(await api.threadRemove(t.id));
  });
  box.appendChild(actions);
  return box;
}

function currentTabUrl() {
  return tabs.find((t) => t.id === activeId)?.url || "";
}

async function renderThreads() {
  const list = document.getElementById("thread-list");
  const threads = session?.threadList || [];
  list.innerHTML = "";
  if (!threads.length) list.appendChild(el("p", "help", "A thread is a question or a line of inquiry in this trail. You and the people you share the trail with can reply, answer replies, and mark it resolved."));
  // Open threads first, then resolved; newest first within each.
  const sorted = [...threads].sort((a, b) => (a.status === b.status ? b.at - a.at : a.status === "open" ? -1 : 1));
  for (const t of sorted) list.appendChild(threadNode(t));
  const sug = document.getElementById("thread-suggest");
  sug.innerHTML = "";
  const ideas = (await api.threadSuggestions?.()) || [];
  for (const k of ideas) {
    const b = el("button", "link-btn", `${k.pages} pages share “${k.term}”. Make it a thread?`);
    b.addEventListener("click", () =>
      withName(async () => {
        const pages = session.trail.filter((r) => r.keywords.some((x) => x.toLowerCase() === k.term.toLowerCase())).map((r) => r.url);
        const snap = await api.threadAdd({ title: k.term, tags: [k.term], pages });
        if (snap) threadOpen.add(snap.threadList[snap.threadList.length - 1].id);
        await threadsChanged(snap);
      }),
    );
    sug.appendChild(b);
  }
}

// Notes on a page in the trail, each with its author.
function notesBlock(r) {
  const wrap = el("div", "notes");
  for (const n of r.notes || []) {
    const line = el("div", "note");
    line.append(el("b", "", n.by || "Someone"), el("span", "when", ` · ${whenShort(n.at)}: `), el("span", "", n.text));
    const x = el("button", "link-btn", "Remove");
    x.addEventListener("click", async () => threadsChanged(await api.noteRemove(r.url, n.id)));
    line.appendChild(x);
    wrap.appendChild(line);
  }
  const add = el("button", "link-btn", "Add note");
  add.addEventListener("click", () => {
    if (wrap.querySelector(".inline-form")) return;
    wrap.appendChild(inlineForm({ placeholder: "A note on this page", button: "Save Note", onSubmit: (text) => text && withName(async () => threadsChanged(await api.noteAdd(r.url, text))) }));
  });
  wrap.appendChild(add);
  return wrap;
}

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

// Brave Search is the default web source but needs the user's own API key.
// Say so once, the first time Scout starts without one.
if (api?.getSettings && !store.get("scout.braveHint", false)) {
  api.getSettings().then((s) => {
    const brave = s.providers?.brave;
    if (!brave?.enabled || brave.keySet || !s.firstRunDone) return; // first-run setup asks for the key
    store.set("scout.braveHint", true);
    showNotice("Brave Search is the default web source. Add your Brave Search API key in Settings. Until then, web results come from DuckDuckGo.", [
      { label: "Open Settings", run: () => openSources() },
    ]);
  });
}

startCrawlClock();

if (api) {
  api.onTabEvent((payload) => {
    if (payload.tabs) tabs = payload.tabs;
    if (Array.isArray(payload.mosaic)) mosaicShown = payload.mosaic;
    if (payload.activeId) activeId = payload.activeId;
    if (payload.tab) {
      tabs = tabs.map((t) => (t.id === payload.tab.id ? payload.tab : t));
    }
    renderTabs();
    if (payload.type === "find") {
      if (payload.tabId === activeId) findCount.textContent = payload.total ? `${payload.active}/${payload.total}` : "0/0";
      return;
    }
    if (payload.type === "google-signin-blocked") {
      showNotice("Google does not allow signing in inside NODE's engine. Turn on the Google window in Settings to sign in there, or use your default browser.", [
        { label: "Open in default browser", run: () => api.openExternal("https://accounts.google.com/") },
      ]);
      return;
    }
    if (payload.type === "google-window") {
      // Explain once per session; after that the placeholder tab says it.
      if (payload.ok && googleNoticeShown) return;
      if (payload.ok) googleNoticeShown = true;
      showNotice(
        payload.ok
          ? "Opened in the Google window. Google account pages open there because Google does not allow sign-in inside NODE's engine."
          : "No Chromium-based browser (Brave, Chromium, Edge, Vivaldi or Chrome) was found for the Google window, so this page opened in your default browser.",
        []
      );
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
    if (msg.cmd === "google-window-status") return fillGoogleState(msg);
    if (msg.cmd === "agents-status") return fillAgents(msg);
    if (msg.cmd === "agent-step") {
      agentRun.steps.push(msg);
      return renderAgent();
    }
    if (msg.cmd === "focus-omni") {
      if (typeof chromeLayout !== "undefined" && chromeLayout === "side") return openCommandBar({ newTab: Boolean(msg.newTab) });
      omni.focus();
      omni.select();
    } else if (msg.cmd === "bookmark-toggle") {
      toggleBookmark();
    } else if (msg.cmd === "open-bookmarks") {
      shelfFolder = "bookmarks";
      document.querySelectorAll("#shelf-filters .chip").forEach((c) => c.classList.toggle("active", c.dataset.folder === "bookmarks"));
      openLibrary();
    } else if (msg.cmd === "sound-all") {
      soundAll = msg.on;
      store.set("scout.soundAll", soundAll);
      paintSound();
    } else if (msg.cmd === "toggle-layout") {
      layoutBtn.click();
    } else if (msg.cmd === "layout") {
      // The main process left Mosaic by itself (a tab without a tile became active).
      layout = msg.mode === "mosaic" ? "mosaic" : "focus";
      paintLayout(true);
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
      if (!sourcesPane.hidden) renderRulesList();
      const text = `Site rules: ${msg.count} rules in use.` + (msg.errors?.length ? " Problems: " + msg.errors.join(" ") : "");
      if (msg.errors?.length) showNotice(text);
      const m = document.getElementById("rules-msg");
      if (m) m.textContent = text;
    } else if (msg.cmd === "error") {
      showNotice(msg.message);
    } else if (msg.cmd === "notice") {
      showNotice(msg.message, msg.file ? [{ label: "Show in folder", run: () => api.revealFile(msg.file) }] : []);
    } else if (msg.cmd === "update-ready") {
      showNotice(`NODE ${msg.version} is ready to install.`, [{ label: "Restart now", run: () => api.installUpdate() }]);
    } else if (msg.cmd === "update-error") {
      showNotice(`${msg.message} You can download NODE from the releases page.`, [{ label: "Open releases", run: () => api.openReleases() }]);
    } else if (msg.cmd === "downloads") {
      paintDownloads(msg);
    } else if (msg.cmd === "pin-keyword") {
      showPane("suggest");
      pinKeyword(msg.text);
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

// ---- Ask AI (core/chat.js) ----
// About this page, the tabs in Mosaic, or the research session (B49). One
// conversation per page address, one for Mosaic and one for the session.
// Answers about several pages cite them as [1] to [n]: each number opens
// that page, and the sources are listed under the answer.
const askLog = document.getElementById("ask-log");
const askInput = document.getElementById("ask-input");
let askScope = "page";
let ask = { key: "", messages: [] };
const ASK_SCOPES = {
  page: {
    kicker: "This page",
    placeholder: "Ask about this page (Enter to send, Shift+Enter for a new line)",
    sends: "this page's text, title and address",
    quick: [
      ["Summarize", "Summarize this page in 5 bullet points."],
      ["Key facts", "What are the key facts, names and dates on this page?"],
      ["What next?", "What questions does this page leave open, and what should I read next to answer them?"],
    ],
  },
  mosaic: {
    kicker: "Tabs in Mosaic",
    placeholder: "Ask about the tabs in Mosaic (Enter to send)",
    sends: "the text, titles and addresses of the tabs Mosaic shows (up to 10)",
    quick: [
      ["Compare", "Compare these pages: what does each one add?"],
      ["Disagreements", "Where do these pages disagree?"],
      ["Summarize all", "Summarize what these pages say together, in 5 bullet points."],
    ],
  },
  session: {
    kicker: "Research session",
    placeholder: "Ask about the pages you read in this session (Enter to send)",
    sends: "the text of the 8 pages you read most recently in this research session (pages that are not open are read again, logged out)",
    quick: [
      ["Summarize session", "", "summary"],
      ["Key findings", "What are the key findings across these pages?"],
      ["What's missing?", "What do these pages not answer yet, and what should I look for next?"],
    ],
  },
};

function askTab() {
  return tabs.find((t) => t.id === activeId);
}
function askKey() {
  return askScope === "page" ? "page:" + (askTab()?.url || "") : askScope;
}

// Text with [n] citations: each number becomes a button that opens the source.
function citedNodes(text, sources) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of String(text).matchAll(/\[(\d{1,2})\]/g)) {
    const src = sources?.find((s) => s.n === Number(m[1]));
    if (!src) continue;
    frag.append(text.slice(last, m.index));
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cite";
    b.textContent = m[1];
    b.title = `${src.title}\n${src.url}`;
    b.setAttribute("aria-label", `Source ${m[1]}: ${src.title}`);
    b.addEventListener("click", () => openSource(src.url));
    frag.append(b);
    last = m.index + m[0].length;
  }
  frag.append(String(text).slice(last));
  return frag;
}
function openSource(url) {
  const open = tabs.find((t) => t.url === url);
  if (open) api.activateTab(open.id);
  else api.createTab(url);
}

function renderAsk() {
  askLog.innerHTML = "";
  for (const m of ask.messages) {
    const el = document.createElement("div");
    el.className = "ask-msg " + m.role;
    if (m.role === "assistant" && m.sources?.length) {
      const body = document.createElement("div");
      body.className = "ask-text";
      body.append(citedNodes(m.content, m.sources));
      el.append(body);
      if (m.file) {
        const saved = document.createElement("p");
        saved.className = "ask-saved";
        saved.textContent = `Saved to the Library: ${m.file}`;
        el.append(saved);
      }
      const list = document.createElement("ol");
      list.className = "ask-sources";
      for (const s of m.sources) {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = s.title;
        b.title = s.url;
        b.addEventListener("click", () => openSource(s.url));
        li.append(b, Object.assign(document.createElement("span"), { textContent: " " + hostOf(s.url) }));
        list.append(li);
      }
      el.append(list);
    } else el.textContent = m.content;
    askLog.appendChild(el);
  }
  askLog.scrollTop = askLog.scrollHeight;
}

async function paintAskScope() {
  const conf = ASK_SCOPES[askScope];
  for (const b of document.querySelectorAll("#ask-scope [data-scope]")) {
    const on = b.dataset.scope === askScope;
    b.classList.toggle("active", on);
    b.setAttribute("aria-checked", String(on));
  }
  document.getElementById("ask-kicker").textContent = conf.kicker;
  askInput.placeholder = conf.placeholder;
  const quick = document.getElementById("ask-quick");
  quick.innerHTML = "";
  for (const [label, q, action] of conf.quick) {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = label;
    if (q) b.dataset.q = q;
    if (action) b.dataset.action = action;
    quick.append(b);
  }
  if (ask.key !== askKey()) ask = { key: askKey(), messages: [] };
  const info = api?.chatInfo ? await api.chatInfo() : { ready: false };
  document.getElementById("ask-privacy").textContent = info.ready
    ? `Questions send ${conf.sends} to ${info.provider === "grok" ? "Grok (xAI)" : "your local model"} (${info.model}). Nothing is sent until you ask.`
    : "Set up a model first in Settings → AI: a local model (Ollama or LM Studio) or a Grok API key.";
  renderAsk();
}

async function openAsk() {
  if (!api?.askPage) return showNotice("Ask needs the desktop app.");
  showPane("ask");
  await paintAskScope();
  askInput.focus();
}

async function sendAsk(question) {
  const q = String(question || "").trim();
  const tab = askTab();
  if (!q || (askScope === "page" && !tab)) return;
  if (ask.key !== askKey()) ask = { key: askKey(), messages: [] };
  const history = ask.messages.filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ role: m.role, content: m.content }));
  ask.messages.push({ role: "user", content: q });
  ask.messages.push({ role: "pending", content: askScope === "page" ? "Thinking…" : "Reading the pages…" });
  renderAsk();
  askInput.value = "";
  const r = askScope === "page" ? await api.askPage(tab.id, q, history) : await api.askScope(askScope, q, history);
  ask.messages.pop();
  ask.messages.push(r.ok ? { role: "assistant", content: r.answer, sources: r.sources } : { role: "error", content: r.error });
  renderAsk();
}

async function summarizeSession() {
  if (ask.key !== askKey()) ask = { key: askKey(), messages: [] };
  ask.messages.push({ role: "user", content: "Summarize this research session" });
  ask.messages.push({ role: "pending", content: "Reading the pages and writing a summary…" });
  renderAsk();
  const r = await api.summarizeSession();
  ask.messages.pop();
  ask.messages.push(r.ok ? { role: "assistant", content: r.summary.replace(/\n## Sources[\s\S]*$/, "").trim(), sources: r.sources, file: r.file } : { role: "error", content: r.error });
  renderAsk();
}

document.getElementById("ask-btn").addEventListener("click", openAsk);
document.getElementById("ask-scope").addEventListener("click", (e) => {
  const b = e.target.closest("[data-scope]");
  if (!b || b.dataset.scope === askScope) return;
  askScope = b.dataset.scope;
  paintAskScope();
});
document.getElementById("ask-clear").addEventListener("click", () => {
  ask.messages = [];
  renderAsk();
});
document.getElementById("ask-quick").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.action === "summary") summarizeSession();
  else if (b.dataset.q) sendAsk(b.dataset.q);
});
document.getElementById("ask-form").addEventListener("submit", (e) => {
  e.preventDefault();
  sendAsk(askInput.value);
});
askInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendAsk(askInput.value);
  }
});

// Settings → Hidden keywords: every hidden word, grouped by site.
function renderHiddenList() {
  const list = document.getElementById("hidden-list");
  if (!list) return;
  list.innerHTML = "";
  const sites = Object.keys(hiddenBySite).sort((a, b) => (a === "*" ? -1 : b === "*" ? 1 : a.localeCompare(b)));
  if (!sites.length) {
    const li = document.createElement("li");
    li.className = "help";
    li.textContent = "None. Hide a keyword with × in the Suggestions pane.";
    list.appendChild(li);
    return;
  }
  for (const site of sites) {
    const li = document.createElement("li");
    li.className = "hidden-site";
    const name = document.createElement("b");
    name.textContent = site === "*" ? "All sites" : site;
    li.appendChild(name);
    const words = document.createElement("div");
    words.className = "keys";
    for (const w of hiddenBySite[site]) {
      const chip = document.createElement("span");
      chip.className = "key";
      chip.textContent = w;
      const x = document.createElement("button");
      x.textContent = "×";
      x.title = "Allow this keyword again";
      x.addEventListener("click", () => {
        unhideKeyword(w, site);
        renderKeys();
      });
      chip.appendChild(x);
      words.appendChild(chip);
    }
    li.appendChild(words);
    list.appendChild(li);
  }
}
renderHiddenList();

// ---- Toolbar icons, suggestions widget, menu overlay, full screen ----
// Toolbar buttons are icons. Each one names itself (and its shortcut) in a
// tooltip on hover, through the native title, and to screen readers through
// aria-label. Rules of thumb used: recognition over recall (every icon has a
// name one hover away), progressive disclosure (the widget and the menu are
// one click away, behind named controls).

// "var" and function declarations: earlier parts of this file paint buttons
// before this part runs.
var menuOpen = false;
var menuSection = "library";
var panelOpen = true;

function icon(name, cls = "") {
  return `<svg class="ic${cls ? " " + cls : ""}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

// "mod+shift+M" → "⌘⇧M" on a Mac, "Ctrl+Shift+M" elsewhere.
function keyLabel(keys) {
  if (!keys) return "";
  const mac = /Mac/.test(navigator.platform);
  if (keys === "ctrl+mod+F" && !mac) return "F11"; // the system's full-screen key
  const parts = keys.split("+");
  const key = parts.pop();
  const names = mac
    ? { mod: "⌘", shift: "⇧", ctrl: "⌃", alt: "⌥" }
    : { mod: "Ctrl", shift: "Shift", ctrl: "Ctrl", alt: "Alt" };
  const mods = parts.map((m) => names[m] || m);
  const shown = key.length === 1 ? key.toUpperCase() : key;
  return mac ? mods.join("") + shown : [...mods, shown].join("+");
}

function setTip(btn, tip) {
  if (!btn) return;
  if (tip) btn.dataset.tip = tip;
  const keys = keyLabel(btn.dataset.keys);
  btn.setAttribute("aria-label", btn.dataset.tip);
  btn.title = keys ? `${btn.dataset.tip}  (${keys})` : btn.dataset.tip;
  if (keys) btn.setAttribute("aria-keyshortcuts", btn.dataset.keys.replace(/mod/g, /Mac/.test(navigator.platform) ? "Meta" : "Control"));
}
document.querySelectorAll("[data-tip]").forEach((b) => setTip(b));
document.querySelectorAll(".mnav").forEach((b) => (b.querySelector("kbd").textContent = keyLabel(b.dataset.keys)));
paintLayout();

// In full screen the toolbar stays on screen while one of these is in use.
var chromeHolds = new Set();
function holdChrome(key, on) {
  if (on) chromeHolds.add(key);
  else chromeHolds.delete(key);
  api?.holdChrome?.(chromeHolds.size > 0);
}
omni.addEventListener("focus", () => holdChrome("omni", true));
omni.addEventListener("blur", () => holdChrome("omni", false));

// ---- Suggestions widget: floats beside the page, collapses to the toolbar ----
const railEl = document.getElementById("rail");
const shellEl = document.querySelector(".shell");
const suggestToggle = document.getElementById("suggest-toggle");
const suggestCollapse = document.getElementById("suggest-collapse");
const PANEL_W = 340; // widget width
const PANEL_GAP = 8; // space around it
let seenWhileCollapsed = null; // result addresses on screen when it was collapsed

function panelSpace() {
  return panelOpen ? PANEL_W + PANEL_GAP * 2 : 0;
}

function sendPanelSpace(animate = null) {
  const w = panelSpace();
  if (api?.setPanelWidth) api.setPanelWidth(w, { animate });
  else api?.setSidebarWidth?.(w);
}

function resultUrls() {
  return [...resultsEl.querySelectorAll(".card")].map((c) => c.__item?.url).filter(Boolean);
}

function paintSuggestCount() {
  const count = document.getElementById("suggest-count");
  const fresh = document.getElementById("suggest-new");
  if (panelOpen) {
    count.hidden = fresh.hidden = true;
    suggestToggle.classList.remove("has-count");
    return;
  }
  const urls = resultUrls();
  const added = seenWhileCollapsed ? urls.filter((u) => !seenWhileCollapsed.has(u)).length : 0;
  count.textContent = urls.length;
  count.hidden = !urls.length;
  fresh.textContent = `+${added}`;
  fresh.hidden = !added;
  suggestToggle.classList.toggle("has-count", urls.length > 0);
  setTip(suggestToggle, `Show suggestions${urls.length ? `: ${urls.length} results` : ""}${added ? `, ${added} new` : ""}`);
}
new MutationObserver(() => panelOpen || paintSuggestCount()).observe(resultsEl, { childList: true });

// Motion 10: animate (user action only) slides the widget in from the right
// edge or out to it, and main.js resizes the page on the same curve, so the
// page edge and the widget move together. Closing keeps the widget's column
// until it has left.
let railTimer = null;
function setPanelOpen(on, { focus = false, animate = false } = {}) {
  const changed = panelOpen !== undefined && panelOpen !== Boolean(on);
  panelOpen = Boolean(on);
  store.set("node.panelOpen", panelOpen);
  seenWhileCollapsed = panelOpen ? null : new Set(resultUrls());
  const moving = animate && changed;
  clearTimeout(railTimer);
  railEl.classList.remove("arriving", "leaving");
  if (panelOpen) {
    railEl.hidden = false;
    shellEl.style.setProperty("--panel-space", `${panelSpace()}px`);
    if (moving) {
      railEl.classList.add("arriving");
      void railEl.offsetWidth; // start from off the right edge
      railEl.classList.remove("arriving");
    }
  } else if (moving) {
    railEl.classList.add("leaving");
    railTimer = setTimeout(() => {
      railEl.hidden = true;
      railEl.classList.remove("leaving");
      shellEl.style.setProperty("--panel-space", "0px");
    }, motionMs("--motion-fast"));
  } else {
    railEl.hidden = true;
    shellEl.style.setProperty("--panel-space", "0px");
  }
  suggestToggle.classList.toggle("active", panelOpen);
  suggestToggle.setAttribute("aria-pressed", String(panelOpen));
  suggestCollapse.setAttribute("aria-expanded", String(panelOpen));
  if (panelOpen) setTip(suggestToggle, "Hide suggestions");
  paintSuggestCount();
  sendPanelSpace(moving ? (panelOpen ? "open" : "close") : null);
  if (focus) (panelOpen ? document.querySelector('.ptab[aria-selected="true"]') : suggestToggle)?.focus();
}
suggestToggle.addEventListener("click", () => setPanelOpen(!panelOpen, { animate: true }));
suggestCollapse.addEventListener("click", () => setPanelOpen(false, { focus: true, animate: true }));
document.getElementById("suggest-tab").addEventListener("click", () => showPane("suggest"));
// Arrow keys move between the widget's tabs.
document.querySelector(".panel-tabs").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const tabsList = [...document.querySelectorAll(".ptab")];
  const i = tabsList.indexOf(document.activeElement);
  if (i < 0) return;
  const next = tabsList[(i + (e.key === "ArrowRight" ? 1 : tabsList.length - 1)) % tabsList.length];
  next.focus();
  next.click();
});
setPanelOpen(store.get("node.panelOpen", true));
showPane("suggest");

// ---- Menu overlay: Library, Bookmarks, History, Downloads, Trail, Settings, Help ----
const overlayEl = document.getElementById("menu-overlay");
const menuPanel = document.getElementById("menu-panel");
const menuShots = document.getElementById("menu-shots");
const SHELF_TITLES = { library: "Library", bookmarks: "Bookmarks", history: "History", downloads: "Downloads" };
let menuReturnFocus = null;

function paintMenuNav() {
  for (const b of document.querySelectorAll(".mnav")) {
    const on = b.dataset.section === menuSection;
    b.classList.toggle("active", on);
    if (on) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
}

async function renderMenuSection() {
  const sec = menuSection;
  const shelf = sec in SHELF_TITLES;
  libraryEl.hidden = !shelf;
  document.getElementById("trail-pane").hidden = sec !== "trail";
  sourcesPane.hidden = sec !== "settings" && sec !== "help";
  if (shelf) {
    if (sec !== "library") shelfFolder = sec;
    else if (["bookmarks", "history", "downloads"].includes(shelfFolder)) shelfFolder = "all";
    document.getElementById("shelf-title").textContent = SHELF_TITLES[sec];
    document.getElementById("shelf-filters").hidden = sec !== "library";
    document.querySelectorAll("#shelf-filters .chip").forEach((c) => c.classList.toggle("active", c.dataset.folder === shelfFolder));
    await renderShelf();
  } else if (sec === "trail") {
    await renderTrail();
  } else {
    renderRulesList();
    await renderSources();
    const scroller = document.getElementById("menu-content");
    if (sec === "help") document.getElementById("help-box").scrollIntoView({ block: "start" });
    else scroller.scrollTop = 0;
  }
}

// Motion 11: the menu fades in over a picture of the pages (scrim and panel,
// --motion-base, --ease-enter) and fades out (--motion-fast, --ease-exit)
// before the live pages come back, so nothing appears or vanishes in one frame.
let menuCloseSeq = 0;
async function openMenu(section = menuSection) {
  if ((section === "settings" || section === "help") && !api?.getSettings) return showNotice("Settings can only be changed in the desktop app.");
  if (section === "trail" && !api?.researchGet) return showNotice("The research trail needs the desktop app.");
  const opening = !menuOpen;
  menuSection = section;
  if (opening) {
    menuOpen = true;
    menuCloseSeq++; // a close still fading out stops here
    menuReturnFocus = document.activeElement;
    overlayEl.hidden = false;
    document.getElementById("menu-btn").setAttribute("aria-expanded", "true");
    // The pages are native views drawn above this window's HTML: hide them,
    // and show a picture of them dimmed behind the menu instead.
    const r = api?.setLibraryOpen ? await api.setLibraryOpen(true, { snapshot: true }) : null;
    if (r?.shots?.length) {
      menuShots.innerHTML = "";
      for (const shot of r.shots) {
        const img = document.createElement("img");
        img.alt = "";
        img.src = shot.src;
        Object.assign(img.style, { left: `${shot.rect.x}px`, top: `${shot.rect.y}px`, width: `${shot.rect.width}px`, height: `${shot.rect.height}px` });
        menuShots.appendChild(img);
      }
    }
    if (menuOpen) {
      void overlayEl.offsetWidth;
      overlayEl.classList.add("open");
    }
  }
  paintMenuNav();
  await renderMenuSection();
  if (opening && menuOpen) document.querySelector(".mnav.active")?.focus();
}

async function closeMenu() {
  if (!menuOpen) return;
  menuOpen = false;
  const seq = ++menuCloseSeq;
  overlayEl.classList.remove("open");
  document.getElementById("menu-btn").setAttribute("aria-expanded", "false");
  const back = menuReturnFocus?.isConnected && !overlayEl.contains(menuReturnFocus) ? menuReturnFocus : document.getElementById("menu-btn");
  back.focus();
  await new Promise((r) => setTimeout(r, motionMs("--motion-fast")));
  if (seq !== menuCloseSeq) return; // opened again while fading out
  if (api?.setLibraryOpen) await api.setLibraryOpen(false);
  if (seq !== menuCloseSeq) return;
  overlayEl.hidden = true;
  menuShots.innerHTML = "";
}

document.getElementById("menu-btn").addEventListener("click", () => (menuOpen ? closeMenu() : openMenu()));
document.getElementById("menu-close").addEventListener("click", () => closeMenu());
document.getElementById("menu-scrim").addEventListener("click", () => closeMenu());
document.querySelector(".menu-nav").addEventListener("click", (e) => {
  const b = e.target.closest(".mnav");
  if (b) openMenu(b.dataset.section);
});
// Esc closes the menu wherever focus is; Tab stays inside it while it is open.
window.addEventListener("keydown", (e) => {
  if (menuOpen && e.key === "Escape") {
    e.preventDefault();
    closeMenu();
  }
});
overlayEl.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const items = [...menuPanel.querySelectorAll("button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])")].filter(
    (el) => !el.disabled && el.offsetParent !== null
  );
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});

// ---- Capture: one toolbar button, a native menu (it draws over the page) ----
const captureActions = { shot: "shot-btn", save: "save-btn", media: "media-btn", pip: "pip-btn" };
document.getElementById("capture-btn").addEventListener("click", (e) => {
  if (!api?.captureMenu) return;
  const r = e.currentTarget.getBoundingClientRect();
  // In full screen the real toolbar is moved out of view and its copy is shown at the top.
  const shift = document.body.classList.contains("immersive") ? chromeHeader.offsetHeight : 0;
  api.captureMenu(r.left, r.bottom + 4 + shift);
});

// ---- Full screen: the toolbar hides and comes back at the top edge ----
const fullBtn = document.getElementById("fullscreen-btn");
const chromeHint = document.getElementById("chrome-hint");
let hintTimer = null;
fullBtn.addEventListener("click", () => api?.toggleFullscreen?.());

function paintChrome(msg) {
  if (msg.immersive !== document.body.classList.contains("immersive")) mirrorWhileImmersive(msg.immersive);
  document.body.classList.toggle("immersive", msg.immersive);
  document.body.classList.toggle("chrome-hidden", msg.immersive && !msg.shown);
  fullBtn.innerHTML = icon(msg.immersive ? "exit-fullscreen" : "fullscreen");
  setTip(fullBtn, msg.immersive ? "Exit full screen" : "Full screen");
  if (msg.hint) {
    chromeHint.textContent = `Toolbar hides in full screen. Move the pointer to the top edge to show it. ${keyLabel("ctrl+mod+F")} to exit.`;
    chromeHint.hidden = false;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => (chromeHint.hidden = true), 4000);
  }
  if (!msg.immersive) chromeHint.hidden = true;
}

// ---- Full-screen toolbar layer (motion 09) ----
// In full screen the toolbar is shown in its own layer above the page
// (chrome-overlay.html, made by main.js). This window keeps the real toolbar
// (moved out of view) and sends the layer a copy of it whenever it changes;
// the layer sends clicks and typing back here. Elements are matched by their
// position under the toolbar.
const chromeHeader = document.querySelector("header.chrome");
let mirrorTimer = null;
let mirrorLast = "";
let spriteSent = false;
function headerPath(el) {
  const path = [];
  while (el && el !== chromeHeader) {
    if (!el.parentElement) return null;
    path.unshift([...el.parentElement.children].indexOf(el));
    el = el.parentElement;
  }
  return el === chromeHeader ? path : null;
}
const headerAt = (path) => path.reduce((el, i) => el?.children[i], chromeHeader);
function sendMirror() {
  const html = chromeHeader.innerHTML;
  const values = [...chromeHeader.querySelectorAll("input")].map((el) => [headerPath(el), el.value]);
  const key = html + JSON.stringify(values);
  if (key === mirrorLast && spriteSent) return;
  mirrorLast = key;
  const m = { html, values };
  if (!spriteSent) {
    m.sprite = document.querySelector("body > svg")?.outerHTML || "";
    spriteSent = true;
  }
  api?.chromeMirror?.(m);
}
function mirrorWhileImmersive(on) {
  clearInterval(mirrorTimer);
  mirrorTimer = null;
  if (!on) return;
  sendMirror();
  mirrorTimer = setInterval(sendMirror, 120); // cheap: sends only when something changed
}
// A field in the real toolbar got focus in full screen (Cmd+L, Cmd+F, Tab):
// type in the layer's copy instead, which is the one on screen.
chromeHeader.addEventListener("focusin", (e) => {
  if (!document.body.classList.contains("immersive") || e.target.tagName !== "INPUT" || !api?.focusOverlayField) return;
  const path = headerPath(e.target);
  sendMirror();
  e.target.blur();
  if (path) api.focusOverlayField(path);
});
function overlayEvent(ev) {
  const el = headerAt(ev.path || []);
  if (!el) return;
  const mods = { shiftKey: ev.shiftKey, metaKey: ev.metaKey, ctrlKey: ev.ctrlKey, altKey: ev.altKey };
  if (ev.type === "input") {
    el.value = ev.value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } else if (ev.type === "keydown") {
    if (typeof ev.value === "string") el.value = ev.value;
    if (ev.key === "Enter" && el.form) el.form.requestSubmit();
    else el.dispatchEvent(new KeyboardEvent("keydown", { key: ev.key, bubbles: true, cancelable: true, ...mods }));
  } else if (["click", "dblclick", "auxclick", "contextmenu"].includes(ev.type)) {
    // The real toolbar sits one toolbar-height above the window in full screen.
    const y = (ev.y || 0) - chromeHeader.offsetHeight;
    el.dispatchEvent(new MouseEvent(ev.type, { bubbles: true, cancelable: true, button: ev.button || 0, detail: ev.detail || 1, clientX: ev.x || 0, clientY: y, ...mods }));
  }
  sendMirror();
}

api?.onCommand?.((msg) => {
  if (msg.cmd === "overlay-event") return overlayEvent(msg.event || {});
  if (msg.cmd === "capture") document.getElementById(captureActions[msg.action])?.click();
  else if (msg.cmd === "chrome") paintChrome(msg);
  else if (msg.cmd === "toggle-suggest") setPanelOpen(!panelOpen, { focus: true, animate: true });
  else if (msg.cmd === "open-menu") {
    openMenu(msg.section || menuSection).then(() => msg.box && setTimeout(() => (document.getElementById(msg.box)?.previousElementSibling || document.getElementById(msg.box))?.scrollIntoView({ block: "start" }), 300));
  } else if (msg.cmd === "passwords-changed") renderPasswords().catch(() => {});
  else if (msg.cmd === "overview") openOverview();
  else if (msg.cmd === "sidebar-toggle") toggleSidebar();
  else if (msg.cmd === "sidebar-rail") chromeLayout === "side" && setSideState(sideState === "rail" ? "full" : "rail");
  else if (msg.cmd === "chrome-layout") applyChromeLayout(msg.mode);
  else if (msg.cmd === "tour") startTour();
});

// ---- Tab overview (B71) ----
// Zoom out to every open tab and pick which ones Mosaic shows, like selecting
// photos: click (or Space) picks or unpicks a tab, Done shows the picked tabs
// in Mosaic, Esc or Cancel leaves everything as it was. None picked + Done:
// Mosaic shows its usual tabs (the first ones and the current one).
const ovEl = document.getElementById("overview");
const ovGrid = document.getElementById("ov-grid");
const ovCount = document.getElementById("ov-count");
const CHECK_SVG = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square"/></svg>';
let ovOpen = false;
let ovMax = 4;
let ovPicked = [];
let ovReturnFocus = null;
let ovCloseSeq = 0;

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch (_) {
    return url || "";
  }
}

function paintOverview() {
  if (typeof tourCheck === "function") setTimeout(tourCheck, 0);
  const full = ovMax && ovPicked.length >= ovMax;
  ovCount.textContent = ovPicked.length ? `${ovPicked.length} of ${ovMax || "all"} picked` : ovMax ? `Pick up to ${ovMax}` : "Pick any tabs";
  ovCount.classList.toggle("full", Boolean(full));
  for (const card of ovGrid.children) {
    const on = ovPicked.includes(card.dataset.id);
    card.setAttribute("aria-selected", String(on));
    card.classList.toggle("blocked", Boolean(full && !on));
    card.setAttribute("aria-disabled", String(Boolean(full && !on)));
  }
  document.getElementById("ov-clear").disabled = !ovPicked.length;
}

function toggleOverviewPick(id) {
  const i = ovPicked.indexOf(id);
  if (i >= 0) ovPicked.splice(i, 1);
  else if (!ovMax || ovPicked.length < ovMax) ovPicked.push(id);
  else {
    ovCount.textContent = `Mosaic holds ${ovMax}. Unpick one first.`;
    return;
  }
  paintOverview();
}

async function openOverview() {
  if (ovOpen || !api?.openOverview) return;
  if (menuOpen) await closeMenu();
  ovOpen = true;
  ovCloseSeq++;
  ovReturnFocus = document.activeElement;
  holdChrome("overview", true);
  const r = await api.openOverview();
  ovMax = r.max;
  ovPicked = r.tabs.filter((t) => t.tile).map((t) => t.id);
  ovGrid.innerHTML = "";
  for (const t of r.tabs) {
    const card = document.createElement("div");
    card.className = "ov-card arriving";
    card.dataset.id = t.id;
    card.setAttribute("role", "option");
    card.tabIndex = t.id === r.activeId ? 0 : -1;
    const thumb = document.createElement("div");
    thumb.className = "ov-thumb";
    if (t.thumb) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = t.thumb;
      thumb.appendChild(img);
    } else {
      const e = document.createElement("div");
      e.className = "ov-empty";
      e.textContent = t.sleeping ? "Asleep. Its picture appears after you open it." : hostOf(t.url) || "New tab";
      thumb.appendChild(e);
    }
    const check = document.createElement("span");
    check.className = "ov-check";
    check.innerHTML = CHECK_SVG;
    thumb.appendChild(check);
    const meta = document.createElement("div");
    meta.className = "ov-meta";
    meta.innerHTML = `<span class="ov-title"></span><span class="ov-host"></span>`;
    meta.firstChild.textContent = t.title || "New tab";
    meta.lastChild.textContent = t.id === r.activeId ? "" : hostOf(t.url);
    if (t.id === r.activeId) {
      const now = document.createElement("span");
      now.className = "ov-now";
      now.textContent = "Current tab · " + hostOf(t.url);
      meta.lastChild.replaceWith(now);
    }
    card.setAttribute("aria-label", `${t.title || "New tab"}, ${hostOf(t.url)}`);
    card.append(thumb, meta);
    ovGrid.appendChild(card);
  }
  paintOverview();
  ovEl.hidden = false;
  // Zoom out: the current tab's picture shrinks from where the page was into its card.
  const active = ovGrid.querySelector(`.ov-card[data-id="${CSS.escape(r.activeId || "")}"]`);
  const from = r.tabs.find((t) => t.id === r.activeId);
  const target = active?.querySelector(".ov-thumb");
  if (target && from?.thumb && !reducedMotion()) {
    const page = from.rect || r.page;
    const to = target.getBoundingClientRect();
    const fly = document.createElement("img");
    fly.className = "ov-fly";
    fly.src = from.thumb;
    Object.assign(fly.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` });
    ovEl.appendChild(fly);
    target.style.visibility = "hidden";
    const sx = page.width / to.width;
    const sy = page.height / to.height;
    const anim = fly.animate(
      [{ transform: `translate(${page.x - to.left}px, ${page.y - to.top}px) scale(${sx}, ${sy})` }, { transform: "none" }],
      { duration: parseFloat(motionCurve("--motion-slow")) || 320, easing: motionCurve("--ease-enter") || "ease-out" }
    );
    const done = () => {
      fly.remove();
      target.style.visibility = "";
    };
    anim.onfinish = done;
    anim.oncancel = done;
  }
  void ovEl.offsetWidth;
  ovEl.classList.add("open");
  requestAnimationFrame(() => ovGrid.querySelectorAll(".arriving").forEach((c) => c.classList.remove("arriving")));
  (active || ovGrid.firstElementChild)?.focus();
  active?.scrollIntoView({ block: "nearest" });
}

async function closeOverview(apply) {
  if (!ovOpen) return;
  ovOpen = false;
  const seq = ++ovCloseSeq;
  ovEl.querySelector(".ov-fly")?.remove();
  const ids = apply ? [...ovGrid.children].map((c) => c.dataset.id).filter((id) => ovPicked.includes(id)) : null;
  ovEl.classList.remove("open");
  if (!reducedMotion()) await new Promise((r) => setTimeout(r, parseFloat(motionCurve("--motion-fast")) || 120));
  if (seq !== ovCloseSeq) return; // opened again while fading out
  ovEl.hidden = true;
  ovGrid.innerHTML = "";
  holdChrome("overview", false);
  const mode = await api.closeOverview(ids);
  if (apply) {
    layout = mode;
    paintLayout(true);
  }
  const back = ovReturnFocus?.isConnected ? ovReturnFocus : layoutBtn;
  back.focus?.();
}

ovGrid.addEventListener("click", (e) => {
  const card = e.target.closest(".ov-card");
  if (!card) return;
  card.focus();
  toggleOverviewPick(card.dataset.id);
});
ovGrid.addEventListener("dblclick", (e) => {
  // Double-click: pick the tab (if it is not picked yet) and finish.
  const card = e.target.closest(".ov-card");
  if (card && !ovPicked.includes(card.dataset.id)) toggleOverviewPick(card.dataset.id);
  if (card) closeOverview(true);
});
document.getElementById("ov-done").addEventListener("click", () => closeOverview(true));
document.getElementById("ov-cancel").addEventListener("click", () => closeOverview(false));
document.getElementById("ov-clear").addEventListener("click", () => {
  ovPicked = [];
  paintOverview();
});
ovEl.addEventListener("keydown", (e) => {
  const cards = [...ovGrid.children];
  const card = e.target.closest?.(".ov-card");
  if (e.key === "Escape") {
    e.preventDefault();
    return closeOverview(false);
  }
  if (e.key === "Enter" && !e.target.closest("button")) {
    e.preventDefault();
    return closeOverview(true);
  }
  if (card && (e.key === " " || e.key === "Spacebar")) {
    e.preventDefault();
    return toggleOverviewPick(card.dataset.id);
  }
  if (card && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
    e.preventDefault();
    const i = cards.indexOf(card);
    const cols = Math.max(1, cards.filter((c) => c.offsetTop === cards[0].offsetTop).length);
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
    const j = e.key === "Home" ? 0 : e.key === "End" ? cards.length - 1 : Math.min(cards.length - 1, Math.max(0, i + step));
    card.tabIndex = -1;
    cards[j].tabIndex = 0;
    cards[j].focus();
    cards[j].scrollIntoView({ block: "nearest" });
    return;
  }
  if (e.key === "Tab") {
    // Tab moves between the grid and the buttons, and stays in the overview.
    const stops = [...ovEl.querySelectorAll("button:not([disabled]), .ov-card[tabindex='0']")];
    const i = stops.indexOf(document.activeElement);
    e.preventDefault();
    stops[(i + (e.shiftKey ? stops.length - 1 : 1)) % stops.length]?.focus();
  }
});


// ---- Gestures tutorial (B72) ----
// Teaches the trackpad gestures and keyboard shortcuts one step at a time, on
// practice tabs NODE opens for it (main.js tour:start), and waits until each
// step is done, by gesture or by shortcut. A band at the bottom of the window
// holds the coach; the pages above it shrink to make room. Ends by closing the
// practice tabs and putting back the user's tabs, tiles and layout.
const coachEl = document.getElementById("coach");
const COACH_H = 132;
const isMacUi = /Mac/.test(navigator.platform || navigator.userAgent);
const kbd = (...keys) =>
  keys.map((k) => `<kbd>${k === "mod" ? (isMacUi ? "⌘" : "Ctrl") : k === "shift" ? (isMacUi ? "⇧" : "Shift") : escapeHtml(k)}</kbd>`).join("");
const PAD_SVG = `<svg class="pad" viewBox="0 0 52 36" aria-hidden="true"><rect x="1" y="1" width="50" height="34" rx="4" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5"/><circle class="finger" cx="22" cy="16" r="4" fill="currentColor"/><circle class="finger b" cx="30" cy="20" r="4" fill="currentColor"/></svg>`;
let tour = null; // { i, ids, video, advancing }
const tourOn = () => Boolean(tour);
const tabById = (id) => tabs.find((t) => t.id === id);
const TOUR_STEPS = [
  { title: "Zoom out to Mosaic", text: "Mosaic shows your tabs side by side.", pinch: "in", gesture: "Pinch in on the page", keys: () => kbd("mod", "shift", "M"),
    done: () => layout === "mosaic" && !ovOpen },
  { title: "Zoom back in to one tile", text: "Put two fingers on the tile you want and spread them.", pinch: "out", gesture: "Pinch out on a tile", keys: () => `${kbd("mod", "1")} to ${kbd("mod", "4")}`,
    done: () => layout === "focus" && !ovOpen },
  { title: "Zoom all the way out", text: "The overview shows every open tab, so you can choose what Mosaic shows.", pinch: "in", gesture: "Pinch in, then pinch in again", keys: () => kbd("mod", "shift", "\\"),
    done: () => ovOpen },
  { title: "Pick two tabs", text: "Click the cards you want in Mosaic. Click again to unpick. Up to 4.", gesture: "Click cards", keys: () => `Arrows, then ${kbd("Space")}`,
    start: () => { if (ovOpen) { ovPicked = []; paintOverview(); } }, done: () => ovOpen && ovPicked.length >= 2 },
  { title: "Show them in Mosaic", text: "Mosaic now shows only the tabs you picked.", pinch: "out", gesture: "Pinch out", keys: () => kbd("Enter"),
    done: () => !ovOpen && layout === "mosaic" && tabs.filter((t) => t.tile).length >= 2 },
  { title: "Back to one tab", text: "The same shortcut switches between Focus and Mosaic.", pinch: "out", gesture: "Pinch out", keys: () => kbd("mod", "shift", "M"),
    done: () => layout === "focus" && !ovOpen },
  { title: "Loop a minute of video", text: "NODE opened the “Shaping a batard” practice tab. Loop the next minute of its video.", gesture: "Right-click the video → Loop Section", keys: () => kbd("mod", "shift", "L"),
    start: () => tour && api.activateTab(tour.video), done: () => Boolean(tour && tabById(tour.video)?.loop) },
  { title: "Stop looping", text: "The tab shows the section while it loops. The same shortcut stops it.", gesture: "Click ↻ on the tab", keys: () => kbd("mod", "shift", "L"),
    done: () => Boolean(tour && tabById(tour.video) && !tabById(tour.video).loop) },
];

function paintCoach(doneStep = false) {
  if (!tour) return;
  const n = TOUR_STEPS.length;
  if (tour.i >= n) {
    coachEl.className = "coach done";
    coachEl.innerHTML = `<div class="c-main"><div class="c-kick">Tutorial complete</div><h2>That's all of them</h2><p>Run it again any time from Help → Gestures and Shortcuts Tutorial.</p></div>` +
      `<div class="c-acts"><button class="chip" id="coach-close">Close and go back to my tabs</button></div>`;
    return;
  }
  const st = TOUR_STEPS[tour.i];
  coachEl.className = "coach" + (doneStep ? " done" : "") + (st.pinch === "out" ? " outward" : "");
  coachEl.innerHTML =
    `<div class="c-main"><div class="c-kick">Step ${tour.i + 1} of ${n}<span class="c-dots">${TOUR_STEPS.map((_, j) => `<i class="${j <= tour.i ? "on" : ""}"></i>`).join("")}</span></div>` +
    `<h2>${doneStep ? "Done" : escapeHtml(st.title)}</h2><p>${escapeHtml(st.text)}</p></div>` +
    `<div class="c-ways"><div class="c-way"><span class="c-lab">Trackpad</span>${st.pinch ? PAD_SVG : ""}<span>${escapeHtml(st.gesture)}</span></div>` +
    `<div class="c-way"><span class="c-lab">Keys</span><span>${st.keys()}</span></div></div>` +
    `<div class="c-acts"><button class="chip" id="coach-skip">Skip step</button><button class="chip" id="coach-close">End tutorial</button></div>`;
}

function tourGo(i) {
  if (!tour) return;
  tour.i = i;
  tour.advancing = false;
  paintCoach();
  if (i < TOUR_STEPS.length) Promise.resolve(TOUR_STEPS[i].start?.()).then(() => setTimeout(tourCheck, 300));
}

function tourCheck() {
  if (!tour || tour.advancing || tour.i >= TOUR_STEPS.length) return;
  if (!TOUR_STEPS[tour.i].done()) return;
  tour.advancing = true;
  paintCoach(true);
  setTimeout(() => tourGo(tour ? tour.i + 1 : 0), reducedMotion() ? 300 : 800);
}

async function startTour() {
  if (!api?.tourStart) return;
  if (menuOpen) await closeMenu();
  if (ovOpen) await closeOverview(false);
  store.set("node.tour", "seen");
  const r = await api.tourStart();
  if (!r) return;
  tour = { i: 0, ids: r.ids, video: r.video, advancing: false };
  document.documentElement.style.setProperty("--coach-h", COACH_H + "px");
  coachEl.hidden = false;
  await api.setCoach(COACH_H);
  tourGo(0);
}

async function endTour() {
  if (!tour) return;
  tour = null;
  coachEl.hidden = true;
  coachEl.innerHTML = "";
  document.documentElement.style.setProperty("--coach-h", "0px");
  if (ovOpen) await closeOverview(false);
  await api.setCoach(0);
  await api.tourEnd();
}

coachEl.addEventListener("click", (e) => {
  if (e.target.closest("#coach-skip")) tourGo(tour.i + 1);
  else if (e.target.closest("#coach-close")) endTour();
});
document.getElementById("tour-start")?.addEventListener("click", () => startTour());

// Offered after an update to a version with the tutorial, or after setup,
// until the user answers it (Start tutorial or Not now). Another notice in the
// sidebar (the Brave key reminder, a blocked popup) goes first: the offer waits
// until the sidebar is free, and if a later notice replaces it, it comes back
// on the next start.
const TOUR_OFFER = "New: pinch to move between one tab, Mosaic and all your tabs, and choose which tabs Mosaic shows. A 2-minute tutorial shows how.";
async function maybeTourPrompt(afterSetup = false, tries = 0) {
  if (!api?.tourAuto || store.get("node.tour", "") === "seen" || tourOn()) return;
  if (!(await api.tourAuto())) return;
  if (!afterSetup) {
    const settings = await api.getSettings();
    if (!settings.firstRunDone) return; // the setup screen offers it when it closes
  }
  if (!noticeEl.hidden || menuOpen || ovOpen) {
    if (tries < 40) setTimeout(() => maybeTourPrompt(afterSetup, tries + 1).catch(() => {}), 3000);
    return;
  }
  const answer = (run) => () => {
    store.set("node.tour", "seen");
    run();
  };
  showNotice(TOUR_OFFER, [{ label: "Start tutorial", run: answer(() => startTour()) }, { label: "Not now", run: answer(() => {}) }], { dismiss: false });
}
setTimeout(() => maybeTourPrompt().catch(() => {}), 2500);

// Trackpad pinch in the tab overview: pinch out = Done (B72). The overview is
// part of this window, so its pinches arrive here, not through a page.
ovEl.addEventListener(
  "wheel",
  (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    if (Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 10) return; // Ctrl + mouse wheel
    const g = (ovEl.__pinch = ovEl.__pinch || { acc: 1, fired: false });
    clearTimeout(g.timer);
    g.timer = setTimeout(() => (ovEl.__pinch = null), 260);
    if (g.fired) return;
    g.acc *= Math.exp(-e.deltaY / 100);
    if (g.acc > 1.22) {
      g.fired = true;
      closeOverview(true);
    }
  },
  { passive: false }
);


// ---- Ad and tracker blocking, visible (B73) ----
// The shield next to the address shows how many ads and trackers NODE
// blocked on the page; click it for the sites blocked, the switch, and what
// NODE sends. Off (in Settings or by a site rule): a crossed-out shield.
const shieldBtn = document.getElementById("shield-btn");
const shieldCount = document.getElementById("shield-count");
function paintShield() {
  if (!shieldBtn) return;
  const t = tabs.find((x) => x.id === activeId);
  const mode = t?.blocking || "on";
  const n = mode === "on" ? t?.blocked || 0 : 0;
  const glyph = mode === "on" ? "shield" : "shield-off";
  if (shieldBtn.dataset.glyph !== glyph) {
    shieldBtn.querySelector("use").setAttribute("href", "#i-" + glyph);
    shieldBtn.dataset.glyph = glyph;
  }
  shieldBtn.classList.toggle("muted", mode !== "on");
  shieldCount.hidden = !n;
  shieldCount.textContent = n > 999 ? "999+" : String(n);
  setTip(
    shieldBtn,
    mode === "off" ? "Ad and tracker blocking is off" : mode === "site" ? "Not blocking on this site (site rule)" : n ? `${n} ${n === 1 ? "ad or tracker" : "ads and trackers"} blocked on this page` : "Blocks ads and trackers. None on this page yet"
  );
}
shieldBtn?.addEventListener("click", () => {
  const r = shieldBtn.getBoundingClientRect();
  api?.privacyMenu?.(r.left, r.bottom + 4);
});

// ---- Sidebar layout (docs/18-sidebar-chrome.md) ----
// Another view of the same chrome. In Sidebar mode the real toolbar buttons,
// the address bar and the tab list move into the sidebar's slots, so they keep
// their handlers and state; Top bar mode puts each back where it was (a
// comment left in its place marks the spot). Widths: full, rail, hidden.
var SIDE_MIN = 220;
var SIDE_MAX = 340;
var SIDE_DEFAULT = 272;
var SIDE_W = { full: Math.min(SIDE_MAX, Math.max(SIDE_MIN, Number(store.get("node.sideWidth", SIDE_DEFAULT)) || SIDE_DEFAULT)), rail: 68, hidden: 52 };
var mosaicShown = []; // the tabs Mosaic shows (from main), for the Mosaic group
var SIDE_SLOTS = {
  window: ["back", "forward", "reload", "agent-share-btn", "agent-btn", "dl-btn", "fullscreen-btn"],
  address: ["omni-form", "zoom-badge", "shield-btn"],
  find: ["findbar"],
  tools: ["layout-btn", "capture-btn", "suggest-toggle", "sound-btn", "star-btn", "sb-history-btn", "sb-downloads-btn", "menu-btn"],
  newtab: ["new-tab"],
  tabs: ["tabs"],
};
var chromeLayout = "top";
var sideState = ["full", "rail", "hidden"].includes(store.get("node.sideState", "full")) ? store.get("node.sideState", "full") : "full";
var sideLast = sideState === "hidden" ? "full" : sideState;
var sideTrails = [];
var sideTrailsAt = 0;
const sidebarEl = document.getElementById("sidebar");

for (const ids of Object.values(SIDE_SLOTS))
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && !el.__home) el.before((el.__home = document.createComment(`home of #${id}`)));
  }

function sideWidth() {
  return chromeLayout === "side" ? SIDE_W[sideState] : 0;
}
function sendChromeLayout() {
  document.querySelector(".shell").style.setProperty("--side-w", `${sideWidth()}px`);
  api?.setChromeLayout?.({ mode: chromeLayout, left: sideWidth() });
}

function applyChromeLayout(mode) {
  const side = mode === "side";
  chromeLayout = side ? "side" : "top";
  document.body.classList.toggle("side", side);
  for (const [slot, ids] of Object.entries(SIDE_SLOTS)) {
    const box = sidebarEl.querySelector(`[data-slot="${slot}"]`);
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (side) box.appendChild(el);
      else el.__home?.after(el);
    }
  }
  for (const b of document.querySelectorAll(".sb-only")) b.hidden = !side;
  document.getElementById("page-frame").hidden = !side;
  setSideState(sideState, { send: false });
  sendChromeLayout();
  renderTabs();
}

function setSideState(state, { send = true } = {}) {
  sideState = state;
  if (state !== "hidden") sideLast = state;
  store.set("node.sideState", state);
  const side = chromeLayout === "side";
  document.body.classList.toggle("sb-rail", side && state === "rail");
  document.body.classList.toggle("sb-hidden", side && state === "hidden");
  sidebarEl.hidden = !side || state === "hidden";
  document.getElementById("sb-show-wrap").hidden = !side || state !== "hidden";
  document.getElementById("sb-hide").setAttribute("aria-expanded", "true");
  if (send) sendChromeLayout();
  paintSide();
}
function toggleSidebar() {
  if (chromeLayout !== "side") return;
  const showing = sideState !== "hidden";
  setSideState(showing ? "hidden" : sideLast);
  (showing ? document.getElementById("sb-show") : document.getElementById("sb-hide")).focus();
}
// Needs the address bar: show the full sidebar first (rail or hidden).
function sideNeedsAddress() {
  if (chromeLayout === "side" && sideState !== "full") setSideState("full");
}

document.getElementById("sb-hide").addEventListener("click", toggleSidebar);
document.getElementById("sb-show").addEventListener("click", toggleSidebar);
document.getElementById("sb-search").addEventListener("click", () => openCommandBar());
document.getElementById("sb-history-btn").addEventListener("click", () => openMenu("history"));
document.getElementById("sb-downloads-btn").addEventListener("click", () => openMenu("downloads"));
document.getElementById("sb-trail-name").addEventListener("click", () => openMenu("trail"));
document.getElementById("sb-trails-toggle").addEventListener("click", () => {
  const open = document.getElementById("sb-trails-toggle").getAttribute("aria-expanded") !== "true";
  store.set("node.sideTrailsOpen", open);
  paintSide();
});
// Right-click the sidebar's empty space: full or rail.
sidebarEl.addEventListener("contextmenu", (e) => {
  if (e.target.closest("button, input, .tab, a")) return;
  e.preventDefault();
  setSideState(sideState === "rail" ? "full" : "rail");
});

// Two letters for a tab or trail in the rail.
function monogram(text, url = "") {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^(www|en|m|mobile)\./, "");
  } catch {}
  if (/^[\d.]+$|^\[|^localhost$/.test(host)) host = ""; // an address like 127.0.0.1: use the title
  const base = host ? host.split(".")[0] : String(text || "");
  const words = base.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!words.length) return "·";
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0][0]).toUpperCase();
}

async function refreshSideTrails(force = false) {
  if (!api?.researchList || (!force && Date.now() - sideTrailsAt < 2000)) return;
  sideTrailsAt = Date.now();
  try {
    sideTrails = await api.researchList();
  } catch {}
  paintSide(false);
}

function paintSide(fetch = true) {
  if (chromeLayout !== "side" || !sidebarEl) return;
  if (fetch) refreshSideTrails();
  // Current trail
  // The list is read again every few seconds, so it has a rename made in the
  // Menu; the session object has the keywords.
  const s = typeof session !== "undefined" ? session : null;
  const cur = sideTrails.find((t) => t.current);
  const same = s && (!cur || cur.id === s.id);
  if (s && cur && !same && api?.researchGet) api.researchGet().then((fresh) => fresh?.id === cur.id && adoptSession(fresh)); // switched elsewhere
  document.getElementById("sb-trail-name").textContent = cur?.name || s?.name || "Trail";
  const pages = cur ? cur.pages : (s?.trail || []).length;
  const threadCount = same ? (s.threadList || []).length : cur?.threadCount || 0;
  document.getElementById("sb-trail-meta").textContent = `${pages} ${pages === 1 ? "PAGE" : "PAGES"}${threadCount ? ` · ${threadCount} ${threadCount === 1 ? "THREAD" : "THREADS"}` : ""}${same ? ` · ${(s.threads || []).length} KW` : ""}`;
  // Active trails
  const open = store.get("node.sideTrailsOpen", true);
  const head = document.getElementById("sb-trails-toggle");
  head.setAttribute("aria-expanded", String(open));
  document.getElementById("sb-trail-count").textContent = sideTrails.length || "";
  document.getElementById("sb-trails-label").textContent = sideState === "rail" ? "Trails" : "Active trails";
  const list = document.getElementById("sb-trail-list");
  list.hidden = !open && sideState !== "rail";
  list.innerHTML = "";
  for (const t of sideTrails.slice(0, 8)) {
    const b = document.createElement("button");
    b.className = "sb-trail-row";
    b.setAttribute("aria-current", String(Boolean(t.current)));
    const nt = t.tabs ?? 0;
    b.title = `${t.name} · ${nt} ${nt === 1 ? "tab" : "tabs"} · ${t.pages} ${t.pages === 1 ? "page" : "pages"}`;
    b.innerHTML = `<span class="dot" aria-hidden="true"></span><span class="nm"></span><span class="n"></span><span class="mono" aria-hidden="true"></span>`;
    b.querySelector(".nm").textContent = t.name;
    b.querySelector(".n").textContent = `${nt} ${nt === 1 ? "TAB" : "TABS"}`;
    b.querySelector(".mono").textContent = monogram(t.name);
    b.setAttribute("aria-label", `${t.name}, ${nt} ${nt === 1 ? "tab" : "tabs"}${t.current ? ", current trail" : ""}`);
    b.addEventListener("click", async () => {
      if (t.current) return openMenu("trail");
      adoptSession(await api.researchSwitch(t.id));
      await refreshSideTrails(true);
    });
    list.appendChild(b);
  }
  if (sideState !== "rail") {
    const add = document.createElement("button");
    add.className = "sb-trail-row add";
    add.innerHTML = `<svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg><span class="nm">New trail</span>`;
    add.addEventListener("click", async () => {
      document.getElementById("session-new").click();
      await refreshSideTrails(true);
      openMenu("trail");
    });
    list.appendChild(add);
  }
  // Mosaic group: the tiles, above the tabs, while Mosaic is on (not in the rail).
  const group = document.getElementById("sb-mosaic");
  const inMosaic = layout === "mosaic" && sideState === "full" && mosaicShown.length > 0;
  group.hidden = !inMosaic;
  document.body.classList.toggle("sb-mosaic-on", inMosaic);
  const tabsHead = document.getElementById("sb-tabs-head");
  tabsHead.hidden = !inMosaic;
  if (inMosaic) {
    const list = document.getElementById("sb-mosaic-list");
    list.innerHTML = "";
    mosaicShown.forEach((id, i) => {
      const t = tabs.find((x) => x.id === id);
      if (!t) return;
      const row = document.createElement("button");
      row.className = "sb-mosaic-row";
      row.setAttribute("aria-current", String(id === activeId));
      const playingNow = t.audible && !t.muted;
      row.innerHTML = `<span class="n">${i + 1}</span><span class="nm"></span>${playingNow ? '<span class="k live">Playing</span>' : ""}`;
      row.querySelector(".nm").textContent = t.title || t.url || "New tab";
      row.title = `Tile ${i + 1}${i < 4 ? ` (${keyLabel(`mod+${i + 1}`)})` : ""}: ${t.title || t.url}`;
      row.addEventListener("click", () => api?.activateTab(id));
      list.appendChild(row);
    });
    document.getElementById("sb-mosaic-count").textContent = `${mosaicShown.length} / ${tabs.length}`;
    document.getElementById("sb-tabs-count").textContent = String(tabs.filter((t) => !mosaicShown.includes(t.id)).length);
  }
  // Media
  const playing = (typeof tabs !== "undefined" ? tabs : []).filter((t) => t.audible && !t.muted).length;
  const media = document.getElementById("sb-media");
  media.classList.toggle("playing", playing > 0);
  document.getElementById("sb-playing").textContent = playing ? `${playing} PLAYING` : "NOTHING PLAYING";
  const snd = document.getElementById("sb-sound");
  snd.textContent = soundAll ? "SOUND: ALL" : "SOUND: ONE";
  snd.classList.toggle("all", soundAll);
}

// The layout setting, at start and when it changes.
api?.getSettings?.().then((s) => applyChromeLayout(s.chromeLayout === "side" ? "side" : "top"));
const layoutSelect = document.getElementById("chrome-layout");
layoutSelect?.addEventListener("change", async () => {
  await api?.setSettings?.({ chromeLayout: layoutSelect.value });
  applyChromeLayout(layoutSelect.value);
});

// ---- CommandBar (sidebar layout, docs/18-sidebar-chrome.md) ----
// ⌘L (or the address field) opens it on the current address; ⌘T and New tab
// open it empty and Enter opens a new tab. Groups: Open tabs, Trails, Ask,
// Search. Keys: ↑↓ move, ↵ open, ⇧↵ new tab, Tab ask, ⌘↵ agent, ⌥↵ new trail.
var cmdOpen = false;
var cmdNewTab = false;
var cmdRows = [];
var cmdSel = 0;
var cmdSeq = 0;
var cmdReturn = null;
var cmdMoved = false; // the selection was moved with the arrow keys
const cmdEl = document.getElementById("cmdbar");
const cmdInput = document.getElementById("cmd-input");
const cmdList = document.getElementById("cmd-list");

const looksLikeAddress = (q) => /^[a-z][a-z0-9+.-]*:\/\//i.test(q) || /^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?(\/\S*)?$/i.test(q);
const cmdWords = (q) => q.toLowerCase().split(/\s+/).filter(Boolean);
const cmdMatch = (words, ...fields) => {
  const hay = fields.join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
};
// The words typed, in bold, in a title.
function cmdBold(text, words) {
  let html = escapeHtml(text);
  for (const w of words.filter((w) => w.length > 1).slice(0, 4)) html = html.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"), "<strong>$1</strong>");
  return html;
}

async function openCommandBar({ newTab = false, text = null } = {}) {
  if (chromeLayout !== "side" || !api) return false;
  if (menuOpen) await closeMenu();
  cmdNewTab = newTab;
  document.getElementById("cmd-mode").hidden = !newTab;
  const current = tabs.find((t) => t.id === activeId);
  const value = text != null ? text : newTab ? "" : current && !/^about:|^file:/.test(current.url || "") ? current.url || "" : "";
  if (!cmdOpen) {
    cmdOpen = true;
    cmdSeq++;
    const active = document.activeElement;
    cmdReturn = active && active !== omni && !cmdEl.contains(active) ? active : null;
    cmdEl.hidden = false;
    const r = await api.setLibraryOpen?.(true, { snapshot: true });
    const shots = document.getElementById("cmd-shots");
    shots.innerHTML = "";
    for (const shot of r?.shots || []) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = shot.src;
      Object.assign(img.style, { left: `${shot.rect.x}px`, top: `${shot.rect.y}px`, width: `${shot.rect.width}px`, height: `${shot.rect.height}px` });
      shots.appendChild(img);
    }
    if (!cmdOpen) return true;
    void cmdEl.offsetWidth;
    cmdEl.classList.add("open");
  }
  cmdInput.value = value;
  cmdInput.focus();
  cmdInput.select();
  refreshSideTrails(true);
  await renderCommands();
  return true;
}

async function closeCommandBar() {
  if (!cmdOpen) return;
  cmdOpen = false;
  const seq = ++cmdSeq;
  cmdEl.classList.remove("open");
  if (cmdReturn?.isConnected) cmdReturn.focus();
  else document.activeElement?.blur?.();
  await new Promise((r) => setTimeout(r, motionMs("--motion-fast")));
  if (seq !== cmdSeq) return;
  if (!menuOpen) await api?.setLibraryOpen?.(false);
  if (seq !== cmdSeq) return;
  cmdEl.hidden = true;
  document.getElementById("cmd-shots").innerHTML = "";
}

async function renderCommands() {
  const seq = ++cmdSeq;
  const q = cmdInput.value.trim();
  const words = cmdWords(q);
  const rows = [];
  const add = (group, row) => rows.push({ group, ...row });
  // Open tabs
  const open = tabs.filter((t) => !words.length || cmdMatch(words, t.title || "", t.url || "")).slice(0, words.length ? 5 : 6);
  for (const t of open)
    add("Open tabs", {
      id: `tab-${t.id}`,
      mono: monogram(t.title, t.url),
      html: cmdBold(t.title || t.url || "New tab", words),
      key: t.audible && !t.muted ? "Playing" : t.sleeping ? "Asleep" : t.id === activeId ? "Current" : "Switch ↵",
      live: t.audible && !t.muted,
      run: () => api.activateTab(t.id),
      strong: words.length && (t.title || "").toLowerCase().startsWith(q.toLowerCase()),
    });
  // Trails
  const trails = sideTrails.filter((t) => !words.length || cmdMatch(words, t.name)).slice(0, words.length ? 3 : 4);
  for (const t of trails)
    add("Trails", {
      id: `trail-${t.id}`,
      icon: "trail",
      html: cmdBold(t.name, words),
      key: `${t.tabs ?? 0} ${(t.tabs ?? 0) === 1 ? "tab" : "tabs"}${t.current ? " · current" : " · switch trail"}`,
      run: async () => {
        if (!t.current) adoptSession(await api.researchSwitch(t.id));
        refreshSideTrails(true);
      },
    });
  if (q)
    add("Trails", {
      id: "trail-new",
      icon: "plus",
      html: `Start a new trail “${escapeHtml(q)}”`,
      key: "⌥↵",
      run: () => cmdNewTrail(q),
    });
  // Ask
  if (q && !looksLikeAddress(q)) {
    add("Ask", { id: "ask", icon: "ask", html: `Ask about this page: ${escapeHtml(q)}`, key: "Tab", run: () => cmdAsk(q) });
    add("Ask", { id: "agent", icon: "agent", html: `Run the research agent on “${escapeHtml(q)}”`, key: "⌘↵", run: () => cmdAgent(q) });
  }
  // Search and go
  if (q) {
    const addr = looksLikeAddress(q);
    add("Search", { id: "go", icon: addr ? "go" : "search", html: addr ? `Go to ${escapeHtml(q)}` : `Search for “${escapeHtml(q)}”`, key: addr ? "Open ↵" : "Brave", run: (newTab) => cmdGo(q, newTab), primary: true });
  }
  if (q && api.historySearch) {
    const marks = api.bookmarkSearch ? await api.bookmarkSearch(q, 3) : [];
    const hist = await api.historySearch(q, 6);
    if (seq !== cmdSeq) return; // typed again meanwhile
    const seen = new Set(tabs.map((t) => t.url));
    for (const r of [...marks.map((m) => ({ ...m, star: true })), ...hist]) {
      if (seen.has(r.url) || rows.filter((x) => x.group === "Search").length >= 6) continue;
      seen.add(r.url);
      let host = "";
      try {
        host = new URL(r.url).hostname.replace(/^www\./, "");
      } catch {}
      add("Search", { id: `url-${r.url}`, mono: monogram(r.title, r.url), html: `${cmdBold(r.title || r.url, words)}<span class="u">${escapeHtml(host)}</span>`, key: r.star ? "Bookmark" : "History", run: (newTab) => cmdGo(r.url, newTab) });
    }
  }
  if (seq !== cmdSeq) return;
  cmdRows = rows;
  cmdMoved = false;
  // Selected first: a tab whose title starts with what was typed, else the
  // search or address row, else the first row.
  const strong = rows.findIndex((r) => r.strong);
  const primary = rows.findIndex((r) => r.primary);
  cmdSel = strong >= 0 ? strong : primary >= 0 ? primary : 0;
  paintCommands();
}

function paintCommands() {
  cmdList.innerHTML = "";
  let group = "";
  cmdRows.forEach((r, i) => {
    if (r.group !== group) {
      group = r.group;
      const h = document.createElement("div");
      h.className = "cmd-group";
      h.textContent = group;
      h.setAttribute("role", "presentation");
      cmdList.appendChild(h);
    }
    const el = document.createElement("div");
    el.className = "cmd-row";
    el.id = `cmd-row-${i}`;
    el.setAttribute("role", "option");
    el.setAttribute("aria-selected", String(i === cmdSel));
    el.innerHTML = `${r.mono ? `<span class="mono" aria-hidden="true">${escapeHtml(r.mono)}</span>` : icon(r.icon || "tab")}<span class="t">${r.html}</span><span class="k${r.live ? " live" : ""}">${escapeHtml(r.key || "")}</span>`;
    el.addEventListener("mousedown", (e) => e.preventDefault()); // keep the cursor in the field
    el.addEventListener("click", (e) => runCommand(i, { newTab: e.shiftKey || e.metaKey || e.ctrlKey }));
    cmdList.appendChild(el);
  });
  if (!cmdRows.length) {
    const p = document.createElement("div");
    p.className = "cmd-empty";
    p.textContent = "Type an address, words to search for, or a question about this page.";
    cmdList.appendChild(p);
  }
  cmdInput.setAttribute("aria-activedescendant", cmdRows.length ? `cmd-row-${cmdSel}` : "");
  document.getElementById(`cmd-row-${cmdSel}`)?.scrollIntoView({ block: "nearest" });
}

async function runCommand(i, { newTab = false } = {}) {
  const r = cmdRows[i];
  if (!r) {
    // Nothing typed in new-tab mode: a new tab with the start page.
    if (cmdNewTab && !cmdInput.value.trim()) {
      await closeCommandBar();
      api.createTab("");
    }
    return;
  }
  await closeCommandBar();
  await r.run(newTab || cmdNewTab);
}
async function cmdGo(q, newTab) {
  if (newTab || !activeId) await api.createTab(q);
  else await api.navigate(activeId, q);
}
async function cmdAsk(q) {
  setPanelOpen(true, { animate: true });
  await openAsk();
  sendAsk(q);
}
function cmdAgent(q) {
  setPanelOpen(true, { animate: true });
  showPane("agent");
  const input = document.getElementById("agent-input");
  input.value = q;
  document.getElementById("agent-form").requestSubmit();
}
async function cmdNewTrail(q) {
  adoptSession(await api.researchNew(q));
  await refreshSideTrails(true);
}

let cmdTimer = null;
cmdInput.addEventListener("input", () => {
  clearTimeout(cmdTimer);
  cmdTimer = setTimeout(renderCommands, 80);
});
cmdInput.addEventListener("keydown", (e) => {
  const q = cmdInput.value.trim();
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closeCommandBar();
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!cmdRows.length) return;
    cmdSel = (cmdSel + (e.key === "ArrowDown" ? 1 : -1) + cmdRows.length) % cmdRows.length;
    cmdMoved = true;
    paintCommands();
  } else if (e.key === "Enter") {
    e.preventDefault();
    clearTimeout(cmdTimer);
    const pick = (id) => cmdRows.findIndex((r) => r.id === id);
    if ((e.metaKey || e.ctrlKey) && q) return runCommand(pick("agent"));
    if (e.altKey && q) return runCommand(pick("trail-new"));
    // New-tab mode, nothing typed and nothing picked with the arrows: a blank tab.
    if (cmdNewTab && !q && !cmdMoved) return runCommand(-1);
    runCommand(cmdSel, { newTab: e.shiftKey });
  } else if (e.key === "Tab" && !e.shiftKey && q && !looksLikeAddress(q)) {
    e.preventDefault();
    runCommand(cmdRows.findIndex((r) => r.id === "ask"));
  } else if (e.key === "Tab") {
    e.preventDefault(); // focus stays in the field
  }
});
document.getElementById("cmd-scrim").addEventListener("click", closeCommandBar);

// Ways in, in the sidebar layout: the address field, the rail's search
// button, ⌘L (focus-omni), ⌘T and New tab.
omni.addEventListener("focus", () => {
  if (chromeLayout === "side" && !cmdOpen) {
    omni.blur();
    openCommandBar();
  }
});
document.getElementById("new-tab").addEventListener(
  "click",
  (e) => {
    if (chromeLayout !== "side") return;
    e.stopImmediatePropagation();
    openCommandBar({ newTab: true });
  },
  true
);

// Sidebar width (full): drag the right edge, 220–340px; ←/→ on the handle;
// double-click resets to 272. Not animated: the page follows the drag.
(function sidebarResize() {
  const handle = document.getElementById("sb-resize");
  if (!handle) return;
  const paintHandle = () => {
    handle.setAttribute("aria-valuemin", String(SIDE_MIN));
    handle.setAttribute("aria-valuemax", String(SIDE_MAX));
    handle.setAttribute("aria-valuenow", String(SIDE_W.full));
  };
  const setWidth = (w, { save = true } = {}) => {
    SIDE_W.full = Math.round(Math.min(SIDE_MAX, Math.max(SIDE_MIN, w)));
    if (save) store.set("node.sideWidth", SIDE_W.full);
    paintHandle();
    if (chromeLayout === "side" && sideState === "full") sendChromeLayout();
  };
  paintHandle();
  let frame = 0;
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add("sb-resizing");
    const move = (ev) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setWidth(ev.clientX, { save: false }));
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      document.body.classList.remove("sb-resizing");
      setWidth(SIDE_W.full);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up, { once: true });
    handle.addEventListener("pointercancel", up, { once: true });
  });
  handle.addEventListener("dblclick", () => setWidth(SIDE_DEFAULT));
  handle.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      setWidth(SIDE_W.full + (e.key === "ArrowRight" ? 8 : -8));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setWidth(e.key === "Home" ? SIDE_MIN : SIDE_MAX);
    }
  });
})();
