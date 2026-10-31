const { app, BrowserWindow, WebContentsView, ipcMain, session, shell, protocol, net, Menu, dialog, safeStorage, clipboard, systemPreferences, screen, powerMonitor } = require("electron");
const path = require("path");
const fs = require("fs");
const { URL } = require("url");

// The app was renamed from Scout to NODE on 2026-10-13. Its data folder follows
// the app name, so the first NODE run copies NODE's own files from the old
// Scout folder: settings, history, bookmarks, site rules, permissions, research
// sessions, the library and the ad-block lists. (Chromium's own files, such as
// cookies, start fresh: they are created before this code runs.)
if (!app.commandLine.hasSwitch("user-data-dir")) {
  try {
    const target = app.getPath("userData");
    const marker = path.join(target, "migrated-from-scout");
    if (!fs.existsSync(marker) && !fs.existsSync(path.join(target, "settings.json"))) {
      for (const old of ["Scout", "scout"]) {
        const from = path.join(app.getPath("appData"), old);
        if (!fs.existsSync(from) || path.resolve(from).toLowerCase() === path.resolve(target).toLowerCase()) continue;
        fs.mkdirSync(target, { recursive: true });
        for (const name of ["settings.json", "history.json", "bookmarks.json", "rules.json", "permissions.json", "adblock.bin", "sessions", "library"]) {
          const src = path.join(from, name);
          if (fs.existsSync(src)) fs.cpSync(src, path.join(target, name), { recursive: true, force: false, errorOnExist: false });
        }
        fs.writeFileSync(marker, from);
        break;
      }
    }
  } catch (_) {}
}

// Platform-neutral logic lives in core/ (shared with the mobile app).
const { analyzePage, KeywordContext } = require("./core/keywords");
const { PROVIDERS, Registry, defaultSettings, SETTINGS_VERSION } = require("./core/providers");
const Rules = require("./core/rules");
const AI = require("./core/ai");
const Chat = require("./core/chat");
const { ResearchStore } = require("./core/research");
const { Usage } = require("./core/usage");
const { HistoryStore } = require("./core/history");
const { BookmarkStore } = require("./core/bookmarks");
const { createAdblock } = require("./adblock");
const { createNet } = require("./core/net");
const { createSuggest } = require("./core/suggest");
const { createPreview } = require("./core/preview");
const { extractionScript, autoplayScript, blockAutoplayScript, centerOnClickScript, pipScript, loopScript, readableTextScript, pauseForLimitScript, resumeScript, anyPlayingScript } = require("./core/page-scripts");
const { PlaybackLimiter } = require("./core/playback");
const { fsStorage } = require("./fs-storage");
const { normalizeUrl, hostOf, SEARCH_URL, isSensitiveUrl } = require("./core/urls");
const { routesToGoogleWindow, MODES: GOOGLE_MODES } = require("./core/google");
const { createCompanion } = require("./companion");
const { createAgentServer } = require("./agent-server");
const { createAgents } = require("./agents");
const { createLog } = require("./log");
const { createUpdater, RELEASES } = require("./updater");
const { runResearch } = require("./core/agent");
const Talk = require("./core/talk");
const TrailFile = require("./core/trail-file");
const TrailApply = require("./core/trail-apply");
const ShareLink = require("./core/share-link");
let research = null; // current research session store (B17), created when the app is ready

const HOME_URL = "https://en.wikipedia.org/wiki/Main_Page";
const CHROME_TOP = 96; // toolbar height: keep in step with .shell grid-template-rows in renderer/styles.css and index.html
const SIDEBAR_DEFAULT = 356; // suggestions widget open (renderer/app.js PANEL_W + gaps)
// Space the floating suggestions widget takes on the right of the page: its
// width plus the gap around it. The renderer sends it (0 when collapsed).
const PANEL_MAX = 600;
// The standard Chrome user agent for this computer's system and Scout's real
// Chromium version, without the "Electron/..." and app-name parts. Sites such as
// Google sign-in refuse browsers that say they are embedded (Electron) or
// whose user agent does not match the system it runs on (an earlier version
// claimed Windows on every computer, and an old Chrome version).
const UA_PLATFORM = {
  darwin: "Macintosh; Intel Mac OS X 10_15_7",
  win32: "Windows NT 10.0; Win64; x64",
}[process.platform] || "X11; Linux x86_64";
const USER_AGENT = `Mozilla/5.0 (${UA_PLATFORM}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome.split(".")[0]}.0.0.0 Safari/537.36`;
app.userAgentFallback = USER_AGENT;
// Requests NODE makes on its own (search sources, previews, Talk) and pages the
// AI agent reader loads say so, rather than passing as a person in Chrome.
const BACKGROUND_UA = `NODE/${app.getVersion()} (research browser; +https://github.com/westernCasa/node_browser)`;
const AGENT_UA = `${USER_AGENT} NODE-agent/${app.getVersion()} (+https://github.com/westernCasa/node_browser)`;

let win;
let sidebarWidth = SIDEBAR_DEFAULT;
// Sidebar layout: the sidebar's width (full 272, rail 68, hidden 52), from the renderer.
let chromeSide = false;
let chromeLeft = 0;
let libraryOpen = false; // the overlay menu (or first-run screen) covers the window: page views hidden
// Full screen hides the toolbar (immersive). It comes back while the pointer
// is at the top edge, or while the renderer holds it (address bar or find
// bar in use, a menu open). A page's own full screen (a video) takes the
// whole window and never shows the toolbar.
let immersive = false;
let chromeShown = true;
let chromeHold = false; // the renderer is using the toolbar (address bar, find bar, menu)
let popupHold = false; // a native menu from the toolbar is open
let htmlFullId = null;
let chromePoll = null;
let chromeHideTimer = null;
let layout = "focus"; // focus | mosaic
const tabs = new Map();
let activeId = null;
let idSeq = 1;

// ---- Site rules (B16) ----
// userData/rules.json, created with examples on first run and reloaded on save.
let siteRules = [];
let rulesErrors = [];
let rulesWatcher = null;

function rulesFile() {
  return path.join(app.getPath("userData"), "rules.json");
}

function loadRules(announce = false) {
  const file = rulesFile();
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(Rules.DEFAULT_FILE, null, 2));
  try {
    const { rules, errors } = Rules.validate(JSON.parse(fs.readFileSync(file, "utf8")));
    siteRules = rules;
    rulesErrors = errors;
  } catch (err) {
    // Keep the last good rules if the file cannot be parsed (for example mid-edit).
    rulesErrors = [`rules.json could not be read: ${err.message}. The previous rules are still in use.`];
  }
  for (const tab of tabs.values()) refreshRule(tab);
  if (win) {
    applyLayout();
    emitList();
  }
  if (announce) sendUi("rules-reloaded", { count: siteRules.length, errors: rulesErrors });
}

function watchRules() {
  if (rulesWatcher) return;
  let timer = null;
  try {
    rulesWatcher = fs.watch(rulesFile(), () => {
      clearTimeout(timer);
      timer = setTimeout(() => loadRules(true), 300);
    });
  } catch (_) {}
}

// ---- History (B19) ----
// core/history.js, stored in userData/history.json. Created when the app is ready.
let historyStore = null;
let bookmarkStore = null;
let adblock = null;
let blockedEmitTimer = null;

function ruleFor(url) {
  return Rules.resolve(siteRules, url);
}

// Recompute a tab's rule after navigation. Sound follows the rule unless the
// user set this tab's sound with the speaker button.
function refreshRule(tab, url) {
  tab.rule = ruleFor(url || tab.view.webContents.getURL());
  if (!tab.audioByUser) tab.audio = tab.rule.sound;
}

// Motion for the tab windows (interaction 08). The main process cannot read
// CSS, so these must match --motion-slow and --motion-base in
// renderer/styles.css and docs/motion/tokens.md.
const MOTION_SLOW = 320;
const MOTION_BASE = 200;
const MOTION_FAST = 120;

// Electron only offers four easings. "ease-out" stands in for our
// --ease-enter and "ease-in-out" for our --ease-move (see tokens.md).
function motionFor(kind) {
  if (!kind || systemPreferences.getAnimationSettings().prefersReducedMotion) return null;
  if (kind === "enter") return { duration: MOTION_SLOW, easing: "ease-out" }; // Focus → Mosaic
  if (kind === "exit") return { duration: MOTION_BASE, easing: "ease-out" }; // Mosaic → Focus
  return { duration: MOTION_BASE, easing: "ease-in-out" }; // tiles moving to new cells
}

// Mosaic → Focus: the other tiles stay until the active one has covered them.
let exitTimer = null;

function chromeBounds() {
  const [width, height] = win.getContentSize();
  return { width, height };
}

// Space the tutorial's coach band takes at the bottom of the window (B72).
let coachHeight = 0;
function contentRect() {
  const { width, height } = chromeBounds();
  if (htmlFullId) return { x: 0, y: 0, width, height };
  // Sidebar layout (docs/18-sidebar-chrome.md): the page sits right of the
  // sidebar inside a 1px frame, 8px from the window's other edges (or from the
  // suggestions widget, whose column has its own 8px margins). Matches
  // .page-frame in renderer/styles.css.
  if (chromeSide) {
    const right = sidebarWidth > 0 ? sidebarWidth : 8;
    return {
      x: chromeLeft + 1,
      y: 9,
      width: Math.max(280, width - chromeLeft - right - 2),
      height: Math.max(200, height - 18 - coachHeight),
    };
  }
  // Full screen: the page always starts at the top; the toolbar slides over it.
  const top = immersive ? 0 : CHROME_TOP;
  return {
    x: 0,
    y: top,
    width: Math.max(280, width - sidebarWidth),
    height: Math.max(200, height - top - coachHeight),
  };
}

// ---- Full screen: hide the toolbar ----
// Motion 09, like Safari: in full screen the page fills the window and never
// moves. The toolbar is shown in its own layer above the page (a copy of the
// window's toolbar, renderer/chrome-overlay.html) that slides down over the
// page and back up. Timing is in the overlay's CSS (renderer/styles.css,
// body.chrome-overlay): down --motion-base with --ease-enter, up
// --motion-fast with --ease-exit.
//
// The suggestions widget (motion 10) moves the page on a cubic-bezier curve
// in this process; these must match --ease-enter and --ease-exit.
const EASE_ENTER = [0, 0, 0.2, 1];
const EASE_EXIT = [0.4, 0, 1, 1];

// CSS-style cubic-bezier(x1, y1, x2, y2): progress in time (0-1) → progress
// in distance (0-1). Finds the curve's t for the given time by bisection.
function cubicBezier([x1, y1, x2, y2]) {
  const at = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}

let viewSlide = null;

function stopViewSlide() {
  if (!viewSlide) return;
  clearTimeout(viewSlide.timer);
  viewSlide = null;
}

// Move page views from their current bounds to the ones applyLayout() just
// set, on a cubic-bezier curve. moveOnly: only the position changes during
// the slide, at the larger size, and the page is resized once at the end, so
// it does not re-lay itself out on every frame. Otherwise the views resize as
// they go. Any other layout change stops the slide (applyLayout).
function slideViews(items, duration, curve, { moveOnly = false } = {}) {
  stopViewSlide();
  const ease = cubicBezier(curve);
  const start = Date.now();
  const lerp = (a, b, p) => Math.round(a + (b - a) * p);
  const frame = () => {
    const p = Math.min(1, (Date.now() - start) / duration);
    const e = ease(p);
    for (const { view, from, to } of items) {
      if (p >= 1) view.setBounds(to);
      else if (moveOnly) view.setBounds({ x: lerp(from.x, to.x, e), y: lerp(from.y, to.y, e), width: Math.max(from.width, to.width), height: Math.max(from.height, to.height) });
      else view.setBounds({ x: lerp(from.x, to.x, e), y: lerp(from.y, to.y, e), width: lerp(from.width, to.width, e), height: lerp(from.height, to.height, e) });
    }
    if (p < 1) viewSlide = { timer: setTimeout(frame, 16) };
    else viewSlide = null;
  };
  frame();
}

// The toolbar layer: created on entering full screen, attached above the
// pages only while the toolbar is shown (so it never takes clicks meant for
// the page), and given the latest copy of the toolbar from the window.
let overlay = null;
let overlayAttached = false;
let overlayTimer = null;
let overlayHold = false; // a field in the toolbar layer has focus
let lastMirror = null;

// macOS: in full screen, the pointer at the top edge also makes the system
// slide down its menu bar and the window's title bar over the top of the
// window. NODE's toolbar then goes below them, as Safari's does (osTop), and
// stays there until it hides. macOS takes its bars away on its own timing,
// which apps cannot see, so the space they leave is filled in the
// toolbar's colour (renderer/styles.css) instead of moving the toolbar.
// Their heights are measured while the window is not in full screen:
// title bar = window height minus content height; menu bar = how far the
// screen's usable area starts below its top (0 if the menu bar auto-hides,
// then 24, the standard height, is used).
const macBars = { title: 28, menu: 24 };
let osTop = 0; // where the toolbar sits while the system bars are showing

function measureMacBars() {
  if (process.platform !== "darwin" || !win || win.isFullScreen()) return;
  const title = win.getBounds().height - win.getContentBounds().height;
  if (title > 0 && title < 80) macBars.title = title;
  const d = screen.getDisplayMatching(win.getBounds());
  const menu = d.workArea.y - d.bounds.y;
  if (menu > 0 && menu < 80) macBars.menu = menu;
}

// How much of the window the system bars cover when they slide down. On a
// screen with a camera notch the full-screen window may start below the
// menu bar; then only the title bar covers it.
function macBarsHeight() {
  if (process.platform !== "darwin" || !win) return 0;
  const cb = win.getContentBounds();
  const d = screen.getDisplayMatching(cb);
  return Math.max(0, d.bounds.y + macBars.menu - cb.y) + macBars.title;
}

function ensureOverlay() {
  if (overlay && !overlay.webContents.isDestroyed()) return overlay;
  overlay = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, "preload-overlay.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  overlay.setBackgroundColor("#00000000");
  overlay.webContents.on("did-finish-load", () => {
    if (lastMirror) overlay.webContents.send("overlay:mirror", lastMirror);
    overlay.webContents.send("overlay:offset", osTop);
    if (overlayAttached && chromeShown && immersive) overlay.webContents.send("overlay:show", true);
  });
  overlay.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  overlay.webContents.on("will-navigate", (e) => e.preventDefault());
  overlay.webContents.loadFile(path.join(__dirname, "renderer", "chrome-overlay.html"));
  return overlay;
}

function overlayBounds() {
  const { width } = chromeBounds();
  return { x: 0, y: 0, width, height: CHROME_TOP + osTop };
}

// Keep the layer above the pages after a layout change re-adds them.
function raiseOverlay() {
  if (!overlayAttached || !overlay) return;
  win.contentView.addChildView(overlay);
  overlay.setBounds(overlayBounds());
}

function showOverlay(on, { instant = false } = {}) {
  clearTimeout(overlayTimer);
  overlayTimer = null;
  if (on) {
    ensureOverlay();
    overlay.webContents.send("overlay:offset", osTop);
    overlay.setBounds(overlayBounds());
    if (!overlayAttached) {
      win.contentView.addChildView(overlay);
      overlayAttached = true;
    } else raiseOverlay();
    overlay.webContents.send("overlay:show", true);
    return;
  }
  if (!overlay || !overlayAttached) return;
  overlay.webContents.send("overlay:show", false);
  const detach = () => {
    overlayTimer = null;
    if (!overlayAttached || (chromeShown && immersive && !htmlFullId)) return;
    win.contentView.removeChildView(overlay);
    overlayAttached = false;
    osTop = 0;
  };
  if (instant) detach();
  else overlayTimer = setTimeout(detach, MOTION_FAST + 40); // after the slide up
}

function setChromeShown(on) {
  clearTimeout(chromeHideTimer);
  chromeHideTimer = null;
  if (chromeShown === on) return;
  chromeShown = on;
  sendUi("chrome", { immersive, shown: on });
  showOverlay(on && immersive && !htmlFullId);
}

// The page views cover the renderer, so it gets no mouse events over the
// page: read the pointer position from the system instead.
function pollChrome() {
  // The menu does not hold the toolbar: it slides away and comes back with
  // the pointer, as over a page (reported by Sven, 0.9.5).
  if (!win || !immersive || htmlFullId || chromeHold || overlayHold || popupHold) return;
  const p = screen.getCursorScreenPoint();
  const b = win.getContentBounds();
  const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
  const y = p.y - b.y;
  if (!chromeShown) {
    if (inside && y <= 2) {
      clearTimeout(overlayTimer); // still sliding away: it comes straight back
      overlayTimer = null;
      osTop = macBarsHeight(); // the system bars come down too (macOS)
      setChromeShown(true);
    }
    return;
  }
  // Shown with Cmd+L and then the pointer reaches the top: the system bars
  // come down now, so move the toolbar below them.
  if (inside && y <= 2 && !osTop && macBarsHeight()) {
    osTop = macBarsHeight();
    showOverlay(true);
  }
  if (inside && y <= osTop + CHROME_TOP + 16) {
    clearTimeout(chromeHideTimer);
    chromeHideTimer = null;
  } else if (!chromeHideTimer) {
    chromeHideTimer = setTimeout(() => setChromeShown(false), 400);
  }
}

function enterImmersive() {
  // The sidebar layout keeps its sidebar in full screen; the top bar's
  // sliding toolbar is for the top bar only.
  if (chromeSide) return;
  immersive = true;
  chromeShown = true;
  sendUi("chrome", { immersive: true, shown: true, hint: true });
  applyLayout();
  showOverlay(!htmlFullId);
  clearInterval(chromePoll);
  chromePoll = setInterval(pollChrome, 100);
  // Show the toolbar with its hint for a moment, then hide it.
  clearTimeout(chromeHideTimer);
  chromeHideTimer = setTimeout(() => {
    chromeHideTimer = null;
    if (!chromeHold && !overlayHold && !popupHold) setChromeShown(false);
  }, 1800);
}

function leaveImmersive() {
  immersive = false;
  clearInterval(chromePoll);
  chromePoll = null;
  clearTimeout(chromeHideTimer);
  chromeHideTimer = null;
  chromeShown = true;
  overlayHold = false;
  showOverlay(false, { instant: true });
  osTop = 0;
  sendUi("chrome", { immersive: false, shown: true });
  applyLayout();
}

// Tabs that are not on screen are hidden (not just sized to 0x0), so Chromium
// stops painting them and slows their timers. Media keeps playing.
// Detaching the view is what makes Chromium treat the page as hidden;
// setVisible(false) alone keeps it rendering at full frame rate.
function hideView(tab) {
  if (!tab.attached) return;
  if (!tab.sleeping && !libraryOpen) thumbOf(tab); // a picture for the tab overview, taken while still on screen
  win.contentView.removeChildView(tab.view);
  tab.attached = false;
}

// anim: motion options or null. A tab window that is not on screen yet (or
// has no size yet) appears in place: there is nothing to animate from.
// index: where to insert it in the stack (0 = bottom); omitted = on top.
function showView(tab, bounds, anim = null, index) {
  if (anim && tab.attached && tab.view.getBounds().width > 0) tab.view.setBounds(bounds, { animate: anim });
  else tab.view.setBounds(bounds);
  if (!tab.attached) {
    if (index >= 0) win.contentView.addChildView(tab.view, index);
    else win.contentView.addChildView(tab.view);
    tab.attached = true;
  }
}

// Tabs shown as Mosaic tiles (B69). If the user chose tabs for Mosaic, only
// those; otherwise every tab except those whose site rule keeps them out.
// At most mosaicMax tiles (4 by default, 0 = no limit), in tab order; the
// active tab always keeps its tile when nothing was chosen.
const MOSAIC_MAX_CHOICES = [4, 6, 9, 0];
function mosaicMax() {
  return loadSettings().mosaicMax;
}
// ---- Trails keep their own tabs (B80, docs/18-sidebar-chrome.md) ----
// Each tab belongs to the trail (research session) that was current when it
// opened. Only the current trail's tabs show: in the tab list, Mosaic, the
// overview and the tab shortcuts. The others stay open out of view and follow
// the usual sleep rule (B29). Switching back brings them back as they were.
const currentTrail = () => research?.current?.id || null;
const inCurrentTrail = (tab) => !tab.trail || !currentTrail() || tab.trail === currentTrail();
function shownTabs() {
  return [...tabs.values()].filter(inCurrentTrail);
}
const trailActive = new Map(); // trail id → the tab that was active in it

// Runs a change of trail (switch, new) and shows that trail's tabs.
function changeTrail(fn) {
  const before = currentTrail();
  const result = fn();
  const after = currentTrail();
  if (before === after) return result;
  if (activeId) trailActive.set(before, activeId);
  const shown = shownTabs();
  let next = trailActive.get(after);
  if (!shown.some((t) => t.id === next)) next = shown.at(-1)?.id;
  if (!next) next = createTab(newTabUrl());
  activateTab(next);
  saveSessionSoon();
  return result;
}

function mosaicIds() {
  const all = shownTabs().map((t) => t.id);
  const chosen = all.filter((id) => tabs.get(id).tile);
  const max = mosaicMax() || Infinity;
  if (chosen.length) return chosen.slice(0, max);
  const ids = all.filter((id) => id === activeId || tabs.get(id).rule?.mosaic !== false);
  if (ids.length <= max) return ids;
  const shown = ids.slice(0, max);
  if (activeId && !shown.includes(activeId)) shown[max - 1] = activeId;
  return shown;
}
function chosenTiles() {
  return shownTabs().filter((t) => t.tile).length;
}

// opts.animate: "enter" | "exit" | "move", passed only by the Mosaic toggle
// and by opening or closing a tab in Mosaic. Every other caller leaves it out.
// Every layout change ends with the full-screen toolbar layer back on top.
function applyLayout(opts) {
  if (!win) return;
  // A tab without a tile became active in Mosaic (opened, or picked in the
  // tab strip): show it on its own.
  if (layout === "mosaic" && !libraryOpen && activeId && !mosaicIds().includes(activeId)) {
    layout = "focus";
    sendUi("layout", { mode: layout });
    opts = {};
  }
  layoutViews(opts);
  raiseOverlay();
}

function layoutViews({ animate } = {}) {
  stopViewSlide(); // a slide in progress (toolbar, suggestions widget) restarts from here
  applyAudio();
  const anim = motionFor(animate);
  // Back to Mosaic (or the library) before the exit finished: keep every tile.
  if (exitTimer && (layout === "mosaic" || libraryOpen)) {
    clearTimeout(exitTimer);
    exitTimer = null;
  }
  if (libraryOpen) {
    for (const tab of tabs.values()) hideView(tab);
    return;
  }
  // Tabs whose site rule says "mosaic": false stay out of the grid unless active.
  const ids = mosaicIds();
  const rect = contentRect();
  for (const [id, tab] of tabs) if (!ids.includes(id)) hideView(tab);

  if (layout !== "mosaic" || ids.length <= 1) {
    const active = tabs.get(activeId);
    if (anim && animate === "exit" && active?.attached) {
      win.contentView.addChildView(active.view); // already a child: this only raises it to the top
      showView(active, rect, anim);
      clearTimeout(exitTimer);
      exitTimer = setTimeout(() => {
        exitTimer = null;
        applyLayout(); // now hide the covered tiles
      }, MOTION_BASE);
      return;
    }
    if (exitTimer) {
      // The active tile is still growing: leave the others until the timer hides them.
      if (active && !active.attached) showView(active, rect);
      return;
    }
    for (const [id, tab] of tabs) {
      if (id === activeId) showView(tab, rect, anim);
      else hideView(tab);
    }
    return;
  }

  for (const id of ids) wakeTab(tabs.get(id)); // a tile on screen must show its page
  const n = ids.length;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const gap = 4;
  const cellW = Math.floor((rect.width - gap * (cols - 1)) / cols);
  const cellH = Math.floor((rect.height - gap * (rows - 1)) / rows);

  const cell = (i) => ({
    x: rect.x + (i % cols) * (cellW + gap),
    y: rect.y + Math.floor(i / cols) * (cellH + gap),
    width: cellW,
    height: cellH,
  });
  const active = tabs.get(activeId);
  if (animate === "enter" && anim && active?.attached) {
    // Focus → Mosaic: the other tiles go in first, directly under the active
    // tab and already in their cells; then the active tab shrinks into its own.
    ids.forEach((id, i) => {
      if (id !== activeId) showView(tabs.get(id), cell(i), null, win.contentView.children.indexOf(active.view));
    });
    showView(active, cell(ids.indexOf(activeId)), anim);
    return;
  }
  ids.forEach((id, i) => showView(tabs.get(id), cell(i), anim));
}

function emit(payload) {
  // The tabs Mosaic shows, for the sidebar's Mosaic group (B80).
  if (payload && (payload.type === "list" || payload.type === "update")) payload = { ...payload, mosaic: layout === "mosaic" ? mosaicIds() : [] };
  win?.webContents.send("tab:event", payload);
}

function tabState(tab) {
  const wc = tab.view.webContents;
  const raw = tab.sleeping ? tab.sleeping.url : wc.getURL();
  const google = isPlaceholder(raw);
  let url = raw;
  if (isStartPage(raw) || isTutorialPage(raw)) url = "";
  else if (isInternal(raw)) {
    try {
      url = new URL(raw).searchParams.get("u") || raw;
    } catch (_) {}
  }
  return {
    id: tab.id,
    url,
    google, // placeholder for a page shown in the Google window
    tutorial: isTutorialPage(raw), // a practice page of the gestures tutorial
    blocked: adblock ? adblock.blockedIn(wc.id) : 0, // ads and trackers blocked on this page (B73)
    blocking: !adblock || loadSettings().adblock === false ? "off" : tab.rule?.adblock === false ? "site" : "on",
    agentShared: Boolean(tab.agentShared),
    tile: Boolean(tab.tile), // chosen for Mosaic (B69)
    loop: tab.loop ? { a: tab.loop.a, b: tab.loop.b, label: `${clock(tab.loop.a)}–${clock(tab.loop.b)}` } : null, // B70

    title: (tab.sleeping ? tab.sleeping.title : wc.getTitle()) || "New tab",
    sleeping: Boolean(tab.sleeping),
    canBack: wc.canGoBack(),
    canForward: wc.canGoForward(),
    loading: wc.isLoading(),
    muted: wc.isAudioMuted(),
    audible: wc.isCurrentlyAudible(),
    audio: tab.audio,
    pausedByLimit: playback.snapshot().pausedByLimit.includes(tab.id),
    zoom: Math.round(wc.getZoomFactor() * 100),
    rule: tab.rule ? { matched: tab.rule.matched, suggest: tab.rule.suggest, autoplay: tab.rule.autoplay } : null,
  };
}

function emitList() {
  saveSessionSoon();
  emit({ type: "list", tabs: shownTabs().map(tabState), activeId });
}

// Sound policy (B03). "auto": only the active tab is audible; background and
// non-focused Mosaic tiles keep playing but muted. "on"/"off" are user overrides.
// soundAll (toolbar "Sound: all" or View menu): every "auto" tab is audible, so
// all playing tabs (up to the playback limit of 4) can be heard together.
let soundAll = false;

function setSoundAll(on) {
  soundAll = Boolean(on);
  applyAudio();
  emitList();
  const item = Menu.getApplicationMenu()?.getMenuItemById("sound-all");
  if (item) item.checked = soundAll;
  sendUi("sound-all", { on: soundAll });
}

function applyAudio() {
  for (const tab of tabs.values()) {
    const muted = tab.audio === "off" ? true : tab.audio === "on" ? false : !soundAll && tab.id !== activeId;
    if (tab.view.webContents.isAudioMuted() !== muted) tab.view.webContents.setAudioMuted(muted);
  }
}


// Autoplay per site rule (scripts in core/page-scripts.js): "on" plays the
// page's main media with sound (muted if the page refuses sound), "muted" plays
// it muted, "off" pauses media the page starts on its own before the user has
// interacted with it.
// NODE's page scripts run in their own JavaScript world, like a browser
// extension's content scripts: they see the page's DOM, but the page's own
// scripts cannot see them (no extra globals or wrapped functions). Bot-detection
// services treat scripts they can see in the page as automation.
const NODE_WORLD = 1001;
function runInPage(wc, code, userGesture = false) {
  return wc.executeJavaScriptInIsolatedWorld(NODE_WORLD, [{ code }], userGesture);
}

function tryAutoplay(wc, mode = "on") {
  if (mode === "off") return blockAutoplay(wc);
  runInPage(wc, autoplayScript(mode), true).catch(() => {});
}

function blockAutoplay(wc) {
  runInPage(wc, blockAutoplayScript()).catch(() => {});
}

// Playback limit (core/playback.js): media plays in up to 4 tabs at once. The
// scripts run in every frame, so embedded players (YouTube iframes) count too.
const playback = new PlaybackLimiter();

function inFrames(wc, code) {
  let frames = [];
  try {
    frames = wc.mainFrame.framesInSubtree;
  } catch (_) {}
  return Promise.all(frames.map((f) => f.executeJavaScript(code).catch(() => null)));
}

function pauseForLimit(id) {
  const tab = tabs.get(id);
  if (!tab || tab.view.webContents.isDestroyed()) return;
  inFrames(tab.view.webContents, pauseForLimitScript()).then(() => {
    if (tabs.has(id) && !tab.view.webContents.isDestroyed()) emit({ type: "update", tab: tabState(tab), activeId });
  });
}

function attachListeners(tab) {
  const wc = tab.view.webContents;
  // A closed tab's page is blanked before it is destroyed; ignore its events.
  const open = () => tabs.has(tab.id) && !wc.isDestroyed();
  const on = (event, fn) => wc.on(event, (...args) => (open() ? fn(...args) : undefined));
  const ping = () => emit({ type: "update", tab: tabState(tab), activeId });
  // A page can take focus by itself, for example a Mosaic tile that loads the
  // next video. Only focus that follows a click or key press in this tab makes
  // it the active tab; otherwise tabs would switch while the user is away.
  on("focus", () => {
    if (activeId !== tab.id && Date.now() - tab.lastGesture < 1500) activateTab(tab.id);
  });
  on("page-title-updated", (_e, title) => {
    historyStore.updateTitle(wc.getURL(), title);
    // Google refuses sign-in in apps built on Electron. Say so, and offer the
    // system browser for tasks that need a Google account.
    if (/(^|\.)accounts\.google\.com$/.test(hostOf(wc.getURL())) && /couldn.t sign you in/i.test(title)) {
      emit({ type: "google-signin-blocked", tabId: tab.id, url: wc.getURL() });
    }
    ping();
  });
  on("found-in-page", (_e, r) => {
    if (r.finalUpdate) emit({ type: "find", tabId: tab.id, active: r.activeMatchOrdinal, total: r.matches });
  });
  // Ctrl/Cmd + mouse wheel or trackpad pinch.
  on("zoom-changed", (_e, direction) => zoomTab(tab, direction === "in" ? 0.5 : -0.5));
  on("did-navigate", (_e, url) => {
    if (/^https?:/i.test(url)) tab.lastUrl = url;
    // The toolbar count is per page (B73). It starts again when a new page
    // starts loading (did-start-navigation), not here: by the time
    // did-navigate arrives, the new page's first requests may already have
    // been blocked and counted.
    tab.loop = null; // a new page: the loop ended with the old one (B70)
    // Sharing covers the site the user shared; going to another site ends it.
    if (tab.agentShared && originOf(url) !== tab.agentOrigin) {
      tab.agentShared = false;
      pushAgents();
    }
    playback.stopped(tab.id);
    playback.navigated(tab.id);
    if (!isInternal(url)) historyStore.record(url, wc.getTitle());
    refreshRule(tab, url);
    applyLayout();
    ping();
  });
  on("did-navigate-in-page", (_e, url, isMainFrame) => {
    if (isMainFrame) {
      refreshRule(tab, url);
      if (tab.loop && tab.loop.url !== String(url).split("#")[0]) tab.loop = null; // another video on the same page
      // Single-page sites (YouTube and similar) change address without loading.
      tryAutoplay(wc, tab.rule?.autoplay);
    }
    applyLayout();
    ping();
  });
  // Start media as soon as the page is parsed, not after every image and ad
  // has loaded. did-stop-loading tries again; the script runs once per address.
  on("dom-ready", () => {
    tryAutoplay(wc, tab.rule?.autoplay);
    // Clicking a video, image or embedded player scrolls it to the middle (site rule "center").
    if (tab.rule?.center !== false) runInPage(wc, centerOnClickScript()).catch(() => {});
  });
  on("did-start-loading", ping);
  on("did-stop-loading", () => {
    ping();
    tryAutoplay(wc, tab.rule?.autoplay);
    emit({ type: "settled", tab: tabState(tab) });
  });
  on("audio-state-changed", ping);
  on("media-started-playing", () => {
    for (const id of playback.started(tab.id, activeId)) pauseForLimit(id);
    ping();
  });
  on("media-paused", async () => {
    // Fired when any one element pauses; the tab stops counting only when nothing plays.
    const still = await inFrames(wc, anyPlayingScript());
    if (!open()) return;
    if (!still.some(Boolean)) playback.stopped(tab.id);
    ping();
  });
  // A page that fails to load shows NODE's error page with Try again; a page
  // whose process crashed shows "This page stopped".
  on("did-start-navigation", (details) => {
    if (!details.isMainFrame || details.isSameDocument) return;
    tab.loadingUrl = details.url;
    adblock?.resetTab(wc.id); // a new page: the shield count starts again (B73)
  });
  on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || !/^https?:/i.test(url || "")) return; // -3: navigation replaced
    // A late failure of a page the user already left must not replace the new page.
    if (tab.loadingUrl && tab.loadingUrl !== url) return;
    log().warn(`load failed: ${desc} (${code}) on ${hostOf(url)}`);
    wc.loadURL(errorUrl(url, { desc }));
  });
  wc.on("render-process-gone", (_e, details) => {
    if (!tabs.has(tab.id) || details.reason === "clean-exit" || wc.isDestroyed()) return;
    log().error(`tab ${tab.id} page stopped: ${details.reason} (exit code ${details.exitCode}) on ${hostOf(tab.lastUrl || "")}`);
    const url = tab.lastUrl || "";
    playback.stopped(tab.id);
    setTimeout(() => {
      if (tabs.has(tab.id) && !wc.isDestroyed()) wc.loadURL(errorUrl(url, { kind: "crash", desc: details.reason }));
    }, 50);
  });
  // Right-click menu.
  on("context-menu", (_e, p) => showContextMenu(tab, p));
  // Links and redirects to Google account pages go to the Google window. A tab
  // that has no page of its own (new, or a placeholder) shows the placeholder.
  const toGoogle = (e, url) => {
    if (!routesToGoogleWindow(url, googleMode())) return;
    e.preventDefault();
    routeGoogle(url, tab.id);
    const here = wc.getURL();
    if (!here || here === "about:blank" || isPlaceholder(here)) wc.loadURL(placeholderUrl(url));
  };
  on("will-navigate", (e) => {
    if (e.isMainFrame === false) return;
    // A share link clicked in a page opens the shared-trail preview.
    if (isShareLink(e.url)) {
      e.preventDefault();
      openShareLink(e.url);
      return;
    }
    // A trail file dropped on a page opens the shared-trail preview instead.
    if (/^file:/i.test(e.url)) {
      let file = "";
      try {
        file = require("url").fileURLToPath(e.url);
      } catch (_) {}
      if (file && isTrailPath(file)) {
        e.preventDefault();
        openSharedTrail(file);
        return;
      }
    }
    // The × on a start-page tile: forget that page and show the start page again.
    // The survey card's buttons (B98) come here too.
    if (isStartPage(e.url)) {
      let gone = "";
      let act = "";
      try {
        const sp = new URL(e.url).searchParams;
        gone = sp.get("remove") || "";
        act = sp.get("survey-act") || "";
      } catch (_) {}
      if (act) {
        e.preventDefault();
        surveyCardAnswer(act);
        const SURVEY_URL = require("./core/urls").SURVEY_URL;
        wc.loadURL(act === "take" ? loadTarget(SURVEY_URL, tab.id) : startPageUrl());
        return;
      }
      if (gone) {
        e.preventDefault();
        historyStore?.remove?.(gone);
        wc.loadURL(startPageUrl());
      }
      return;
    }
    toGoogle(e, e.url);
  });
  on("will-redirect", (e) => {
    if (e.isMainFrame) toGoogle(e, e.url);
  });
  // Popups (B04): only open a new tab if the user clicked or typed in this
  // page in the last 2 s. Everything else is blocked and reported to the UI.
  wc.setWindowOpenHandler(({ url, disposition }) => {
    const policy = tab.rule?.popups || "gesture";
    const allowed = policy === "allow" || (policy === "gesture" && Date.now() - tab.lastGesture < 2000);
    if (allowed && routesToGoogleWindow(url, googleMode())) {
      routeGoogle(url, tab.id);
    } else if (allowed) {
      createTab(url, { background: disposition === "background-tab" });
    } else {
      emit({ type: "popup-blocked", tabId: tab.id, url });
    }
    return { action: "deny" };
  });
  // Shortcuts typed while a web page has focus (B02). Menu accelerators cover
  // Cmd/Ctrl combos; this only records user activity for the popup check.
  on("before-input-event", (_e, input) => {
    if (input.type === "keyDown" || input.type === "mouseDown") tab.lastGesture = Date.now();
  });
}

// ---- Updates (B46, updater.js) ----
let updater = null;
async function checkForUpdatesFromMenu() {
  const st = await updater.check(true);
  if (st.status === "current") sendUi("notice", { message: `NODE ${app.getVersion()} is the latest version.` });
  else if (st.status === "downloading" || st.status === "checking") sendUi("notice", { message: `Downloading NODE ${st.version || "update"} in the background. NODE will offer to restart when it is ready.` });
  else if (st.status !== "ready") sendUi("update-error", { message: st.error || "Could not check for updates." });
}

// ---- Usage summary for the beta survey (B64, core/usage.js) ----
// Counts and days used, in userData/usage.json. Never sent anywhere.
let usageStore = null;
function usage() {
  if (!usageStore) {
    const file = path.join(app.getPath("userData"), "usage.json");
    usageStore = new Usage({ read: () => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null), write: (t) => fs.writeFileSync(file, t) });
  }
  return usageStore;
}
function systemName() {
  const os = require("os");
  if (process.platform === "darwin") return `macOS ${process.getSystemVersion()} (${process.arch})`;
  if (process.platform === "win32") return `Windows ${os.release()} (${process.arch})`;
  return `Linux ${os.release()} (${process.arch})`;
}
function usageSummary() {
  return usage().summary({ version: app.getVersion(), os: systemName() });
}

// ---- Error log and diagnostics (B31, log.js) ----
let logger = null;
function log() {
  if (!logger) logger = createLog(path.join(app.getPath("userData"), "logs"));
  return logger;
}
// Errors in NODE's own code are logged instead of stopping the app.
process.on("uncaughtException", (err) => log().error(`uncaught: ${err?.stack || err}`));
process.on("unhandledRejection", (err) => log().error(`unhandled rejection: ${err?.stack || err}`));

function diagnostics() {
  const s = loadSettings();
  const all = [...tabs.values()];
  const os = require("os");
  const lines = [
    `NODE ${app.getVersion()} · Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
    `System: ${process.platform} ${os.release()} ${process.arch} · locale ${app.getLocale()} · memory ${Math.round(os.totalmem() / 1073741824)} GB`,
    `Tabs: ${all.length} open, ${all.filter((t) => t.sleeping).length} asleep · layout ${layout} · sound ${soundAll ? "all" : "one"}`,
    `Search sources on: ${Object.entries(s.providers).filter(([, c]) => c.enabled).map(([id]) => id).join(", ") || "none"}`,
    `AI: ${s.ai.enabled ? "query ideas on" : "query ideas off"}, ${s.ai.provider}${Chat.canChat(s.ai) ? "" : " (not set up)"} · ad blocking ${s.adblock !== false ? "on" : "off"} (${adblock ? adblock.stats().status : "n/a"})`,
    `Google window: ${s.google.mode}${companion ? ` · ${companion.status().browser || "no browser found"} · ${companion.status().link}` : ""} · agents (MCP): ${agentServer?.status().running ? "on" : "off"} · reopen tabs: ${s.restoreTabs !== false ? "on" : "off"}`,
    `Site rules: ${siteRules.length} (${rulesErrors.length} problems)`,
    "",
    "Recent log lines:",
    ...log().recent(60),
  ];
  return lines.join("\n");
}

// ---- Sleeping tabs (B29) ----
// A tab not used for a while, not playing and not on screen is put to sleep:
// its page is replaced by a blank one and loads again when the tab is opened.
// Only time NODE is in use counts: the window is focused and the computer has
// had input in the last 2 minutes. Stepping away does not put tabs to sleep.
// Settings → Tabs: after 15, 30, 60 or 120 minutes of use, or never (0).
const SLEEP_CHOICES = [15, 30, 60, 120, 0];
const SLEEP_TICK_MS = 60 * 1000;
const AWAY_AFTER_S = 120;
function sleepAfterMs() {
  return (loadSettings().tabSleep || 0) * 60 * 1000;
}
function nodeInUse() {
  if (!win || win.isDestroyed() || !win.isFocused()) return false;
  try {
    return powerMonitor.getSystemIdleTime() < AWAY_AFTER_S;
  } catch {
    return true;
  }
}

function sleepTab(tab) {
  if (!tab || tab.sleeping || tab.id === activeId) return false;
  const wc = tab.view.webContents;
  const url = wc.getURL();
  if (!/^https?:/i.test(url) || wc.isCurrentlyAudible() || playback.snapshot().playing.includes(tab.id) || tab.agentShared) return false;
  tab.sleeping = { url, title: wc.getTitle() };
  wc.loadURL("about:blank").catch(() => {});
  emit({ type: "update", tab: tabState(tab), activeId });
  return true;
}

function wakeTab(tab) {
  if (!tab?.sleeping) return;
  const { url } = tab.sleeping;
  tab.sleeping = null;
  tab.view.webContents.loadURL(loadTarget(url, tab.id, { restore: true }));
}

// Called every minute. Tabs on screen start again from 0; the others add the
// minute only while NODE is in use. Tests pass a longer step and inUse: true.
function sleepIdleTabs({ step = SLEEP_TICK_MS, inUse = nodeInUse() } = {}) {
  const visible = layout === "mosaic" && !libraryOpen ? new Set(mosaicIds()) : new Set([activeId]);
  const limit = sleepAfterMs();
  let n = 0;
  for (const tab of tabs.values()) {
    if (visible.has(tab.id)) {
      tab.idleMs = 0;
      continue;
    }
    if (inUse) tab.idleMs = (tab.idleMs || 0) + step;
    if (!limit || tab.idleMs < limit) continue;
    if (sleepTab(tab)) n++;
  }
  return n;
}
setInterval(() => sleepIdleTabs(), SLEEP_TICK_MS).unref?.();

// ---- Passwords (B47, core/passwords.js) ----
// Saved only when the system has secure storage (Keychain, DPAPI, a Linux
// keyring); NODE never keeps passwords in plain text. Tests turn on Electron's
// plain-text mode with NODE_TEST_PLAIN_PASSWORDS=1 and --user-data-dir.
const PW = require("./core/passwords");
let pwStore = null;
function passwords() {
  if (!pwStore) {
    pwStore = PW.createPasswordStore({
      file: path.join(app.getPath("userData"), "passwords.json"),
      encrypt: (v) => ({ enc: safeStorage.encryptString(v).toString("base64") }),
      decrypt: (saved) => {
        try {
          return saved?.enc ? safeStorage.decryptString(Buffer.from(saved.enc, "base64")) : "";
        } catch {
          return "";
        }
      },
    });
  }
  return pwStore;
}
const canStorePasswords = () => safeStorage.isEncryptionAvailable();
const tabOfContents = (wc) => [...tabs.values()].find((t) => t.view.webContents === wc);
// The origin a sign-in belongs to: the frame's own (a sign-in form can sit in
// a frame from another site), on a normal page of a tab.
function passwordPageOrigin(tab, frame = null) {
  if (!tab || tab.tutorial || tab.sleeping) return null;
  const wc = tab.view.webContents;
  const url = wc.getURL();
  if (isInternal(url) || isTutorialPage(url)) return null;
  if (frame && frame !== wc.mainFrame) {
    try {
      return frame.isDestroyed?.() ? null : PW.originOf(frame.url);
    } catch {
      return null;
    }
  }
  return PW.originOf(url);
}
// Asks with a native sheet over the page (Safari does the same). Tests replace it.
let passwordAsk = (opts) => dialog.showMessageBox(win, opts).then((r) => r.response);
let passwordAsking = false;

async function onLoginSubmitted(tab, { username = "", password = "" }, frame = null) {
  const origin = passwordPageOrigin(tab, frame);
  if (!origin || loadSettings().passwordsOffer === false || !canStorePasswords()) return;
  username = String(username).slice(0, 256);
  password = String(password).slice(0, 1024);
  if (!password) {
    if (username) tab.pendingUser = { origin, username, at: Date.now() };
    return;
  }
  if (!username && tab.pendingUser && PW.sameSite(tab.pendingUser.origin, origin) && Date.now() - tab.pendingUser.at < 10 * 60 * 1000) username = tab.pendingUser.username;
  // The same sign-in can arrive from Enter, the click and the submit event.
  const key = `${origin}\n${username}\n${password}`;
  if (tab.lastLogin?.key === key && Date.now() - tab.lastLogin.at < 10000) return;
  tab.lastLogin = { key, at: Date.now() };
  const verdict = passwords().consider({ origin, username, password });
  if ((verdict.action !== "new" && verdict.action !== "update") || passwordAsking) return;
  const site = PW.siteName(origin);
  passwordAsking = true;
  try {
    if (verdict.action === "new") {
      const choice = await passwordAsk({
        type: "question",
        message: `Save the password for ${site}?`,
        detail: `${username ? `Username: ${username}\n\n` : ""}NODE keeps it on this computer, encrypted, and offers it the next time you sign in here. It is never sent anywhere.`,
        buttons: ["Save Password", "Never for This Site", "Not Now"],
        defaultId: 0,
        cancelId: 2,
      });
      if (choice === 0) passwords().save({ origin, username, password });
      else if (choice === 1) passwords().never(origin);
    } else {
      const choice = await passwordAsk({
        type: "question",
        message: `Update the saved password for ${username || "this login"} on ${site}?`,
        detail: "The password you just used is different from the one NODE saved.",
        buttons: ["Update Password", "Not Now"],
        defaultId: 0,
        cancelId: 1,
      });
      if (choice === 0) passwords().save({ origin, username, password });
    }
  } finally {
    passwordAsking = false;
    sendUi("passwords-changed", {});
  }
}

// Sends a login to the frame it was asked from, only if that frame is still on
// the login's site. The frame checks its own origin again before filling.
function fillLogin(tab, id, frame = null) {
  const f = frame || tab.view.webContents.mainFrame;
  const origin = passwordPageOrigin(tab, f);
  const login = origin && passwords().reveal(id, origin);
  if (!login) return false;
  f.send("pw:fill", { origin: new URL(f.url).origin, ...login });
  return true;
}
function fillNewPassword(tab, frame = null, password = PW.generatePassword()) {
  const f = frame || tab.view.webContents.mainFrame;
  const origin = passwordPageOrigin(tab, f);
  if (!origin) return null;
  f.send("pw:fill-new", { origin: new URL(f.url).origin, password });
  return password;
}

function loginMenuItems(tab, frame = null, { newPassword = false } = {}) {
  const origin = passwordPageOrigin(tab, frame);
  if (!origin || !canStorePasswords()) return [];
  const items = newPassword
    ? []
    : passwords()
        .forOrigin(origin)
        .slice(0, 8)
        .map((l) => ({ label: l.username || "Saved password (no username)", click: () => fillLogin(tab, l.id, frame) }));
  // On a sign-up or change-password form, suggest a strong password.
  if (newPassword && loadSettings().passwordsOffer !== false) items.push({ label: "Use Strong Password", sublabel: "NODE asks to save it when you send the form", click: () => fillNewPassword(tab, frame) });
  return items;
}

function showLoginMenu(tab, rect, frame = null, opts = {}) {
  const items = loginMenuItems(tab, frame, opts);
  if (!items.length || !tab.attached || win.isDestroyed()) return false;
  const inFrame = frame && frame !== tab.view.webContents.mainFrame;
  const b = tab.view.getBounds();
  const z = tab.view.webContents.getZoomFactor() || 1;
  if (global.nodeTest?.noPopup) {
    global.nodeTest.loginMenuShown = (global.nodeTest.loginMenuShown || 0) + 1;
    global.nodeTest.loginMenuLabels = items.map((i) => i.label);
    global.nodeTest.loginMenuRun = (n) => items[n]?.click();
    return true;
  }
  items.push({ type: "separator" }, { label: "Passwords…", click: () => sendUi("open-menu", { section: "settings", box: "passwords-box" }) });
  popupHold = true;
  // A field in a frame: its place in the page is not known here, so the menu
  // opens at the pointer.
  Menu.buildFromTemplate(items).popup({
    window: win,
    ...(inFrame ? {} : { x: Math.round(b.x + rect.x * z), y: Math.round(b.y + (rect.y + rect.height) * z + 2) }),
    callback: () => (popupHold = false),
  });
  return true;
}

ipcMain.on("pw:submitted", (e, data) => {
  const tab = tabOfContents(e.sender);
  // A sign-in follows the user's own click or key press; a page sending a form
  // by itself does not get to ask.
  if (!tab || !e.senderFrame || Date.now() - tab.lastGesture > 10000) return;
  onLoginSubmitted(tab, data || {}, e.senderFrame).catch(() => (passwordAsking = false));
});
ipcMain.handle("pw:focus", (e, { rect, newPassword } = {}) => {
  const tab = tabOfContents(e.sender);
  if (!tab || !e.senderFrame || !rect) return false;
  // Only right after a click or key press in this tab, so a page that moves
  // focus by itself does not open the menu.
  if (Date.now() - tab.lastGesture > 1000) return false;
  tab.pwFrame = e.senderFrame;
  return showLoginMenu(tab, rect, e.senderFrame, { newPassword: Boolean(newPassword) });
});
ipcMain.handle("passwords:list", () => ({
  available: canStorePasswords(),
  logins: canStorePasswords() ? passwords().list() : [],
  never: canStorePasswords() ? passwords().neverList() : [],
}));
ipcMain.handle("passwords:remove", (_e, id) => passwords().remove(String(id)));

// Showing or copying a saved password asks for Touch ID on a Mac that has it,
// and for a confirmation elsewhere. A yes lasts 2 minutes. Tests replace it.
let passwordAuthUntil = 0;
let passwordAuth = async (reason) => {
  if (process.platform === "darwin" && systemPreferences.canPromptTouchID?.()) {
    try {
      await systemPreferences.promptTouchID(reason);
      return true;
    } catch {
      return false;
    }
  }
  const r = await dialog.showMessageBox(win, {
    type: "warning",
    message: `NODE wants to ${reason}.`,
    detail: "Anyone who can see your screen can read it. Make sure you are alone, or copy it instead.",
    buttons: ["Continue", "Cancel"],
    defaultId: 1,
    cancelId: 1,
  });
  return r.response === 0;
};
async function passwordCheck(reason) {
  if (Date.now() < passwordAuthUntil) return true;
  const ok = await passwordAuth(reason);
  if (ok) passwordAuthUntil = Date.now() + 2 * 60 * 1000;
  return ok;
}
ipcMain.handle("passwords:reveal", async (_e, id) => {
  if (!canStorePasswords() || !(await passwordCheck("show a saved password"))) return null;
  return passwords().secret(String(id));
});
// Copied passwords are cleared from the clipboard after a minute, unless
// something else was copied since.
let clipTimer = null;
ipcMain.handle("passwords:copy", async (_e, id) => {
  if (!canStorePasswords() || !(await passwordCheck("copy a saved password"))) return false;
  const pw = passwords().secret(String(id));
  if (!pw) return false;
  clipboard.writeText(pw);
  clearTimeout(clipTimer);
  // (readText returns a promise in this Electron version; await works either way.)
  clipTimer = setTimeout(async () => {
    if ((await clipboard.readText()) === pw) clipboard.writeText("");
  }, global.nodeTest?.clipMs || 60 * 1000);
  return true;
});

// Import from a passwords file exported by another browser or password manager.
async function importPasswords(file) {
  if (!canStorePasswords()) return { error: "This computer has no secure storage for passwords." };
  let text;
  try {
    if (fs.statSync(file).size > 20 * 1024 * 1024) return { error: "The file is too large for a passwords file." };
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    return { error: "Could not read the file: " + String(err.message || err) };
  }
  const found = PW.loginsFromCsv(text);
  text = null;
  if (found.error) return { error: found.error };
  if (!found.logins.length) return { error: "No logins with a web address and a password were found in the file." };
  const plan = passwords().importPlan(found.logins);
  const lines = [`${plan.added} new`, plan.updated ? `${plan.updated} with a new password` : "", plan.same ? `${plan.same} already saved` : "", found.skipped ? `${found.skipped} rows skipped (no web address or password)` : ""].filter(Boolean);
  const go = await passwordAsk({
    type: "question",
    message: `Import ${plan.added + plan.updated} login${plan.added + plan.updated === 1 ? "" : "s"} from ${path.basename(file)}?`,
    detail: lines.join(" · ") + "\n\nThey are encrypted and kept on this computer.",
    buttons: ["Import", "Cancel"],
    defaultId: 0,
    cancelId: 1,
  });
  if (go !== 0) return { cancelled: true };
  const done = passwords().importMany(found.logins);
  sendUi("passwords-changed", {});
  // The exported file holds every password in plain text.
  const trash = await passwordAsk({
    type: "warning",
    message: "Move the exported file to the Trash?",
    detail: `${path.basename(file)} has all the passwords in plain text. NODE has its own encrypted copy now.`,
    buttons: ["Move to Trash", "Keep the File"],
    defaultId: 0,
    cancelId: 1,
  });
  let trashed = false;
  if (trash === 0) {
    try {
      await shell.trashItem(file);
      trashed = true;
    } catch {}
  }
  return { ...done, skipped: found.skipped, trashed };
}
ipcMain.handle("passwords:import", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "Import Passwords",
    message: "Choose the passwords file you exported (CSV)",
    filters: [{ name: "Passwords file", extensions: ["csv"] }],
    properties: ["openFile"],
  });
  if (r.canceled || !r.filePaths[0]) return { cancelled: true };
  return importPasswords(r.filePaths[0]);
});
ipcMain.handle("passwords:allow", (_e, origin) => passwords().allow(String(origin)));

// ---- Session restore ----
// The open tabs are saved to userData/tabs.json and reopened on the next start
// (asleep, except the active one).
let sessionTimer = null;
function sessionFile() {
  return path.join(app.getPath("userData"), "tabs.json");
}
function saveSessionSoon() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(saveSessionNow, 1000);
}
function saveSessionNow() {
  clearTimeout(sessionTimer);
  if (pagesReleased) return; // quitting: keep the last saved list
  const list = [...tabs.values()].map((t) => ({ ...tabState(t), trail: t.trail })).filter((t) => /^https?:/i.test(t.url));
  const active = list.findIndex((t) => t.id === activeId);
  try {
    fs.writeFileSync(sessionFile(), JSON.stringify({ version: 1, layout, active: Math.max(0, active), tabs: list.map((t) => ({ url: t.url, title: t.title, ...(t.tile ? { tile: true } : {}), ...(t.trail ? { trail: t.trail } : {}) })) }));
  } catch (_) {}
}
function restoreSession() {
  let saved = null;
  try {
    saved = JSON.parse(fs.readFileSync(sessionFile(), "utf8"));
  } catch (_) {}
  const list = (saved?.tabs || []).filter((t) => /^https?:/i.test(t?.url || "")).slice(0, 100);
  if (!list.length || loadSettings().restoreTabs === false) return false;
  const active = Math.min(Math.max(0, saved.active || 0), list.length - 1);
  // Tabs saved before trails kept tabs have none: they join the current trail.
  const ids = list.map((t, i) => createTab(t.url, { background: i !== active, sleeping: i !== active, restore: true, title: t.title, tile: t.tile === true, trail: typeof t.trail === "string" ? t.trail : undefined }));
  const target = tabs.get(ids[active]);
  if (target && inCurrentTrail(target)) activateTab(target.id);
  else activateTab(shownTabs().at(-1)?.id || createTab(newTabUrl()));
  return true;
}

// ---- Agents (MCP server, agent-server.js and agents.js) ----
// Off by default. When on, AI agents on this computer can search, read public
// pages logged out, read tabs the user shares, and read research sessions.
let agentServer = null;
const agentLog = []; // recent calls, newest last, shown in Settings

function agentsStatus() {
  const conf = loadSettings().agents;
  const st = agentServer ? agentServer.status() : { running: false, port: 0, error: "", url: "" };
  return { enabled: conf.enabled, port: conf.port, token: conf.token, ...st, log: agentLog.slice(-20).reverse(), shared: [...tabs.values()].filter((t) => t.agentShared).length };
}

// The Claude desktop app only starts MCP servers as programs (stdio), so NODE
// gives it mcp-bridge.js, run by NODE's own Electron as plain Node.
function claudeDesktopFile() {
  const home = app.getPath("home");
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  if (process.platform === "win32") return path.join(app.getPath("appData"), "Claude", "claude_desktop_config.json");
  return path.join(home, ".config", "Claude", "claude_desktop_config.json");
}

function claudeDesktopEntry() {
  const st = agentsStatus();
  return {
    command: process.execPath,
    args: [path.join(__dirname, "mcp-bridge.js")],
    env: { ELECTRON_RUN_AS_NODE: "1", NODE_MCP_URL: `http://127.0.0.1:${st.port}/mcp`, NODE_MCP_TOKEN: st.token || "" },
  };
}

function addToClaudeDesktop() {
  const st = agentsStatus();
  if (!st.enabled || !st.token) throw new Error("Turn on Agents first.");
  const file = claudeDesktopFile();
  let conf = {};
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, "utf8");
    try {
      conf = text.trim() ? JSON.parse(text) : {};
    } catch (_) {
      throw new Error("The Claude app's settings file is not valid JSON, so NODE did not change it. Use Copy config and add it by hand.");
    }
    fs.writeFileSync(file + ".node-backup", text); // keep the previous version
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  conf.mcpServers = { ...(conf.mcpServers || {}), node: claudeDesktopEntry() };
  fs.writeFileSync(file, JSON.stringify(conf, null, 2));
  log().info("agents: added NODE to the Claude desktop config");
  return { file };
}

function pushAgents() {
  sendUi("agents-status", agentsStatus());
}

async function setAgents(on) {
  const conf = loadSettings().agents;
  if (on && !conf.token) conf.token = require("crypto").randomBytes(24).toString("base64url");
  conf.enabled = Boolean(on);
  saveSettings({});
  if (on) await agentServer.start();
  else {
    agentServer.stop();
    // Stopping agents also takes back every shared tab.
    for (const t of tabs.values()) t.agentShared = false;
    emitList();
  }
  pushAgents();
  return agentsStatus();
}

let agentTools = null; // reader and search shared with the research agent
let researchRun = null; // { stop: boolean } while the research agent runs

function initAgents() {
  agentTools = createAgents({
    BrowserWindow,
    session,
    userAgent: AGENT_UA,
    registry: search,
    research,
    getTabs: () =>
      [...tabs.values()].map((t) => ({ id: t.id, title: t.view.webContents.getTitle(), url: t.view.webContents.getURL(), shared: Boolean(t.agentShared) && !isPlaceholder(t.view.webContents.getURL()), webContents: t.view.webContents })),
    // The tests serve their pages from 127.0.0.1 (this computer only).
    allowPrivate: () => process.env.NODE_AGENT_ALLOW_LOCAL === "1",
  });
  const { tools, resources } = agentTools;
  agentServer = createAgentServer({
    getConfig: () => loadSettings().agents,
    tools,
    resources,
    version: app.getVersion(),
    onActivity: (entry) => {
      agentLog.push(entry);
      if (agentLog.length > 100) agentLog.shift();
      research?.agentActivity(entry);
      pushAgents();
    },
  });
  if (loadSettings().agents.enabled) agentServer.start().then(pushAgents);
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch (_) {
    return "";
  }
}

function shareTabWithAgents(id, on) {
  const tab = tabs.get(id);
  if (!tab) return false;
  tab.agentShared = Boolean(on) && Boolean(agentServer?.status().running);
  tab.agentOrigin = tab.agentShared ? originOf(tab.view.webContents.getURL()) : "";
  emit({ type: "update", tab: tabState(tab), activeId });
  pushAgents();
  return tab.agentShared;
}

// ---- Google window (B52, companion.js) ----
// Google account pages open in a separate Chromium-based browser window,
// because Google refuses sign-in inside Electron. The NODE tab shows a
// placeholder page with a button that brings the page to the front.
let companion = null;

function googleMode() {
  return loadSettings().google.mode;
}

function placeholderUrl(target) {
  const file = path.join(__dirname, "renderer", "google-tab.html");
  return `file://${file.split(path.sep).join("/")}?u=${encodeURIComponent(target)}`;
}

function isPlaceholder(url) {
  return /\/renderer\/google-tab\.html\?/.test(String(url || ""));
}

// NODE's own pages shown in a tab: the Google window placeholder, the
// "page not loaded" / "page stopped" page (both carry the real address in ?u=)
// and the new tab page.
function isInternal(url) {
  return /\/renderer\/(google-tab|error)\.html\?/.test(String(url || "")) || isStartPage(url) || isTutorialPage(url);
}

// The gestures tutorial's practice pages (B72): no address shown, no suggestions.
function isTutorialPage(url) {
  return /\/renderer\/tutorial\/[a-z]+\.html$/.test(String(url || ""));
}

function isStartPage(url) {
  return /\/renderer\/start\.html(\?|$)/.test(String(url || ""));
}

// The new tab page, with the most visited pages from history.
function startPageUrl() {
  const file = path.join(__dirname, "renderer", "start.html");
  const top = (historyStore?.top?.(8) || []).map((r) => ({ url: r.url, title: String(r.title || "").slice(0, 80) }));
  const days = surveyCardDays();
  return `file://${file.split(path.sep).join("/")}?top=${encodeURIComponent(JSON.stringify(top))}${days ? `&survey=${days}` : ""}`;
}

// ---- Beta survey on the new tab page (B98) ----
// The same survey prompt as the one in the suggestions widget (B65), shown as
// a larger card on the new tab page once NODE has been used on 3 different
// days. The answer is shared with the window, which keeps it as node.survey:
// Take survey and Don't ask again end both prompts; Later waits for another
// day of use. The state is kept in survey.json so a new tab opened before the
// window has loaded still knows it; until either has it, no card is shown.
const SURVEY_AFTER_DAYS = 3;
let surveyState = null;
function surveyFile() {
  return path.join(app.getPath("userData"), "survey.json");
}
function loadSurveyState() {
  if (surveyState) return surveyState;
  try {
    surveyState = JSON.parse(fs.readFileSync(surveyFile(), "utf8"));
  } catch (_) {}
  return surveyState;
}
function setSurveyState(next, { fromWindow = false } = {}) {
  if (!next || typeof next.state !== "string") return;
  surveyState = { state: next.state, ...(Number(next.laterDays) ? { laterDays: Number(next.laterDays) } : {}) };
  try {
    fs.writeFileSync(surveyFile(), JSON.stringify(surveyState));
  } catch (_) {}
  if (!fromWindow) sendUi("survey-state", { state: surveyState });
}
function surveyCardDays() {
  const s = loadSurveyState();
  if (!s || s.state !== "ask") return 0;
  let days = 0;
  try {
    days = usage().daysUsed();
  } catch (_) {
    return 0;
  }
  if (days < SURVEY_AFTER_DAYS || (s.laterDays && days <= s.laterDays)) return 0;
  return days;
}
// A choice made on the card: the start page navigates to ?survey-act=…
function surveyCardAnswer(act) {
  const days = (() => {
    try {
      return usage().daysUsed();
    } catch (_) {
      return 0;
    }
  })();
  if (act === "take") setSurveyState({ state: "done" });
  else if (act === "never") setSurveyState({ state: "never" });
  else setSurveyState({ state: "ask", laterDays: days });
}

// What a new tab opens: NODE's start page, or the address set in Settings.
function newTabUrl() {
  const custom = loadSettings().startPage;
  return /^https?:\/\//i.test(custom || "") ? custom : startPageUrl();
}

function errorUrl(target, { kind = "load", desc = "" } = {}) {
  const file = path.join(__dirname, "renderer", "error.html");
  return `file://${file.split(path.sep).join("/")}?kind=${kind}&desc=${encodeURIComponent(desc)}&u=${encodeURIComponent(target)}`;
}

// Returns true when the address was sent to the Google window (or, with no
// Chromium-based browser installed, to the default browser).
function routeGoogle(url, tabId) {
  if (!companion || !routesToGoogleWindow(url, googleMode())) return false;
  companion.open(url).then((ok) => {
    if (!ok) {
      shell.openExternal(url);
      emit({ type: "google-window", tabId, url, ok: false });
    } else {
      emit({ type: "google-window", tabId, url, ok: true });
    }
  });
  return true;
}

// The address a tab should load: the placeholder for routed Google pages.
function loadTarget(url, tabId, { restore = false } = {}) {
  if (isStartPage(url)) return url;
  const target = normalizeUrl(url);
  if (restore && routesToGoogleWindow(target, googleMode())) return placeholderUrl(target);
  return routeGoogle(target, tabId) ? placeholderUrl(target) : target;
}

function createTab(url, opts = {}) {
  const id = String(idSeq++);
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "view-preload.js"),
      additionalArguments: [`--scout-tab=${id}`],
      nodeIntegrationInSubFrames: true, // runs view-preload.js in frames too, for sign-in forms there (no Node access: sandboxed)
      sandbox: true,
      contextIsolation: true,
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  view.setBackgroundColor("#ffffff"); // pages without their own background expect white
  view.webContents.setUserAgent(USER_AGENT);
  const tab = { id, view, audio: "auto", audioByUser: false, lastGesture: 0, lastActive: Date.now(), idleMs: 0, tile: Boolean(opts.tile), trail: opts.trail || currentTrail() };
  refreshRule(tab, normalizeUrl(url));
  tabs.set(id, tab);
  win.contentView.addChildView(view);
  tab.attached = true;
  attachListeners(tab);
  // A page's own full screen (a video) fills the window, above the toolbar.
  view.webContents.on("enter-html-full-screen", () => {
    htmlFullId = id;
    showOverlay(false, { instant: true }); // a video's own full screen never shows the toolbar
    applyLayout();
  });
  view.webContents.on("leave-html-full-screen", () => {
    if (htmlFullId === id) htmlFullId = null;
    applyLayout();
  });
  if (!opts.background || !activeId) activeId = id;
  if (opts.sleeping && activeId !== id) {
    // Restored tab: the page loads when the tab is first opened.
    tab.sleeping = { url: normalizeUrl(url), title: opts.title || "" };
    view.webContents.loadURL("about:blank");
  } else if (opts.restore && routesToGoogleWindow(normalizeUrl(url), googleMode())) {
    view.webContents.loadURL(placeholderUrl(normalizeUrl(url))); // do not open the Google window on start
  } else {
    view.webContents.loadURL(loadTarget(url, id));
  }
  // In Mosaic the existing tiles slide to their new cells; the new tab appears in place.
  applyLayout(layout === "mosaic" ? { animate: "move" } : {});
  emitList();
  return id;
}

// Recently closed tabs, newest last, for Reopen Closed Tab (Cmd/Ctrl+Shift+T).
const closedTabs = [];

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  {
    const st = tabState(tab);
    if (/^https?:/i.test(st.url)) {
      closedTabs.push({ url: st.url, title: st.title });
      if (closedTabs.length > 25) closedTabs.shift();
    }
  }
  tabs.delete(id);
  if (htmlFullId === id) htmlFullId = null;
  if (tab.attached) win.contentView.removeChildView(tab.view);
  // WebContentsView does not free its page on removal; close it explicitly.
  // Closing a page while a video is playing crashed Electron (seen on Linux),
  // so the page is first replaced with a blank one, then closed.
  const wc = tab.view.webContents;
  const close = () => {
    try {
      if (!wc.isDestroyed()) wc.close();
    } catch (_) {}
  };
  try {
    wc.setAudioMuted(true);
    wc.loadURL("about:blank").then(close, close);
  } catch (_) {
    close();
  }
  playback.closed(id);
  if (activeId === id) {
    activeId = shownTabs().at(-1)?.id || null;
  }
  if (!activeId) createTab(newTabUrl());
  applyLayout(layout === "mosaic" ? { animate: "move" } : {});
  emitList();
}

// ---- Right-click menu ----
async function showContextMenu(tab, p) {
  // Video players that draw their own controls over the video, or play from a
  // blob: address (Nowness, Vimeo and others), hide the video from the
  // right-click. Ask the page itself whether it has one (B72).
  const video = p.mediaType === "video" || (await pageHasVideo(tab));
  Menu.buildFromTemplate(contextMenuItems(tab, p, { video })).popup({ window: win });
}

// True if any frame of the page has a video that has loaded. Gives up after
// 250 ms so the menu never waits on a busy page.
async function pageHasVideo(tab) {
  let frames = [];
  try {
    frames = tab.view.webContents.mainFrame.framesInSubtree;
  } catch (_) {}
  const ask = Promise.all(
    frames.map((f) => f.executeJavaScript(`[...document.querySelectorAll("video")].some((v) => v.readyState > 0)`, true).catch(() => false))
  ).then((r) => r.some(Boolean));
  return Promise.race([ask, new Promise((r) => setTimeout(() => r(false), 250))]);
}

function contextMenuItems(tab, p, { video = p.mediaType === "video" } = {}) {
  const wc = tab.view.webContents;
  const items = [];
  const sep = () => items.length && items.at(-1).type !== "separator" && items.push({ type: "separator" });
  const http = (u) => /^https?:\/\//i.test(u || "");
  if (http(p.linkURL)) {
    items.push(
      { label: "Open Link in New Tab", click: () => createTab(p.linkURL) },
      { label: "Open Link in Background Tab", click: () => createTab(p.linkURL, { background: true }) },
      { label: "Copy Link Address", click: () => clipboard.writeText(p.linkURL) },
      { label: "Save Link As…", click: () => wc.downloadURL(p.linkURL) }
    );
  }
  if (p.mediaType === "image" && http(p.srcURL)) {
    sep();
    items.push(
      { label: "Open Image in New Tab", click: () => createTab(p.srcURL) },
      { label: "Copy Image", click: () => wc.copyImageAt(p.x, p.y) },
      { label: "Copy Image Address", click: () => clipboard.writeText(p.srcURL) },
      { label: "Save Image As…", click: () => wc.downloadURL(p.srcURL) }
    );
  }
  if ((p.mediaType === "video" || p.mediaType === "audio") && http(p.srcURL)) {
    sep();
    items.push({ label: `Open ${p.mediaType === "video" ? "Video" : "Audio"} in New Tab`, click: () => createTab(p.srcURL) }, { label: `Copy ${p.mediaType === "video" ? "Video" : "Audio"} Address`, click: () => clipboard.writeText(p.srcURL) });
    if (p.mediaType === "video") items.push({ label: "Picture in Picture", click: () => togglePip(tab.id) }, { label: "Loop Section", submenu: loopMenu(tab.id) });
  } else if (video) {
    // A video the right-click did not land on directly (custom player, blob: address).
    sep();
    items.push({ label: "Picture in Picture", click: () => togglePip(tab.id) }, { label: "Loop Section", submenu: loopMenu(tab.id) });
  }
  // On a Mac, a right-click selects the word under the pointer, which can be a
  // lone quote mark or bracket; only offer search and pin for real words.
  const raw = String(p.selectionText || "").trim();
  const text = /[\p{L}\p{N}]/u.test(raw) ? raw : "";
  if (p.isEditable) {
    sep();
    for (const word of (p.dictionarySuggestions || []).slice(0, 5)) items.push({ label: word, click: () => wc.replaceMisspelling(word) });
    if (p.misspelledWord) items.push({ label: "Add to Dictionary", click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, { type: "separator" });
    items.push({ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" });
    const logins = /^input/.test(p.formControlType || "") || p.inputFieldType === "password" ? loginMenuItems(tab, p.frame || null).filter((i) => i.label !== "Use Strong Password") : [];
    if (logins.length) items.push({ type: "separator" }, { label: "Fill Saved Login", submenu: logins });
  } else if (text) {
    sep();
    const short = text.length > 30 ? text.slice(0, 30) + "…" : text;
    items.push(
      { role: "copy" },
      { label: `Search Brave for "${short}"`, click: () => createTab(SEARCH_URL + encodeURIComponent(text.slice(0, 300))) },
      { label: `Pin "${short}" as a keyword`, click: () => sendUi("pin-keyword", { text: text.slice(0, 80) }) }
    );
  }
  if (!items.length || (!p.linkURL && !p.srcURL && !text && !p.isEditable)) {
    sep();
    items.push(
      { label: "Back", enabled: wc.canGoBack(), click: () => wc.goBack() },
      { label: "Forward", enabled: wc.canGoForward(), click: () => wc.goForward() },
      { label: "Reload", click: () => wc.reload() },
      { type: "separator" },
      { label: "Save Page as PDF", click: () => savePdf(tab.id) },
      { label: "Print…", click: () => wc.print({}, () => {}) },
      { label: "Screenshot Tab", click: () => runShotFromMain(tab.id) }
    );
    if (agentServer?.status().running) items.push({ type: "separator" }, { label: tab.agentShared ? "Stop Sharing with Agents" : "Share Tab with Agents", click: () => shareTabWithAgents(tab.id, !tab.agentShared) });
  }
  sep();
  items.push({ label: "Inspect", click: () => wc.inspectElement(p.x, p.y) });
  return items;
}

// ---- Downloads ----
// Files go straight to the system Downloads folder (as in Chrome), with a
// number added when the name is taken. The list is shown in Library → Downloads.
const downloads = []; // newest last
let downloadSeq = 1;

function downloadState(d) {
  return { id: d.id, name: d.name, url: d.url, file: d.file, received: d.received, total: d.total, state: d.state, started: d.started };
}

function watchDownloads(ses) {
  ses.on("will-download", (_e, item) => {
    const name = item.getFilename() || "download";
    const file = uniquePath(path.join(app.getPath("downloads"), name));
    item.setSavePath(file);
    const d = { id: String(downloadSeq++), name: path.basename(file), url: item.getURL(), file, received: 0, total: item.getTotalBytes(), state: "progressing", started: Date.now(), item };
    downloads.push(d);
    if (downloads.length > 200) downloads.shift();
    const push = () => sendUi("downloads", { list: downloads.slice(-50).reverse().map(downloadState), active: downloads.filter((x) => x.state === "progressing").length });
    item.on("updated", (_ev, state) => {
      d.received = item.getReceivedBytes();
      d.total = item.getTotalBytes();
      d.state = state === "interrupted" ? "interrupted" : item.isPaused() ? "paused" : "progressing";
      push();
    });
    item.once("done", (_ev, state) => {
      d.state = state; // completed | cancelled | interrupted
      d.received = item.getReceivedBytes();
      d.item = null;
      push();
      if (state === "completed") sendUi("notice", { message: `Downloaded ${d.name}`, file: d.file });
    });
    push();
  });
}

function stepTab(dir) {
  const ids = shownTabs().map((t) => t.id);
  if (ids.length < 2) return;
  const i = ids.indexOf(activeId);
  activateTab(ids[(i + dir + ids.length) % ids.length]);
}

function pickTab(index) {
  // In Mosaic, ⌘1 to ⌘4 focus that tile (B72).
  if (layout === "mosaic" && !libraryOpen && index >= 0) {
    const id = mosaicIds()[index];
    if (id) return focusTile(id);
  }
  const ids = shownTabs().map((t) => t.id);
  const id = index < 0 ? ids.at(-1) : ids[index];
  if (id) activateTab(id);
}

async function savePdf(id) {
  const tab = tabs.get(id);
  if (!tab || tab.sleeping) return;
  const wc = tab.view.webContents;
  try {
    const data = await wc.printToPDF({ printBackground: true });
    const safe = (wc.getTitle() || "page").replace(/[^\w .-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "page";
    const file = uniquePath(path.join(app.getPath("downloads"), `${safe}.pdf`));
    fs.writeFileSync(file, data);
    sendUi("notice", { message: `Saved as PDF: ${path.basename(file)} (Downloads)`, file });
  } catch (err) {
    sendUi("error", { message: "Could not save the page as PDF: " + String(err.message || err) });
  }
}

function uniquePath(file) {
  if (!fs.existsSync(file)) return file;
  const ext = path.extname(file);
  const base = file.slice(0, file.length - ext.length);
  for (let i = 1; i < 1000; i++) {
    const next = `${base} (${i})${ext}`;
    if (!fs.existsSync(next)) return next;
  }
  return `${base} ${Date.now()}${ext}`;
}

function activateTab(id) {
  if (!tabs.has(id)) return;
  activeId = id;
  wakeTab(tabs.get(id));
  tabs.get(id).lastActive = Date.now();
  tabs.get(id).idleMs = 0;
  // A tab paused by the playback limit resumes when it becomes active.
  if (playback.activated(id)) inFrames(tabs.get(id).view.webContents, resumeScript());
  applyLayout();
  emitList();
}

async function extractPage(id) {
  const tab = tabs.get(id);
  if (!tab) return null;
  try {
    return await runInPage(tab.view.webContents, extractionScript(tab.rule?.extract), true);
  } catch (err) {
    return { url: tab.view.webContents.getURL(), title: tab.view.webContents.getTitle(), error: String(err) };
  }
}

// ---- Network layer (B12, B13): core/net.js ----
// fetch is looked up on each call so tests can replace globalThis.fetch.
const netLayer = createNet({ fetch: (...args) => globalThis.fetch(...args), userAgent: BACKGROUND_UA });
const getText = netLayer.getText;
const CACHE_TTL = netLayer.ttl;



// ---- Settings (B15) ----
// userData/settings.json. Secret fields (API keys) are encrypted with the OS
// keychain through safeStorage when it is available.
let settingsCache = null;

function settingsFile() {
  return path.join(app.getPath("userData"), "settings.json");
}

function secretFields(id) {
  return (PROVIDERS[id]?.fields || []).filter((f) => f.secret).map((f) => f.key);
}

function encryptSecret(value) {
  return value && safeStorage.isEncryptionAvailable() ? { enc: safeStorage.encryptString(value).toString("base64") } : { plain: value || "" };
}

function decryptSecret(saved) {
  if (saved?.enc && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(saved.enc, "base64"));
    } catch (_) {
      return "";
    }
  }
  return typeof saved?.plain === "string" ? saved.plain : "";
}

function loadSettings() {
  if (settingsCache) return settingsCache;
  const base = defaultSettings();
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
  } catch (_) {}
  for (const id of Object.keys(base.providers)) {
    const saved = raw.providers?.[id] || {};
    const merged = { ...base.providers[id], ...saved };
    for (const key of secretFields(id)) {
      const enc = saved[key + "Enc"];
      if (enc && safeStorage.isEncryptionAvailable()) {
        try {
          merged[key] = safeStorage.decryptString(Buffer.from(enc, "base64"));
        } catch (_) {
          merged[key] = "";
        }
      }
      delete merged[key + "Enc"];
    }
    base.providers[id] = merged;
  }
  // Settings saved before Brave became the default source had it switched off.
  if ((raw.version || 1) < 2 && raw.providers?.brave) base.providers.brave.enabled = true;
  // AI query ideas (B20). The Grok key is stored like the search keys.
  const ai = raw.ai || {};
  base.ai = {
    enabled: Boolean(ai.enabled),
    provider: ai.provider === "grok" ? "grok" : "local",
    local: { ...AI.AI_DEFAULTS.local, ...(ai.local || {}) },
    grok: { model: ai.grok?.model || AI.AI_DEFAULTS.grok.model, key: decryptSecret(ai.grok?.key) },
  };
  base.adblock = raw.adblock !== false;
  base.adblockCookies = raw.adblockCookies === true; // B77: also hide cookie notices (off by default, as in uBlock Origin)
  base.restoreTabs = raw.restoreTabs !== false;
  base.autoUpdate = raw.autoUpdate !== false;
  base.passkeys = raw.passkeys === true;
  base.startPage = typeof raw.startPage === "string" ? raw.startPage : "";
  base.mosaicMax = MOSAIC_MAX_CHOICES.includes(raw.mosaicMax) ? raw.mosaicMax : 4;
  base.tabSleep = SLEEP_CHOICES.includes(raw.tabSleep) ? raw.tabSleep : 30;
  base.passwordsOffer = raw.passwordsOffer !== false;
  base.chromeLayout = raw.chromeLayout === "side" ? "side" : "top";
  base.displayName = typeof raw.displayName === "string" ? raw.displayName.trim().slice(0, 60) : "";
  // First-run setup is shown once, to new users. Settings saved by an earlier
  // version count as set up. Runs with --user-data-dir (the tests) skip it
  // unless NODE_FIRST_RUN=1.
  const testRun = app.commandLine.hasSwitch("user-data-dir") && process.env.NODE_FIRST_RUN !== "1";
  base.firstRunDone = Boolean(raw.firstRunDone) || Object.keys(raw).length > 0 || testRun;
  base.agents = {
    enabled: Boolean(raw.agents?.enabled),
    port: Number(raw.agents?.port) || 47615,
    token: decryptSecret(raw.agents?.token),
  };
  base.google = {
    mode: GOOGLE_MODES.includes(raw.google?.mode) ? raw.google.mode : "apps",
    browser: typeof raw.google?.browser === "string" ? raw.google.browser : "",
  };
  settingsCache = base;
  return settingsCache;
}

function saveSettings(next) {
  const current = loadSettings();
  for (const id of Object.keys(PROVIDERS)) {
    const incoming = next?.providers?.[id];
    if (!incoming) continue;
    const allowed = ["enabled", ...PROVIDERS[id].fields.map((f) => f.key)];
    const before = JSON.stringify(current.providers[id]);
    for (const k of allowed) if (k in incoming) current.providers[id][k] = k === "enabled" ? Boolean(incoming[k]) : String(incoming[k] || "").trim();
    if (JSON.stringify(current.providers[id]) !== before) search.reset(id);
  }
  if (next && "adblock" in next) current.adblock = Boolean(next.adblock);
  if (next && "adblockCookies" in next && Boolean(next.adblockCookies) !== current.adblockCookies) {
    current.adblockCookies = Boolean(next.adblockCookies);
    setTimeout(() => adblock?.load(), 0); // switch between the two list sets
  }
  if (next && "restoreTabs" in next) current.restoreTabs = Boolean(next.restoreTabs);
  if (next && "autoUpdate" in next) current.autoUpdate = Boolean(next.autoUpdate);
  if (next && "passkeys" in next) current.passkeys = Boolean(next.passkeys);
  if (next && typeof next.startPage === "string") current.startPage = /^https?:\/\//i.test(next.startPage.trim()) ? next.startPage.trim() : "";
  if (next && next.firstRunDone) current.firstRunDone = true;
  if (next && "passwordsOffer" in next) current.passwordsOffer = Boolean(next.passwordsOffer);
  if (next && "chromeLayout" in next) current.chromeLayout = next.chromeLayout === "side" ? "side" : "top";
  if (next && typeof next.displayName === "string") current.displayName = next.displayName.trim().replace(/\s+/g, " ").slice(0, 60);
  if (next && "tabSleep" in next && SLEEP_CHOICES.includes(Number(next.tabSleep))) current.tabSleep = Number(next.tabSleep);
  if (next && MOSAIC_MAX_CHOICES.includes(Number(next.mosaicMax))) {
    current.mosaicMax = Number(next.mosaicMax);
    if (layout === "mosaic") setTimeout(() => applyLayout({ animate: "move" }), 0);
  }
  if (next?.agents) {
    if ("port" in next.agents) {
      const port = Math.round(Number(next.agents.port));
      if (port >= 1024 && port <= 65535) current.agents.port = port;
    }
  }
  if (next?.google) {
    if (GOOGLE_MODES.includes(next.google.mode)) current.google.mode = next.google.mode;
    if (typeof next.google.browser === "string") current.google.browser = next.google.browser.trim();
  }
  const inAi = next?.ai;
  if (inAi) {
    const a = current.ai;
    const before = JSON.stringify(a);
    if ("enabled" in inAi) a.enabled = Boolean(inAi.enabled);
    if (inAi.provider === "grok" || inAi.provider === "local") a.provider = inAi.provider;
    if (inAi.local?.url !== undefined) a.local.url = String(inAi.local.url).trim();
    if (inAi.local?.model !== undefined) a.local.model = String(inAi.local.model).trim();
    if (inAi.grok?.model !== undefined) a.grok.model = String(inAi.grok.model).trim();
    if (inAi.grok?.key !== undefined) a.grok.key = String(inAi.grok.key).trim();
    if (JSON.stringify(a) !== before) aiReset();
  }
  const disk = {
    version: SETTINGS_VERSION,
    adblock: current.adblock !== false,
    adblockCookies: current.adblockCookies === true,
    google: { ...current.google },
    restoreTabs: current.restoreTabs !== false,
    autoUpdate: current.autoUpdate !== false,
    passkeys: current.passkeys === true,
    startPage: current.startPage || "",
    mosaicMax: current.mosaicMax,
    tabSleep: current.tabSleep,
    passwordsOffer: current.passwordsOffer !== false,
    chromeLayout: current.chromeLayout === "side" ? "side" : "top",
    displayName: current.displayName || "",
    firstRunDone: Boolean(current.firstRunDone),
    agents: { enabled: current.agents.enabled, port: current.agents.port, token: encryptSecret(current.agents.token) },
    providers: {},
  };
  for (const [id, conf] of Object.entries(current.providers)) {
    const copy = { ...conf };
    for (const key of secretFields(id)) {
      if (copy[key] && safeStorage.isEncryptionAvailable()) {
        copy[key + "Enc"] = safeStorage.encryptString(copy[key]).toString("base64");
        delete copy[key];
      }
    }
    disk.providers[id] = copy;
  }
  const a = current.ai;
  disk.ai = { enabled: a.enabled, provider: a.provider, local: a.local, grok: { model: a.grok.model, key: encryptSecret(a.grok.key) } };
  fs.writeFileSync(settingsFile(), JSON.stringify(disk, null, 2));
  return publicSettings();
}

// What the UI sees: secrets are never sent back, only whether one is set.
function publicSettings() {
  const s = loadSettings();
  const providers = {};
  for (const [id, conf] of Object.entries(s.providers)) {
    const copy = { ...conf };
    for (const key of secretFields(id)) {
      copy[key + "Set"] = Boolean(copy[key]);
      delete copy[key];
    }
    providers[id] = copy;
  }
  const a = s.ai;
  return {
    providers,
    ai: { enabled: a.enabled, provider: a.provider, local: { ...a.local }, grok: { model: a.grok.model, keySet: Boolean(a.grok.key) } },
    aiStatus: { ...aiState },
    adblock: s.adblock !== false,
    adblockStats: adblock ? adblock.stats() : { status: "off", blocked: 0 },
    adblockCookies: s.adblockCookies === true,
    google: { ...s.google },
    restoreTabs: s.restoreTabs !== false,
    autoUpdate: s.autoUpdate !== false,
    passkeys: s.passkeys === true,
    passkeysActive: PASSKEYS_ON,
    update: updater ? updater.state() : null,
    startPage: s.startPage || "",
    mosaicMax: s.mosaicMax,
    tabSleep: s.tabSleep,
    passwordsOffer: s.passwordsOffer !== false,
    chromeLayout: s.chromeLayout === "side" ? "side" : "top",
    displayName: s.displayName || "",
    firstRunDone: Boolean(s.firstRunDone),
    googleWindow: companion ? companion.status() : null,
    agents: agentsStatus(),
    meta: Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label, role: p.role, fields: p.fields, setupHint: p.setupHint || "" })),
    encrypted: safeStorage.isEncryptionAvailable(),
  };
}

const search = new Registry({ getText, getConfig: (id) => loadSettings().providers[id] || {} });

// ---- Search flow and AI query ideas (B09, B20, B25): core/suggest.js ----
const searchFlow = createSuggest({ registry: search, getAISettings: () => loadSettings().ai, ttl: CACHE_TTL });
const { suggest, suggestFor, aiTest, aiReset, aiState } = searchFlow;

// What keyword ranking learns while you browse (core/keywords.js): text that
// repeats on every page of a site, and words that recur across sites (your topic).
const keywordContext = new KeywordContext();

// opts.ifChanged (the 5 s timer): skip reading the page when it has not been
// scrolled, resized or had text selected since the last read of the same URL.
async function pageKeywords(id, banned = [], opts = {}) {
  const tab = tabs.get(id);
  if (tab && opts.ifChanged) {
    const url = tab.view.webContents.getURL();
    if (tab.readUrl === url && (tab.activityAt || 0) <= (tab.readAt || 0)) return { unchanged: true };
  }
  if (tab) {
    tab.readAt = Date.now();
    tab.readUrl = tab.view.webContents.getURL();
  }
  if (tab?.rule && tab.rule.suggest === false) {
    // Site rule: never read this page or send its words to a search engine.
    const wc = tab.view.webContents;
    return { disabled: true, matched: tab.rule.matched, page: { url: wc.getURL(), title: wc.getTitle() }, ranked: [] };
  }
  // The Google window placeholder has no content of its own to suggest from.
  if (tab && isInternal(tab.view.webContents.getURL())) return { disabled: true, page: tabState(tab), ranked: [] };
  const page = await extractPage(id);
  if (!page || page.error) return { page, ranked: [] };
  const res = analyzePage(page, { context: keywordContext, banned, limit: 12 });
  const info = { url: page.url, title: page.title, selection: page.selection };
  if (res.thin) {
    // Home screens, feeds, sign-in walls and bot checks: suggest from the
    // running topic instead, and record nothing for this page in the trail.
    const fallback = res.blocked ? [] : keywordContext.topic(8, banned);
    return { page: info, ranked: fallback, topic: [], thin: true, blocked: res.blocked, fromTopic: fallback.length > 0 };
  }
  // The trail records the page's own topic words, without the cross-site boost.
  const topic = analyzePage(page, { banned, limit: 6, learn: false }).ranked.map((r) => r.term);
  return { page: info, ranked: res.ranked, topic };
}

// ---- Previews: core/preview.js ----
const { preview } = createPreview({ getText });

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

function zoomTab(tab, step) {
  if (!tab) return;
  const wc = tab.view.webContents;
  const level = step === 0 ? 0 : Math.max(-5, Math.min(5, wc.getZoomLevel() + step));
  wc.setZoomLevel(level);
  emitList();
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
            // Sidebar layout: ⌘T opens the CommandBar; the tab opens from there.
            if (chromeSide) return sendUi("focus-omni", { newTab: true });
            createTab(newTabUrl());
            sendUi("focus-omni");
          },
        },
        { label: "Close Tab", accelerator: "CmdOrCtrl+W", click: () => activeId && closeTab(activeId) },
        {
          label: "Reopen Closed Tab",
          accelerator: "CmdOrCtrl+Shift+T",
          click: () => {
            const last = closedTabs.pop();
            if (last) createTab(last.url);
          },
        },
        { label: "Open Location", accelerator: "CmdOrCtrl+L", click: () => sendUi("focus-omni") },
        { label: "Bookmark This Page", accelerator: "CmdOrCtrl+D", click: () => sendUi("bookmark-toggle") },
        { label: "Bookmarks", accelerator: "CmdOrCtrl+Shift+B", click: () => sendUi("open-bookmarks") },
        { type: "separator" },
        { label: "Share Trail…", click: () => sendUi("share-trail") },
        { label: "Open Shared Trail…", click: () => chooseSharedTrail() },
        { type: "separator" },
        { label: "Screenshot Tab", accelerator: "CmdOrCtrl+Shift+S", click: () => runShotFromMain(activeId) },
        { label: "Print…", accelerator: "CmdOrCtrl+P", click: () => activeWc()?.print({}, () => {}) },
        { label: "Save Page as PDF", click: () => savePdf(activeId) },
        { label: "Reset Site Permissions", click: resetPermissions },
        { type: "separator" },
        { label: "Edit Site Rules…", click: () => shell.openPath(rulesFile()) },
        { label: "Reload Site Rules", click: () => loadRules(true) },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      role: "help",
      submenu: [
        { label: "Copy Diagnostics", click: () => clipboard.writeText(diagnostics()) },
        {
          label: "Report a Problem…",
          click: () => {
            clipboard.writeText(diagnostics());
            createTab("https://github.com/westernCasa/node_browser/issues/new?template=bug-report.yml");
            sendUi("notice", { message: "Diagnostics copied. Paste them into the issue, with what you were doing when it went wrong." });
          },
        },
        { label: "Gestures and Shortcuts Tutorial", click: () => sendUi("tour") },
        { label: "Take the Beta Survey…", click: () => createTab(require("./core/urls").SURVEY_URL) },
        { label: "Open Log Folder", click: () => shell.openPath(log().dir) },
        { type: "separator" },
        { label: "Check for Updates…", click: () => checkForUpdatesFromMenu() },
        { label: "All Releases", click: () => createTab(RELEASES) },
        { type: "separator" },
        { label: "NODE on GitHub", click: () => createTab("https://github.com/westernCasa/node_browser") },
      ],
    },
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
        { label: "Choose Tabs for Mosaic…", accelerator: "CmdOrCtrl+Shift+\\", click: () => sendUi("overview") },
        {
          label: "Loop Video: Next Minute / Stop",
          accelerator: "CmdOrCtrl+Shift+L",
          click: () => {
            const tab = tabs.get(activeId);
            if (tab) loopVideo(tab.id, tab.loop ? "stop" : "next", 60);
          },
        },
        { label: "Show or Hide Suggestions", accelerator: "CmdOrCtrl+Shift+.", click: () => sendUi("toggle-suggest") },
        { type: "separator" },
        {
          id: "sidebar-layout",
          label: "Use Sidebar Layout",
          type: "checkbox",
          checked: loadSettings().chromeLayout === "side",
          click: (item) => {
            saveSettings({ chromeLayout: item.checked ? "side" : "top" });
            sendUi("chrome-layout", { mode: item.checked ? "side" : "top" });
          },
        },
        { id: "sidebar-toggle", label: "Show or Hide Sidebar", accelerator: "CmdOrCtrl+S", click: () => sendUi("sidebar-toggle") },
        { id: "sidebar-rail", label: "Compact or Full Sidebar", click: () => sendUi("sidebar-rail") },
        { type: "separator" },
        { label: "Menu: Library, History, Settings", accelerator: "CmdOrCtrl+,", click: () => sendUi("open-menu", { section: "settings" }) },
        { type: "separator" },
        { label: "Next Tab", accelerator: "Ctrl+Tab", click: () => stepTab(1) },
        { label: "Previous Tab", accelerator: "Ctrl+Shift+Tab", click: () => stepTab(-1) },
        { label: "Next Tab ", accelerator: "CmdOrCtrl+Alt+Right", visible: false, click: () => stepTab(1) },
        { label: "Previous Tab ", accelerator: "CmdOrCtrl+Alt+Left", visible: false, click: () => stepTab(-1) },
        ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ label: `Tab ${n}`, accelerator: `CmdOrCtrl+${n}`, visible: false, click: () => pickTab(n - 1) })),
        { label: "Last Tab", accelerator: "CmdOrCtrl+9", visible: false, click: () => pickTab(-1) },
        {
          label: "Picture in Picture",
          accelerator: "CmdOrCtrl+Shift+P",
          click: async () => {
            if ((await togglePip(activeId)) === "none") sendUi("error", { message: "No video on this page for picture-in-picture." });
          },
        },
        {
          id: "sound-all",
          label: "Sound from All Playing Tabs",
          type: "checkbox",
          accelerator: "CmdOrCtrl+Shift+A",
          click: (item) => setSoundAll(item.checked),
        },
        { type: "separator" },
        { label: "Share This Tab with Agents", click: () => activeId && shareTabWithAgents(activeId, !tabs.get(activeId)?.agentShared) },
        { label: "Stop All Agents", click: () => setAgents(false) },
        { type: "separator" },
        { label: "Find in Page", accelerator: "CmdOrCtrl+F", click: () => sendUi("find-open") },
        { label: "Find Next", accelerator: "CmdOrCtrl+G", click: () => sendUi("find-step", { forward: true }) },
        { label: "Find Previous", accelerator: "CmdOrCtrl+Shift+G", click: () => sendUi("find-step", { forward: false }) },
        { type: "separator" },
        { label: "Zoom In", accelerator: "CmdOrCtrl+=", click: () => zoomTab(tabs.get(activeId), 0.5) },
        { label: "Zoom In ", accelerator: "CmdOrCtrl+Plus", visible: false, click: () => zoomTab(tabs.get(activeId), 0.5) },
        { label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: () => zoomTab(tabs.get(activeId), -0.5) },
        { label: "Actual Size", accelerator: "CmdOrCtrl+0", click: () => zoomTab(tabs.get(activeId), 0) },
        { type: "separator" },
        { label: "History", accelerator: "CmdOrCtrl+Y", click: () => sendUi("open-history") },
        {
          label: "Mute or Unmute Tab",
          accelerator: "CmdOrCtrl+Shift+U",
          click: () => {
            const tab = tabs.get(activeId);
            if (!tab) return;
            tab.audio = tab.view.webContents.isAudioMuted() ? "on" : "off";
            tab.audioByUser = true;
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
  // Window icon for Linux and Windows when run from source (installers carry their own).
  const winIcon = path.join(__dirname, "build", "icon.png");
  win = new BrowserWindow({
    ...(process.platform !== "darwin" && fs.existsSync(winIcon) ? { icon: winIcon } : {}),
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#121212",
    title: "NODE",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  // macOS three-finger swipe (when "Swipe between pages" uses three fingers).
  // Closing the window while media plays left Electron waiting forever (the
  // same problem as closing a playing tab, B36). Blank every tab first, then close.
  win.on("close", (e) => {
    if (pagesReleased) return;
    e.preventDefault();
    releasePages().then(() => win && !win.isDestroyed() && win.close());
  });
  win.on("swipe", (_e, direction) => {
    if (direction === "right") gestureNav(tabs.get(activeId), "back");
    if (direction === "left") gestureNav(tabs.get(activeId), "forward");
  });
  // Windows: mouse side buttons and keyboard Back/Forward keys.
  win.on("app-command", (_e, cmd) => {
    if (cmd === "browser-backward") gestureNav(tabs.get(activeId), "back");
    if (cmd === "browser-forward") gestureNav(tabs.get(activeId), "forward");
  });
  win.on("resize", applyLayout);
  // Title and menu bar heights for the full-screen toolbar (macOS).
  win.once("ready-to-show", measureMacBars);
  win.on("resized", measureMacBars);
  win.on("moved", measureMacBars);
  win.on("enter-full-screen", enterImmersive);
  win.on("leave-full-screen", leaveImmersive);
  win.webContents.on("console-message", (details) => {
    if (details.level === "error") log().error(`interface: ${details.message} (${details.sourceId?.split("/").pop()}:${details.lineNumber})`);
  });
  win.webContents.on("render-process-gone", (_e, d) => log().error(`interface stopped: ${d.reason}`));
  win.webContents.on("did-finish-load", () => {
    if (!tabs.size && !restoreSession()) createTab(newTabUrl());
    // Trail files opened from Finder or Explorer before the window was ready.
    uiReady = true;
    setTimeout(() => {
      outsideFiles.splice(0).forEach(openFromOutside);
      outsideLinks.splice(0).forEach(openFromProtocol);
    }, 600);
  });
}

// ---- Trail files from outside NODE (B82 step 6) ----
// Open With in Finder (macOS), a .md path on the command line (Windows "Open
// with", Linux), a file dropped on the window or on a page. A trail file opens
// the shared-trail preview; any other Markdown file opens in a tab to read.
let uiReady = false;
const outsideFiles = [];
const looksLikeMd = (f) => /\.(md|markdown)$/i.test(f || "");
function isTrailPath(file) {
  try {
    if (!looksLikeMd(file) || fs.statSync(file).size > SHARED_MAX) return false;
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(200);
    fs.readSync(fd, buf, 0, 200, 0);
    fs.closeSync(fd);
    return TrailFile.isTrailFile(buf.toString("utf8"));
  } catch (_) {
    return false;
  }
}
function openFromOutside(file) {
  if (!uiReady || !win) return outsideFiles.push(file);
  if (win.isMinimized()) win.restore();
  win.focus();
  if (isTrailPath(file)) return openSharedTrail(file);
  if (fs.existsSync(file)) createTab(require("url").pathToFileURL(file).toString());
}
app.on("open-file", (e, file) => {
  e.preventDefault();
  openFromOutside(file);
});
// noderesearch://open?link=… from the share web page's Open in NODE.
// macOS sends open-url; Windows and Linux start NODE again with the address,
// which the running copy receives as second-instance.
const PROTOCOL = "noderesearch";
const outsideLinks = [];
function openFromProtocol(address) {
  if (!uiReady || !win) return outsideLinks.push(address);
  openShareLink(address);
}
app.on("open-url", (e, address) => {
  e.preventDefault();
  openFromProtocol(address);
});
for (const arg of process.argv.slice(1)) if (arg.startsWith(`${PROTOCOL}:`)) outsideLinks.push(arg);
// One NODE at a time per profile, so links and files go to the open window.
// Test runs (their own --user-data-dir) are not affected by each other.
if (!app.requestSingleInstanceLock()) app.quit();
else
  app.on("second-instance", (_e, argv) => {
    for (const arg of argv.slice(1)) {
      if (arg.startsWith(`${PROTOCOL}:`)) openFromProtocol(arg);
      else if (looksLikeMd(arg) && path.isAbsolute(arg) && fs.existsSync(arg)) openFromOutside(arg);
    }
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
if (!app.commandLine.hasSwitch("user-data-dir")) {
  if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  else app.setAsDefaultProtocolClient(PROTOCOL);
}
for (const arg of process.argv.slice(1)) if (looksLikeMd(arg) && path.isAbsolute(arg) && fs.existsSync(arg)) outsideFiles.push(arg);
ipcMain.handle("trail:dropped", (_e, file) => {
  const f = String(file || "");
  if (!path.isAbsolute(f) || !looksLikeMd(f)) return { ok: false, error: "Drop a .trail.md file to open a shared trail." };
  if (!isTrailPath(f)) return { ok: false, error: `${path.basename(f)} is not a NODE trail file.` };
  return openSharedTrail(f);
});

protocol.registerSchemesAsPrivileged([
  { scheme: "scoutlib", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
]);

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
// Passkeys on macOS: Apple only lets signed browsers with its web-browser
// passkey entitlement use Touch ID and iCloud Keychain passkeys. Without it a
// passkey sign-in (X, GitHub, Google) waits forever. So NODE turns the passkey
// API off unless Settings says otherwise; sites then offer password sign-in.
// Read straight from settings.json: this has to happen before the app is ready.
const PASSKEYS_ON = (() => {
  if (process.platform !== "darwin") return true;
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), "utf8")).passkeys === true;
  } catch (_) {
    return false;
  }
})();
if (!PASSKEYS_ON) app.commandLine.appendSwitch("disable-blink-features", "WebAuth");
app.commandLine.appendSwitch("disable-features", "PreloadMediaEngagementData");

app.whenReady().then(() => {
  usage().touch();
  if (process.env.NODE_TEST_PLAIN_PASSWORDS === "1" && app.commandLine.hasSwitch("user-data-dir")) safeStorage.setUsePlainTextEncryption?.(true);
  protocol.handle("scoutlib", (request) => {
    try {
      // scoutlib://item/<id> (older pages used scoutlib://<id>/file).
      const u = new URL(request.url);
      const id = u.hostname === "item" ? u.pathname.replace(/^\/+/, "") : u.hostname;
      const item = readIndex().find((row) => row.id === id);
      if (!item || !fs.existsSync(item.file)) return new Response("missing", { status: 404 });
      return net.fetch(require("url").pathToFileURL(item.file).toString());
    } catch (err) {
      return new Response(String(err), { status: 400 });
    }
  });
  // Dock icon when run from source on macOS (the installed app uses its own icon).
  const dockIcon = path.join(__dirname, "build", "icon.png");
  if (process.platform === "darwin" && !app.isPackaged && app.dock && fs.existsSync(dockIcon)) app.dock.setIcon(dockIcon);
  installPermissionHandlers(session.defaultSession);
  // Ad and tracker blocking (adblock.js): on unless turned off in Settings or by a site rule.
  adblock = createAdblock({
    userData: app.getPath("userData"),
    ipcMain,
    cookieNotices: () => loadSettings().adblockCookies === true,
    fetch: (...args) => globalThis.fetch(...args),
    isEnabled: () => loadSettings().adblock !== false,
    // A blocked request updates the toolbar count (B73), at most twice a second.
    onBlocked: (wcId) => {
      const tab = [...tabs.values()].find((t) => t.view.webContents.id === wcId);
      if (!tab || tab.id !== activeId || blockedEmitTimer) return;
      blockedEmitTimer = setTimeout(() => {
        blockedEmitTimer = null;
        emitList();
      }, 500);
    },
    isAllowedFor: (wcId) => {
      for (const tab of tabs.values()) if (tab.view.webContents.id === wcId) return tab.rule?.adblock !== false;
      return true;
    },
    // On-page hiding runs only in tabs, never in NODE's own window (B77).
    isPage: (wcId) => [...tabs.values()].some((tab) => tab.view.webContents.id === wcId),
  });
  adblock.install(session.defaultSession);
  watchDownloads(session.defaultSession);
  adblock.load();
  loadRules();
  watchRules();
  updater = createUpdater({ app, log: log(), notify: (m) => sendUi("update-ready", m), isEnabled: () => loadSettings().autoUpdate !== false });
  updater.start();
  log().info(`NODE ${app.getVersion()} started (Electron ${process.versions.electron}, ${process.platform} ${process.arch})`);
  research = new ResearchStore(fsStorage(path.join(app.getPath("userData"), "sessions")));
  historyStore = new HistoryStore(fsStorage(app.getPath("userData")));
  companion = createCompanion({
    userData: app.getPath("userData"),
    getSettings: () => ({ browser: loadSettings().google.browser, autoplay: ruleFor("https://www.google.com/").autoplay }),
    getBounds: () => (win && !win.isDestroyed() ? win.getBounds() : null),
    onVisit: (url, title) => historyStore.record(url, title),
    onChange: (st) => sendUi("google-window-status", st),
  });
  global.nodeCompanion = companion; // for the e2e tests
  global.nodeTest = {
  claudeDesktopEntry, sleepIdleTabs,
  setTrailSavePath: (p) => (trailSavePath = p),
  openSharedTrail, openFromOutside, openShareLink,
  setPasswordAsk: (answer) => (passwordAsk = async (opts) => ((global.nodeTest.lastPasswordAsk = opts), answer)),
  loginMenu: (id) => loginMenuItems(tabs.get(id)).map((i) => i.label),
  setPasswordAuth: (answer) => ((passwordAuth = async () => answer), (passwordAuthUntil = 0)),
  importPasswords,
  fillLogin: (id, n = 0) => {
    const tab = tabs.get(id);
    const origin = passwordPageOrigin(tab);
    const l = origin && passwords().forOrigin(origin)[n];
    return l ? fillLogin(tab, l.id) : false;
  }, contextMenuItems: async (id, p) => contextMenuItems(tabs.get(id), p, { video: p.mediaType === "video" || (await pageHasVideo(tabs.get(id))) }).map((i) => i.label || i.role || "-"), savePdf, closedTabs };
  initAgents();
  bookmarkStore = new BookmarkStore(fsStorage(app.getPath("userData")));
  buildMenu();
  createWindow();
});

app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  usageStore?.saveNow();
  companion?.stop();
  agentServer?.stop();
});

// No address (the + button, double-click on the tab bar): a new tab page.
ipcMain.handle("tab:create", (_e, url) => {
  if (url && isShareLink(url)) return void openShareLink(url);
  const id = createTab(url ? url : newTabUrl());
  // Top bar: the cursor goes to the address bar. Sidebar: the blank tab was
  // asked for from the CommandBar, which has just closed.
  if (!url && !chromeSide) sendUi("focus-omni");
  return id;
});
ipcMain.handle("tab:close", (_e, id) => closeTab(id));
ipcMain.handle("tab:activate", (_e, id) => activateTab(id));
ipcMain.handle("tab:navigate", (_e, id, url) => {
  const tab = tabs.get(id);
  if (!tab) return;
  if (isShareLink(url)) return void openShareLink(url);
  tab.sleeping = null;
  tab.view.webContents.loadURL(loadTarget(url, id));
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
ipcMain.handle("layout:set", (_e, mode) => setLayoutMode(mode));
function setLayoutMode(mode, { tell = false } = {}) {
  const before = layout;
  layout = mode === "mosaic" ? "mosaic" : "focus";
  // Into Mosaic from a tab that has no tile: the first chosen tile becomes active.
  const ids = layout === "mosaic" ? mosaicIds() : [];
  if (ids.length && !ids.includes(activeId)) {
    activeId = ids[0];
    wakeTab(tabs.get(activeId));
    emitList();
  }
  if (layout === "mosaic" && before !== "mosaic") usage().count("mosaic");
  applyLayout(layout !== before ? { animate: layout === "mosaic" ? "enter" : "exit" } : {});
  if (tell && layout !== before) sendUi("layout", { mode: layout });
  if (layout !== before) emitList();
  return layout;
}
// Mosaic → Focus on one tile (pinch out on it, or ⌘1 to ⌘4).
function focusTile(id) {
  if (!tabs.has(id)) return;
  activeId = id;
  wakeTab(tabs.get(id));
  tabs.get(id).lastActive = Date.now();
  tabs.get(id).idleMs = 0;
  emitList();
  setLayoutMode("focus", { tell: true });
}

// ---- Pinch (B72) ----
// view-preload.js sends trackpad pinches (not Ctrl + mouse wheel) as scale
// steps. Like Safari: in Focus, pinching out zooms the page; pinching in
// zooms the page back to 100%, and from 100% on to Mosaic. In Mosaic, pinch
// in opens the tab overview and pinch out focuses the tile under the fingers.
// One gesture changes one level.
const PINCH_IN = 0.82;
const PINCH_OUT = 1.22;
let pinchG = null;
function onPinch(tab, factor) {
  const f = Math.max(0.5, Math.min(2, Number(factor) || 1));
  if (!pinchG || pinchG.id !== tab.id) {
    const zoomed = tab.view.webContents.getZoomFactor() > 1.01;
    const mode = layout === "mosaic" && !libraryOpen ? "level" : zoomed || f > 1 ? "page" : "level";
    pinchG = { id: tab.id, mode, acc: 1, fired: false };
  }
  clearTimeout(pinchG.timer);
  pinchG.timer = setTimeout(() => (pinchG = null), 260);
  if (pinchG.mode === "page") {
    const wc = tab.view.webContents;
    wc.setZoomFactor(Math.max(1, Math.min(3, wc.getZoomFactor() * f)));
    clearTimeout(pinchG.emit);
    pinchG.emit = setTimeout(emitList, 120);
    return;
  }
  if (pinchG.fired) return;
  pinchG.acc *= f;
  if (pinchG.acc < PINCH_IN) {
    pinchG.fired = true;
    if (layout === "mosaic") sendUi("overview");
    else setLayoutMode("mosaic", { tell: true });
  } else if (pinchG.acc > PINCH_OUT && layout === "mosaic") {
    pinchG.fired = true;
    focusTile(tab.id);
  }
}
// Messages from the page script (view-preload.js) name their tab by the
// webContents that sent them, never by the id the script read from its
// process: Chromium can host frames of one site from several tabs in one
// process (a captcha frame, for example), so that id can be another tab's.
const senderTab = (e) => tabOfContents(e.sender);
ipcMain.on("tab:pinch", (e, _id, factor) => {
  const tab = senderTab(e);
  if (tab && !libraryOpen) onPinch(tab, factor);
});
ipcMain.handle("layout:chrome", (_e, { mode, left } = {}) => {
  const side = mode === "side";
  chromeLeft = side ? Math.max(0, Math.min(400, Math.round(Number(left) || 0))) : 0;
  if (side !== chromeSide) {
    chromeSide = side;
    // Switched while in full screen: the top bar slides; the sidebar stays.
    if (win?.isFullScreen()) {
      if (side && immersive) leaveImmersive();
      else if (!side && !immersive) enterImmersive();
    }
    const item = Menu.getApplicationMenu()?.getMenuItemById("sidebar-layout");
    if (item) item.checked = side;
  }
  applyLayout();
  return { side: chromeSide, left: chromeLeft };
});
ipcMain.handle("layout:sidebar", (_e, w) => {
  sidebarWidth = Math.max(160, Math.min(360, Number(w) || SIDEBAR_DEFAULT));
  applyLayout();
});
// Space the suggestions widget takes on the right; 0 when it is collapsed.
// opts.animate "open" | "close" (motion 10): the page widens or narrows on
// the same curve as the widget sliding in or out (renderer/styles.css .rail):
// opening --motion-base with --ease-enter, closing --motion-fast with
// --ease-exit. The page is resized on every step, as in Safari's sidebar.
ipcMain.handle("layout:panel", (_e, w, opts = {}) => {
  const attached = () => [...tabs.values()].filter((t) => t.attached);
  const before = new Map(attached().map((t) => [t, t.view.getBounds()]));
  sidebarWidth = Math.max(0, Math.min(PANEL_MAX, Math.round(Number(w) || 0)));
  applyLayout();
  const anim = opts.animate === "open" || opts.animate === "close" ? opts.animate : null;
  if (!anim || systemPreferences.getAnimationSettings().prefersReducedMotion || htmlFullId) return sidebarWidth;
  const items = attached()
    .filter((t) => before.has(t))
    .map((t) => ({ view: t.view, from: before.get(t), to: t.view.getBounds() }))
    .filter(({ from, to }) => from.x !== to.x || from.width !== to.width);
  if (!items.length) return sidebarWidth;
  for (const { view, from } of items) view.setBounds(from);
  slideViews(items, anim === "open" ? MOTION_BASE : MOTION_FAST, anim === "open" ? EASE_ENTER : EASE_EXIT);
  return sidebarWidth;
});
// opts.snapshot: also return pictures of the visible pages, taken before they
// are hidden, so the overlay menu can show them dimmed behind it.
ipcMain.handle("layout:library", async (_e, open, opts = {}) => {
  const shots = [];
  if (open && opts.snapshot && !libraryOpen) {
    for (const tab of tabs.values()) {
      if (!tab.attached) continue;
      try {
        const img = await tab.view.webContents.capturePage();
        if (!img.isEmpty()) shots.push({ src: "data:image/jpeg;base64," + img.toJPEG(70).toString("base64"), rect: tab.view.getBounds() });
      } catch (_) {}
    }
  }
  libraryOpen = Boolean(open);
  applyLayout();
  return opts.snapshot ? { open: libraryOpen, shots } : libraryOpen;
});
ipcMain.handle("window:fullscreen", (_e, on) => {
  if (!win) return false;
  win.setFullScreen(on == null ? !win.isFullScreen() : Boolean(on));
  return win.isFullScreen();
});
// Full-screen toolbar layer: the window sends a copy of its toolbar; the
// layer sends clicks and typing back, and holds the toolbar while a field
// has focus. The window asks the layer to focus a field (Cmd+L, Cmd+F).
ipcMain.on("chrome:mirror", (e, m) => {
  if (e.sender !== win?.webContents || !m || typeof m.html !== "string") return;
  if (lastMirror?.sprite && !m.sprite) m.sprite = lastMirror.sprite;
  lastMirror = m;
  if (overlay && !overlay.webContents.isDestroyed()) overlay.webContents.send("overlay:mirror", m);
});
ipcMain.on("overlay:event", (e, msg) => {
  if (!overlay || e.sender !== overlay.webContents || !msg || !Array.isArray(msg.path)) return;
  sendUi("overlay-event", { event: msg });
});
ipcMain.on("overlay:hold", (e, on) => {
  if (!overlay || e.sender !== overlay.webContents) return;
  overlayHold = Boolean(on);
  if (overlayHold && immersive && !chromeShown) setChromeShown(true);
});
ipcMain.on("chrome:focus-overlay", (e, fieldPath) => {
  if (e.sender !== win?.webContents || !immersive || htmlFullId || !Array.isArray(fieldPath)) return;
  overlayHold = true; // until the layer reports the field lost focus
  if (!chromeShown) setChromeShown(true);
  else showOverlay(true);
  overlay.webContents.focus();
  overlay.webContents.send("overlay:focus", fieldPath);
});
// The renderer keeps the toolbar on screen in full screen while it is in use.
ipcMain.on("chrome:hold", (_e, on) => {
  chromeHold = Boolean(on);
  if (chromeHold && immersive && !chromeShown) setChromeShown(true);
});
// Ads and trackers blocked on this page (B73): a native menu under the
// toolbar shield, with the sites blocked most, the on/off switch, and what
// NODE sends.
const PRIVACY_DOC = "https://github.com/westernCasa/node_browser#what-node-sends";
ipcMain.handle("menu:privacy", (_e, x, y) => {
  const tab = tabs.get(activeId);
  if (!win || !tab) return;
  const wc = tab.view.webContents;
  const on = loadSettings().adblock !== false;
  const n = adblock ? adblock.blockedIn(wc.id) : 0;
  const items = [];
  if (!on) items.push({ label: "Ad and tracker blocking is off", enabled: false });
  else if (tab.rule?.adblock === false) items.push({ label: "Not blocking on this site (site rule)", enabled: false });
  else if (adblock && !/^ready/.test(adblock.stats().status)) items.push({ label: `Block lists: ${adblock.stats().status}`, enabled: false });
  else {
    items.push({ label: n === 1 ? "1 ad or tracker blocked on this page" : `${n} ads and trackers blocked on this page`, enabled: false });
    for (const h of adblock.topHosts(wc.id)) items.push({ label: `${h.host}  ·  ${h.count}`, enabled: false });
  }
  items.push(
    { type: "separator" },
    {
      label: "Block Ads and Trackers",
      type: "checkbox",
      checked: on,
      click: () => {
        saveSettings({ adblock: !on });
        emitList();
        sendUi("notice", { message: on ? "Ad and tracker blocking is off. Pages reload with ads." : "Ad and tracker blocking is on." });
        wc.reload();
      },
    },
    { type: "separator" },
    {
      label: "Also Hide Cookie Notices",
      type: "checkbox",
      checked: loadSettings().adblockCookies === true,
      enabled: on,
      click: () => {
        saveSettings({ adblockCookies: loadSettings().adblockCookies !== true });
        setTimeout(() => wc.reload(), 1500);
      },
    },
    { label: "Uses uBlock Origin's Default Filter Lists", enabled: false },
    { type: "separator" },
    { label: "What NODE Sends…", click: () => createTab(PRIVACY_DOC) }
  );
  popupHold = true;
  Menu.buildFromTemplate(items).popup({ window: win, x: Math.round(x), y: Math.round(y), callback: () => (popupHold = false) });
});

// Capture tools in one native menu under the toolbar button: a native menu
// draws over the page views, an HTML menu would be hidden behind them.
ipcMain.handle("menu:capture", (_e, x, y) => {
  if (!win) return;
  const pick = (action) => () => sendUi("capture", { action });
  const menu = Menu.buildFromTemplate([
    { label: "Screenshot", accelerator: "CmdOrCtrl+Shift+S", registerAccelerator: false, click: pick("shot") },
    { label: "Save Page", click: pick("save") },
    { label: "Save Media", click: pick("media") },
    { type: "separator" },
    { label: "Picture in Picture", accelerator: "CmdOrCtrl+Shift+P", registerAccelerator: false, click: pick("pip") },
    { label: "Loop Section", submenu: loopMenu(activeId) },
  ]);
  popupHold = true;
  menu.popup({ window: win, x: Math.round(x), y: Math.round(y), callback: () => (popupHold = false) });
});
// Choose a tab for Mosaic, or take it out (B69). Returns false when Mosaic is full.
function setTile(id, on) {
  const tab = tabs.get(String(id));
  if (!tab) return false;
  on = Boolean(on);
  if (on && !tab.tile && mosaicMax() && chosenTiles() >= mosaicMax()) {
    sendUi("notice", { message: `Mosaic holds ${mosaicMax()} tabs. Remove one first, or change the number in Settings → Tabs.` });
    return false;
  }
  tab.tile = on;
  // In Mosaic, choosing tiles keeps Mosaic on: if the current tab lost its
  // tile, the first chosen tile becomes the current tab.
  const ids = layout === "mosaic" ? mosaicIds() : [];
  if (ids.length && !ids.includes(activeId)) {
    activeId = ids[0];
    wakeTab(tabs.get(activeId));
  }
  applyLayout(layout === "mosaic" ? { animate: "move" } : {});
  emitList();
  saveSessionSoon();
  return true;
}
ipcMain.handle("tab:tile", (_e, id, on) => setTile(id, on));

// ---- Gestures tutorial (B72) ----
// Practice pages bundled with NODE (renderer/tutorial/). The tutorial opens
// them as Mosaic tiles, and puts back the user's tabs, tiles and layout after.
let tourSaved = null;
const TOUR_PAGES = ["levain.html", "yeast.html", "batard.html", "rye.html"];
function tourUrl(name) {
  return `file://${path.join(__dirname, "renderer", "tutorial", name).split(path.sep).join("/")}`;
}
ipcMain.handle("tour:start", () => {
  if (!win) return null;
  if (!tourSaved) tourSaved = { active: activeId, layout, tiles: [...tabs.values()].filter((t) => t.tile).map((t) => t.id), ids: [] };
  for (const id of tourSaved.ids) if (tabs.has(id)) closeTab(id);
  for (const t of tabs.values()) t.tile = false;
  tourSaved.ids = TOUR_PAGES.map((name) => createTab(tourUrl(name), { background: true, tile: true }));
  activeId = tourSaved.ids[0];
  wakeTab(tabs.get(activeId));
  setLayoutMode("focus", { tell: true });
  emitList();
  return { ids: tourSaved.ids, video: tourSaved.ids[2] };
});
ipcMain.handle("tour:end", () => {
  const saved = tourSaved;
  tourSaved = null;
  if (!saved) return;
  for (const id of saved.ids) if (tabs.has(id)) closeTab(id);
  for (const t of tabs.values()) t.tile = saved.tiles.includes(t.id);
  if (saved.active && tabs.has(saved.active)) activeId = saved.active;
  wakeTab(tabs.get(activeId));
  setLayoutMode(saved.layout, { tell: true });
  emitList();
});
ipcMain.handle("layout:coach", (_e, h) => {
  coachHeight = Math.max(0, Math.min(240, Math.round(Number(h) || 0)));
  applyLayout();
});
// The tutorial offers itself once, after an update or after first-run setup.
// Test runs (--user-data-dir) skip it unless NODE_TOUR=1.
ipcMain.handle("tour:auto", () => !app.commandLine.hasSwitch("user-data-dir") || process.env.NODE_TOUR === "1");

// ---- Tab overview (B71): zoom out to every tab and pick the Mosaic tiles ----
// Pictures of tabs that are not on screen come from tab.thumb, taken when a
// tab leaves the screen; tabs on screen are pictured when the overview opens.
async function thumbOf(tab) {
  try {
    const img = await tab.view.webContents.capturePage();
    if (!img.isEmpty()) {
      const size = img.getSize();
      tab.thumb = "data:image/jpeg;base64," + img.resize({ width: Math.min(640, size.width) }).toJPEG(72).toString("base64");
    }
  } catch (_) {}
  return tab.thumb || "";
}
ipcMain.handle("overview:open", async () => {
  const rect = contentRect();
  const out = [];
  for (const tab of shownTabs()) {
    const thumb = tab.attached && !tab.sleeping ? await thumbOf(tab) : tab.thumb || "";
    out.push({ ...tabState(tab), thumb, rect: tab.attached ? tab.view.getBounds() : null });
  }
  libraryOpen = true; // hide the page views under the overview
  applyLayout();
  return { tabs: out, activeId, layout, max: mosaicMax(), page: rect };
});
// ids: the tabs picked, in tab-strip order. None picked: Mosaic shows its usual tabs.
ipcMain.handle("overview:close", (_e, ids) => {
  if (Array.isArray(ids)) {
    const pick = new Set(ids.map(String));
    const max = mosaicMax() || Infinity;
    let n = 0;
    for (const t of shownTabs()) t.tile = pick.has(t.id) && n++ < max;
    layout = "mosaic";
    const shown = mosaicIds();
    if (shown.length && !shown.includes(activeId)) activeId = shown[0];
    wakeTab(tabs.get(activeId));
    usage().count("mosaic");
    saveSessionSoon();
  }
  libraryOpen = false;
  applyLayout();
  sendUi("layout", { mode: layout });
  emitList();
  return layout;
});
// Right-click on a tab in the tab strip: a native menu, so it draws over the pages.
ipcMain.handle("tab:menu", (_e, id, x, y) => {
  const tab = tabs.get(String(id));
  if (!win || !tab) return;
  const chosen = chosenTiles();
  const full = !tab.tile && mosaicMax() && chosen >= mosaicMax();
  const items = [
    tab.tile
      ? { label: "Remove from Mosaic", click: () => setTile(tab.id, false) }
      : { label: full ? `Show in Mosaic (full: ${mosaicMax()} tabs)` : "Show in Mosaic", enabled: !full, click: () => setTile(tab.id, true) },
  ];
  if (chosen) {
    items.push({
      label: "Show All Tabs in Mosaic",
      click: () => {
        for (const t of shownTabs()) t.tile = false;
        applyLayout(layout === "mosaic" ? { animate: "move" } : {});
        emitList();
        saveSessionSoon();
      },
    });
  }
  items.push({ label: "Choose Tabs for Mosaic…", click: () => sendUi("overview") });
  items.push({ type: "separator" }, { label: "Close Tab", click: () => closeTab(tab.id) });
  popupHold = true;
  Menu.buildFromTemplate(items).popup({ window: win, x: Math.round(x), y: Math.round(y), callback: () => (popupHold = false) });
});
ipcMain.on("tab:activity", (e) => {
  const tab = senderTab(e);
  if (tab) tab.activityAt = Date.now();
});
ipcMain.on("tab:clicked", (e) => {
  const tab = senderTab(e);
  if (!tab) return;
  tab.lastGesture = Date.now();
  if (activeId !== tab.id) activateTab(tab.id);
});
// Plain-key shortcuts pressed inside a web page (sent by view-preload.js only
// when focus is not in a text field).
// Picture-in-picture for the active tab's main video. Tries the page itself,
// then embedded players (YouTube and similar iframes). Runs as a user gesture,
// which browsers require before opening picture-in-picture.
async function togglePip(id) {
  const tab = tabs.get(id || activeId);
  if (!tab) return "none";
  const wc = tab.view.webContents;
  let frames = [];
  try {
    frames = wc.mainFrame.framesInSubtree;
  } catch (_) {}
  for (const f of frames) {
    try {
      const r = await f.executeJavaScript(pipScript(), true);
      if (r && r !== "none") return r;
    } catch (_) {}
  }
  return "none";
}
ipcMain.handle("tab:pip", (_e, id) => togglePip(id));

// ---- Loop a section of a video (B70) ----
// Runs in every frame until one has a video (embedded players included).
function clock(t) {
  t = Math.max(0, Math.floor(Number(t) || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
async function loopVideo(id, op, secs) {
  const tab = tabs.get(id || activeId);
  if (!tab || tab.sleeping) return null;
  const wc = tab.view.webContents;
  let frames = [];
  try {
    frames = wc.mainFrame.framesInSubtree;
  } catch (_) {}
  let result = "none";
  for (const f of frames) {
    try {
      const r = await f.executeJavaScript(loopScript(op, secs), true);
      if (r && r !== "none") {
        result = r;
        break;
      }
    } catch (_) {}
  }
  if (result === "none") {
    if (op !== "get" && op !== "stop") sendUi("notice", { message: "No video to loop on this page. Start the video first." });
    return null;
  }
  if (result.stopped) {
    tab.loop = null;
    sendUi("notice", { message: "Stopped looping." });
  } else {
    tab.loop = { a: result.a, b: result.b, url: wc.getURL().split("#")[0] };
    if (op !== "get") sendUi("notice", { message: `Looping ${clock(result.a)} to ${clock(result.b)} in this tab. To stop, click ↻ on the tab or press ${process.platform === "darwin" ? "⌘⇧L" : "Ctrl+Shift+L"}.` });
  }
  emitList();
  return tab.loop;
}
ipcMain.handle("tab:loop", (_e, id, op, secs) => loopVideo(id, op, secs));
function loopMenu(id) {
  const tab = tabs.get(id || activeId);
  const run = (op, secs) => () => loopVideo(tab?.id, op, secs);
  return [
    { label: "Loop the Next 30 Seconds", click: run("next", 30) },
    { label: "Loop the Next Minute", click: run("next", 60) },
    { label: "Loop the Next 5 Minutes", click: run("next", 300) },
    { type: "separator" },
    { label: "Start Loop Here", click: run("start", 60) },
    { label: "End Loop Here", click: run("end", 60) },
    { type: "separator" },
    { label: "Stop Looping", enabled: Boolean(tab?.loop), click: run("stop") },
  ];
}

// Ask AI about the current page (core/chat.js). Sends the page's readable text,
// title and address to the model the user set up under Settings → AI.
ipcMain.handle("ai:ask", async (_e, id, question, history) => {
  const tab = tabs.get(id || activeId);
  if (!tab) return { ok: false, error: "No page open." };
  const ai = loadSettings().ai;
  if (!Chat.canChat(ai)) return { ok: false, error: "Set up a model first under Settings → AI: a local model (Ollama or LM Studio) or a Grok API key." };
  usage().count("agentRuns");
  let page;
  try {
    page = await runInPage(tab.view.webContents, readableTextScript(Chat.PAGE_CHARS), true);
  } catch (err) {
    return { ok: false, error: "Could not read the page: " + String(err.message || err) };
  }
  try {
    const answer = await Chat.askPage({ question, page, history }, ai, { fetch: (...a) => globalThis.fetch(...a) });
    usage().count("askQuestions");
    return { ok: true, answer, url: page.url, chars: page.text.length };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});
// ---- Ask AI across several pages (B49) ----
// "mosaic": the tabs Mosaic shows. "session": the pages of the research
// session read most recently (open tabs are read as they are; the others are
// read logged out). Sign-in, account and payment pages are never sent.
const ASK_SESSION_PAGES = 8;
async function readTabSource(tab) {
  const wc = tab.view.webContents;
  if (tab.sleeping) return agentTools ? agentTools.readText(tab.sleeping.url) : null;
  const page = await runInPage(wc, readableTextScript(Chat.PAGE_CHARS), true);
  return { title: page.title || wc.getTitle(), url: page.url || wc.getURL(), text: page.text || "" };
}
async function askSourcesFor(scope) {
  const out = [];
  const usable = (url) => /^https?:/i.test(url || "") && !isSensitiveUrl(url) && !isPlaceholder(url);
  if (scope === "mosaic") {
    for (const id of mosaicIds()) {
      const tab = tabs.get(id);
      const url = tab?.sleeping ? tab.sleeping.url : tab?.view.webContents.getURL();
      if (!tab || !usable(url)) continue;
      try {
        const src = await readTabSource(tab);
        if (src) out.push(src);
      } catch (_) {}
    }
  } else {
    const trail = (research?.snapshot().trail || []).filter((r) => usable(r.url)).sort((a, b) => b.lastAt - a.lastAt).slice(0, ASK_SESSION_PAGES);
    for (const row of trail) {
      const open = [...tabs.values()].find((t) => !t.sleeping && t.view.webContents.getURL() === row.url);
      try {
        const src = open ? await readTabSource(open) : agentTools ? await agentTools.readText(row.url) : null;
        if (src) out.push({ ...src, title: src.title || row.title });
      } catch (_) {}
    }
  }
  return out.slice(0, Chat.MAX_SOURCES);
}
const sourceList = (sources) => sources.map((s, i) => ({ n: i + 1, title: s.title || s.url, url: s.url }));
ipcMain.handle("ai:ask-scope", async (_e, scope, question, history) => {
  const ai = loadSettings().ai;
  if (!Chat.canChat(ai)) return { ok: false, error: "Set up a model first in Settings → AI: a local model (Ollama or LM Studio) or a Grok API key." };
  const sources = await askSourcesFor(scope === "session" ? "session" : "mosaic");
  if (!sources.length) return { ok: false, error: scope === "session" ? "This research session has no pages yet. Read a few pages first." : "No pages in Mosaic to read." };
  try {
    const answer = await Chat.askSources({ question, sources, history }, ai, { fetch: (...a) => globalThis.fetch(...a) });
    usage().count("askQuestions");
    return { ok: true, answer, sources: sourceList(sources), cited: Chat.citations(answer, sources.length) };
  } catch (err) {
    return { ok: false, error: String(err.message || err), sources: sourceList(sources) };
  }
});
// A cited summary of the research session, saved to the Library and the session.
ipcMain.handle("ai:summarize-session", async () => {
  const ai = loadSettings().ai;
  if (!Chat.canChat(ai)) return { ok: false, error: "Set up a model first in Settings → AI: a local model (Ollama or LM Studio) or a Grok API key." };
  const sources = await askSourcesFor("session");
  if (!sources.length) return { ok: false, error: "This research session has no pages yet. Read a few pages first." };
  try {
    const name = research?.snapshot().name || "Research session";
    const summary = await Chat.summarizeSources({ name, sources }, ai, { fetch: (...a) => globalThis.fetch(...a) });
    const file = stamp("summary", "md");
    fs.writeFileSync(path.join(libraryRoot(), "saves", file), summary);
    addRecord("saves", file, "", `Session summary: ${name}`);
    research.addReport({ question: "Session summary", file, sources: sources.map((s) => s.url) });
    usage().count("askQuestions");
    return { ok: true, summary, file, sources: sourceList(sources) };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});
ipcMain.handle("ai:chat-info", () => {
  const ai = loadSettings().ai;
  return { ready: Chat.canChat(ai), provider: ai.provider, model: AI.endpoint(ai).model };
});

// Gestures (view-preload.js): trackpad swipe and mouse side buttons.
function gestureNav(tab, dir) {
  const wc = tab?.view.webContents;
  if (!wc || wc.isDestroyed()) return;
  if (dir === "back" && wc.canGoBack()) wc.goBack();
  if (dir === "forward" && wc.canGoForward()) wc.goForward();
}
// Tab order after dragging a tab in the tab bar.
ipcMain.handle("tab:order", (_e, order) => {
  // The order of the tabs shown (the current trail's); other trails' tabs keep theirs.
  const shown = shownTabs();
  if (!Array.isArray(order) || order.length !== shown.length || !order.every((id) => shown.some((t) => t.id === String(id)))) return;
  const moved = order.map((id) => [String(id), tabs.get(String(id))]);
  const others = [...tabs].filter(([, t]) => !inCurrentTrail(t));
  tabs.clear();
  for (const [id, tab] of [...moved, ...others]) tabs.set(id, tab);
  applyLayout();
  emitList();
});
ipcMain.handle("open-external", (_e, url) => {
  if (/^https:\/\//i.test(String(url))) shell.openExternal(String(url));
});
ipcMain.on("tab:gesture", (e, _id, dir) => gestureNav(senderTab(e), dir));

ipcMain.on("tab:hotkey", (e, _id, key) => {
  const tab = senderTab(e);
  if (key === "shot" && tab) runShotFromMain(tab.id);
});
ipcMain.handle("tab:audio", (_e, id) => {
  const tab = tabs.get(id);
  if (!tab) return null;
  tab.audio = tab.view.webContents.isAudioMuted() ? "on" : "off";
  tab.audioByUser = true;
  applyAudio();
  emitList();
  return tab.audio;
});
ipcMain.handle("audio:all", (_e, on) => setSoundAll(on));
ipcMain.handle("tab:audio-reset", (_e, id) => {
  const tab = tabs.get(id);
  if (!tab) return null;
  tab.audioByUser = false;
  tab.audio = tab.rule?.sound || "auto";
  applyAudio();
  emitList();
  return tab.audio;
});
ipcMain.handle("page:extract", (_e, id) => extractPage(id));
ipcMain.handle("suggest:search", (_e, keywords, excludeUrl) => suggest(keywords, excludeUrl));
ipcMain.handle("suggest:for", (_e, payload) => suggestFor(payload));
ipcMain.handle("settings:get", () => publicSettings());
ipcMain.handle("ai:test", (_e, draft) => aiTest(draft));
ipcMain.handle("find:start", (_e, id, text, opts = {}) => {
  const wc = tabs.get(id)?.view.webContents;
  if (!wc || !text) return null;
  // Electron's findNext means "start a new search session", so it is the
  // opposite of our "step to the next match" flag.
  return wc.findInPage(String(text), { forward: opts.forward !== false, findNext: !opts.findNext });
});
ipcMain.handle("find:stop", (_e, id) => tabs.get(id)?.view.webContents.stopFindInPage("keepSelection"));
ipcMain.handle("tab:zoom", (_e, id, step) => zoomTab(tabs.get(id), Number(step) || 0));
ipcMain.handle("history:search", (_e, q, limit) => historyStore.search(q, limit));
// Bookmarks (core/bookmarks.js).
ipcMain.handle("bookmarks:search", (_e, q, limit) => bookmarkStore.search(q, limit));
ipcMain.handle("bookmarks:has", (_e, url) => bookmarkStore.has(url));
ipcMain.handle("bookmarks:toggle", (_e, url, title) => bookmarkStore.toggle(url, title));
ipcMain.handle("bookmarks:remove", (_e, url) => {
  bookmarkStore.remove(url);
  return true;
});
ipcMain.handle("history:clear", () => {
  historyStore.clear();
  return true;
});
ipcMain.handle("history:remove", (_e, url) => {
  historyStore.remove(url);
  return true;
});
ipcMain.handle("rules:edit", () => shell.openPath(rulesFile()));
// Visual rules editor (B28): the rules as written in the file, and saving a
// whole new list. A list with problems is not saved; the problems come back.
ipcMain.handle("rules:get", () => {
  let data = null;
  try {
    data = JSON.parse(fs.readFileSync(rulesFile(), "utf8"));
  } catch (err) {
    return { rules: [], errors: [`rules.json could not be read: ${err.message}`], unreadable: true };
  }
  return { rules: Array.isArray(data.rules) ? data.rules : [], errors: rulesErrors };
});
ipcMain.handle("rules:save", (_e, list) => {
  const { errors } = Rules.validate({ rules: list });
  if (errors.length) return { ok: false, errors };
  let help = Rules.DEFAULT_FILE._help;
  try {
    help = JSON.parse(fs.readFileSync(rulesFile(), "utf8"))._help || help;
  } catch (_) {}
  fs.writeFileSync(rulesFile(), JSON.stringify({ _help: help, rules: list }, null, 2));
  loadRules(false);
  return { ok: true, count: siteRules.length, errors: rulesErrors };
});
ipcMain.handle("rules:host", () => {
  const tab = tabs.get(activeId);
  const url = tab ? tabState(tab).url : "";
  return /^https?:/i.test(url) ? hostOf(url).replace(/^www\./, "") : "";
});
ipcMain.handle("rules:reload", () => {
  loadRules(true);
  return { count: siteRules.length, errors: rulesErrors };
});
ipcMain.handle("settings:set", async (_e, next) => {
  const before = loadSettings().agents.port;
  const out = saveSettings(next);
  // A new port takes effect by restarting a running server.
  if (agentServer?.status().running && loadSettings().agents.port !== before) {
    agentServer.stop();
    await agentServer.start();
    pushAgents();
  }
  return publicSettings();
});
ipcMain.handle("agents:status", () => agentsStatus());
ipcMain.handle("agents:claude-desktop", (_e, mode) => {
  if (mode === "add") return addToClaudeDesktop();
  return { file: claudeDesktopFile(), config: JSON.stringify({ mcpServers: { node: claudeDesktopEntry() } }, null, 2) };
});
ipcMain.handle("diag:copy", () => {
  const text = diagnostics();
  clipboard.writeText(text);
  return text;
});
ipcMain.handle("diag:open-folder", () => shell.openPath(log().dir));
ipcMain.handle("update:check", () => updater.check(true));
ipcMain.handle("update:install", () => updater.installNow());
ipcMain.handle("update:releases", () => createTab(RELEASES));
ipcMain.handle("downloads:list", () => downloads.slice(-50).reverse().map(downloadState));
ipcMain.handle("downloads:cancel", (_e, id) => downloads.find((d) => d.id === id)?.item?.cancel());
ipcMain.handle("downloads:open", (_e, id) => {
  const d = downloads.find((x) => x.id === id);
  if (d?.state === "completed" && fs.existsSync(d.file)) return shell.openPath(d.file);
});
ipcMain.handle("downloads:show", (_e, id) => {
  const d = downloads.find((x) => x.id === id);
  if (d && fs.existsSync(d.file)) shell.showItemInFolder(d.file);
});
ipcMain.handle("downloads:clear", () => {
  for (let i = downloads.length - 1; i >= 0; i--) if (downloads[i].state !== "progressing") downloads.splice(i, 1);
  return [];
});

// Talk (social layer stage 1, core/talk.js): existing discussion of the page.
// Called only while the Talk pane is open.
ipcMain.handle("talk:get", async (_e, id) => {
  usage().count("talk");
  const tab = tabs.get(id || activeId);
  if (!tab) return { off: "No page open.", hn: [], bluesky: [], errors: {} };
  const raw = tab.view.webContents.getURL();
  if (isPlaceholder(raw)) return { off: "This page is open in the Google window.", hn: [], bluesky: [], errors: {} };
  const getJson = async (url) => {
    const r = await getText(url, { headers: { Accept: "application/json" }, timeout: 8000 });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return JSON.parse(r.text);
  };
  return Talk.discussions(raw, { getJson, rule: ruleFor(raw) });
});

// Built-in research agent (core/agent.js): searches, reads pages logged out,
// writes a report with sources into the Library and the research session.
ipcMain.handle("agent:run", async (_e, goal, previous) => {
  if (researchRun) return { ok: false, error: "The research agent is already running." };
  const ai = loadSettings().ai;
  if (!Chat.canChat(ai)) return { ok: false, error: "Set up a model first under Settings → AI: a local model (Ollama or LM Studio) or a Grok API key." };
  const run = (researchRun = { stop: false });
  const note = (entry) => research?.agentActivity({ at: Date.now(), tool: "research agent", ...entry });
  try {
    const out = await runResearch(
      { goal, previous: previous && Array.isArray(previous.sources) ? previous : null },
      {
        complete: (messages, opts) => Chat.complete(messages, ai, { fetch: (...a) => globalThis.fetch(...a), ...opts }),
        search: (q) => agentTools.searchForAgent(q),
        read: (url) => agentTools.readForAgent(url),
        stopped: () => run.stop,
        onStep: (step) => {
          sendUi("agent-step", step);
          if (step.kind === "read" || step.kind === "queries") note({ detail: step.kind === "read" ? step.url : `searched: ${step.text}` });
        },
      }
    );
    const name = stamp("report", "md");
    fs.writeFileSync(path.join(libraryRoot(), "saves", name), out.report);
    addRecord("saves", name, "", `Research agent: ${out.question}`);
    research.addReport({ question: out.question, file: name, sources: out.sources });
    return { ok: true, ...out, file: name };
  } catch (err) {
    note({ ok: false, detail: String(err.message || err) });
    return { ok: false, error: String(err.message || err), stopped: run.stop };
  } finally {
    researchRun = null;
  }
});
ipcMain.handle("agent:stop", () => {
  if (researchRun) researchRun.stop = true;
  return true;
});
ipcMain.handle("agents:set", (_e, on) => setAgents(on));
ipcMain.handle("agents:new-token", () => {
  loadSettings().agents.token = require("crypto").randomBytes(24).toString("base64url");
  saveSettings({});
  pushAgents();
  return agentsStatus();
});
ipcMain.handle("tab:agent-share", (_e, id, on) => shareTabWithAgents(id, on));
ipcMain.handle("search:status", () => search.status());
ipcMain.handle("search:test", (_e, id) => (PROVIDERS[id] ? search.test(id) : { ok: false, error: "Unknown source" }));
ipcMain.handle("page:keywords", (_e, id, banned, opts) => pageKeywords(id, banned, opts));
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
    // The research session (trail) this was saved in.
    session: research ? { id: research.current.id, name: research.current.name } : null,
  };
  rows.unshift(item);
  writeIndex(rows);
  // Screenshots, saved pages and media from a page also go in the session's trail.
  const kind = { screenshots: "shot", saves: "save", media: "media" }[folder];
  if (research && kind && /^https?:/i.test(sourceUrl || "")) {
    research.capture({ libraryId: item.id, kind, name, url: sourceUrl, title: folder === "media" ? "" : note });
    usage().count("captures");
  }
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

// ---- Research session IPC (B17) ----
ipcMain.handle("research:get", () => research.snapshot());
ipcMain.handle("research:list", () => research.list().map((s) => ({ ...s, tabs: [...tabs.values()].filter((t) => t.trail === s.id && /^https?:/i.test(tabState(t).url)).length })));
ipcMain.handle("research:new", (_e, name) => {
  changeTrail(() => research.create(name));
  usage().count("sessions");
  return research.snapshot();
});
ipcMain.handle("research:switch", (_e, id) => {
  changeTrail(() => research.switchTo(String(id)));
  return research.snapshot();
});
ipcMain.handle("research:rename", (_e, name) => {
  research.rename(name);
  return research.snapshot();
});
ipcMain.handle("research:pins", (_e, pins) => research.setPins(pins));
ipcMain.handle("research:visit", (_e, url, title, keywords) => {
  const before = research.current.trail.length;
  research.visit(url, title, keywords);
  if (research.current.trail.length > before) usage().count("trailPages");
});
ipcMain.handle("research:opened", (_e, item) => {
  research.opened(item);
  usage().count("suggestionsOpened");
});
// Counts the window reports (suggestions shown, pins, hides); core/usage.js
// ignores any other name. Copy puts the summary on the clipboard.
ipcMain.on("usage:count", (_e, name, n) => usage().count(String(name), n));
ipcMain.handle("usage:days", () => usage().daysUsed());
// The beta survey opens in a tab (B65).
ipcMain.handle("survey:open", () => createTab(require("./core/urls").SURVEY_URL));
// The window's saved survey answer (node.survey), sent when it loads and on every change (B98).
ipcMain.handle("survey:state", (_e, next) => setSurveyState(next, { fromWindow: true }));
ipcMain.handle("usage:copy", () => {
  const text = usageSummary();
  clipboard.writeText(text);
  return text;
});
ipcMain.handle("research:dismiss", (_e, url) => research.dismiss(url));
// Threads people write in the trail, and notes on pages (B82). The author is
// the display name from Settings → Sharing; the renderer asks for one first.
const authorName = () => loadSettings().displayName || "";
ipcMain.handle("threads:add", (_e, d = {}) => research.addThread({ ...d, by: authorName() }) && research.snapshot());
ipcMain.handle("threads:reply", (_e, threadId, parentId, text) => research.reply(String(threadId), { parentId: String(parentId || ""), text, by: authorName() }) && research.snapshot());
ipcMain.handle("threads:resolve", (_e, id, conclusion) => research.resolveThread(String(id), conclusion) && research.snapshot());
ipcMain.handle("threads:reopen", (_e, id) => research.reopenThread(String(id)) && research.snapshot());
ipcMain.handle("threads:edit", (_e, id, d = {}) => research.editThread(String(id), d) && research.snapshot());
ipcMain.handle("threads:remove", (_e, id) => research.removeThread(String(id)) && research.snapshot());
ipcMain.handle("threads:suggestions", () => research.threadSuggestions());
// ---- Sharing a trail as a file (B82 step 4, docs/19-trail-sharing.md) ----
// Reports are read from the Library; a missing file is left out.
function trailReports(session = research.current) {
  return (session.reports || [])
    .map((r) => {
      let text = "";
      try {
        text = fs.readFileSync(path.join(libraryRoot(), "saves", path.basename(r.file || "")), "utf8");
      } catch (_) {
        return null;
      }
      return { id: r.id || TrailFile.hashId("report", r.file, r.at), title: r.question || "Report", by: r.by || "NODE research agent", at: r.at, text };
    })
    .filter(Boolean);
}
const trailTabUrls = () => shownTabs().map((t) => tabState(t).url).filter((u) => /^https?:/i.test(u) && !isSensitiveUrl(u));
ipcMain.handle("trail:share-preview", () => {
  const s = research.current;
  const pages = (s.trail || []).filter((r) => !isSensitiveUrl(r.url)).map((r) => ({ url: r.url, title: r.title || r.url, lastAt: r.lastAt, notes: (r.notes || []).length }));
  const threads = s.threadList || [];
  const count = (l) => (l || []).reduce((n, r) => n + 1 + count(r.replies), 0);
  return {
    name: s.name,
    by: loadSettings().displayName || "",
    pages: pages.reverse(),
    threads: threads.length,
    replies: threads.reduce((n, t) => n + count(t.replies), 0),
    notes: pages.reduce((n, p) => n + p.notes, 0),
    reports: trailReports().length,
    captures: (s.captures || []).length,
    tabs: trailTabUrls().length,
    pins: (s.pins || []).length,
  };
});
// Builds the file text. opts: { pages: [urls], reports: bool, tabs: bool }.
function trailFileText(opts = {}) {
  const by = loadSettings().displayName || "";
  const trail = TrailFile.fromSession(research.current, {
    by,
    pages: Array.isArray(opts.pages) ? opts.pages.map(String) : null,
    reports: opts.reports === false ? [] : trailReports(),
    includeTabs: opts.tabs ? trailTabUrls() : [],
  });
  return TrailFile.toMarkdown(trail, { by });
}
const trailFileName = (name) => `${String(name || "Trail").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Trail"}.trail.md`;
let trailSavePath = null; // tests set a path instead of the Save dialog
ipcMain.handle("trail:share-save", async (_e, opts = {}) => {
  const text = trailFileText(opts);
  let file = trailSavePath;
  if (!file) {
    const r = await dialog.showSaveDialog(win, {
      title: "Save Trail File",
      defaultPath: path.join(app.getPath("downloads"), trailFileName(research.current.name)),
      filters: [{ name: "NODE trail", extensions: ["md"] }],
      buttonLabel: "Save",
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    file = r.filePath.endsWith(".md") ? r.filePath : `${r.filePath}.trail.md`;
  }
  try {
    fs.writeFileSync(file, text);
  } catch (err) {
    return { ok: false, error: `The file could not be saved: ${err.message}` };
  }
  usage().count("trailsShared");
  return { ok: true, file, name: path.basename(file) };
});
// ---- Opening a shared trail (B82 step 5) ----
// The file is read and checked; the Trail section shows a preview, then Open
// as New Trail or Merge Into one of yours. Nothing is changed until then.
let sharedTrail = null; // { file, trail }
const SHARED_MAX = 5 * 1024 * 1024;
function sharedPreview() {
  const t = sharedTrail.trail;
  const count = (l) => (l || []).reduce((n, r) => n + 1 + count(r.replies), 0);
  return {
    file: sharedTrail.link ? "" : path.basename(sharedTrail.file),
    viaLink: Boolean(sharedTrail.link),
    name: t.name,
    from: t.exportedBy,
    at: t.exportedAt,
    pages: t.pages.length,
    threads: t.threads.length,
    replies: t.threads.reduce((n, x) => n + count(x.replies), 0),
    notes: t.pages.reduce((n, p) => n + (p.notes || []).length, 0),
    reports: t.reports.length,
    tabs: t.tabs.length,
    extra: t.extra.length,
    trails: research.list().map((x) => ({ id: x.id, name: x.name, pages: x.current ? research.current.trail.length : x.pages, current: x.current, shared: (research.read(x.id)?.sharedId || "") === t.id && Boolean(t.id) })),
  };
}
function openSharedTrail(file) {
  let text = "";
  try {
    if (fs.statSync(file).size > SHARED_MAX) throw new Error("The file is too large for a trail (over 5 MB).");
    text = fs.readFileSync(file, "utf8");
    sharedTrail = { file, trail: TrailFile.fromMarkdown(text) };
  } catch (err) {
    sharedTrail = null;
    sendUi("shared-trail", { payload: { error: `${path.basename(file)}: ${err.message}` } });
    return { ok: false, error: err.message };
  }
  sendUi("shared-trail", { payload: sharedPreview() });
  return { ok: true };
}
async function chooseSharedTrail() {
  const r = await dialog.showOpenDialog(win, { title: "Open Shared Trail", properties: ["openFile"], filters: [{ name: "NODE trail", extensions: ["md"] }] });
  if (!r.canceled && r.filePaths[0]) openSharedTrail(r.filePaths[0]);
}
// Reports from a shared trail are saved in the Library like the agent's.
let sharedReportN = 0;
function saveSharedReports(session, reports) {
  for (const r of reports) {
    const file = stamp(`shared-report-${++sharedReportN}`, "md");
    fs.writeFileSync(path.join(libraryRoot(), "saves", file), `# ${r.title}\n\n${r.text}\n`);
    addRecord("saves", file, "", `Shared report: ${r.title}`);
    (session.reports = session.reports || []).push({ id: r.id, at: r.at || Date.now(), question: r.title, file, sources: [], by: r.by || "" });
  }
}
const sharedBase = (session) => TrailFile.fromSession(session, { by: loadSettings().displayName || "", reports: trailReports(session) });
// ---- Share links (B82 phase 2, worker/) ----
// The trail file is encrypted here; the share server stores what it cannot
// read. Links you made are listed (with the key to remove them) in
// shares.json, so you can copy one again or stop sharing it.
const sharesFile = () => path.join(app.getPath("userData"), "shares.json");
function readShares() {
  try {
    const list = JSON.parse(fs.readFileSync(sharesFile(), "utf8"));
    return Array.isArray(list) ? list.filter((x) => x.expiresAt > Date.now()) : [];
  } catch (_) {
    return [];
  }
}
const writeShares = (list) => fs.writeFileSync(sharesFile(), JSON.stringify(list, null, 2));
const shareApi = () => process.env.NODE_SHARE_API || ShareLink.API_BASE;
const shareLinkBase = () => process.env.NODE_SHARE_LINK_BASE || ShareLink.LINK_BASE;
async function shareFetch(url, init = {}, ms = 15000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await globalThis.fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}
const shareError = async (r) => {
  try {
    return (await r.json()).error || `The share server answered ${r.status}.`;
  } catch (_) {
    return `The share server answered ${r.status}.`;
  }
};
ipcMain.handle("trail:link-create", async (_e, opts = {}) => {
  const { bytes, key } = ShareLink.seal(trailFileText(opts));
  if (bytes.length > ShareLink.MAX_BYTES) return { ok: false, error: "This trail is too large to share as a link (over 1 MB). Save it as a file instead, or untick some pages." };
  let r;
  try {
    r = await shareFetch(`${shareApi()}/api/trails`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: bytes });
  } catch (err) {
    return { ok: false, error: "NODE could not reach the share server. Check your connection, or save the trail as a file instead." };
  }
  if (r.status !== 201) return { ok: false, error: await shareError(r) };
  const made = await r.json();
  const link = ShareLink.linkFor(made.id, key, shareLinkBase());
  const list = readShares();
  list.unshift({ id: made.id, link, deleteToken: made.deleteToken, api: shareApi(), name: research.current.name, trail: research.current.id, createdAt: Date.now(), expiresAt: made.expiresAt });
  writeShares(list);
  usage().count("trailsShared");
  return { ok: true, link, id: made.id, expiresAt: made.expiresAt };
});
ipcMain.handle("trail:links", () => readShares().map(({ deleteToken, ...rest }) => rest));
ipcMain.handle("trail:link-copy", (_e, id) => {
  const s = readShares().find((x) => x.id === id);
  if (s) clipboard.writeText(s.link);
  return Boolean(s);
});
ipcMain.handle("trail:link-remove", async (_e, id) => {
  const list = readShares();
  const s = list.find((x) => x.id === id);
  if (!s) return { ok: true };
  try {
    const r = await shareFetch(`${s.api}/api/trails/${s.id}`, { method: "DELETE", headers: { authorization: `Bearer ${s.deleteToken}` } });
    if (r.status !== 204 && r.status !== 404) return { ok: false, error: await shareError(r) };
  } catch (_) {
    return { ok: false, error: "NODE could not reach the share server, so the link still works. Try again when you are online." };
  }
  writeShares(list.filter((x) => x.id !== id));
  return { ok: true };
});
// A share link opened in NODE: typed or pasted in the address bar, clicked in
// a page, or from the web page's Open in NODE (noderesearch://).
async function openShareLink(text) {
  const parsed = ShareLink.parseLink(text, { api: shareApi() });
  if (!parsed) return { ok: false, error: "This is not a NODE share link." };
  const fail = (error) => {
    sharedTrail = null;
    sendUi("shared-trail", { payload: { error } });
    return { ok: false, error };
  };
  if (!parsed.key) return fail("This link is missing its key (the part after #). Ask the sender to copy the whole link again.");
  let r;
  try {
    r = await shareFetch(`${parsed.api}/api/trails/${parsed.id}`);
  } catch (_) {
    return fail("NODE could not reach the share server. Check your connection and try again.");
  }
  if (r.status === 404) return fail("This link has expired or was removed. Shared trails are kept for 30 days.");
  if (!r.ok) return fail(await shareError(r));
  try {
    const text = ShareLink.unseal(Buffer.from(await r.arrayBuffer()), parsed.key);
    sharedTrail = { file: "", link: parsed.id, trail: TrailFile.fromMarkdown(text) };
  } catch (err) {
    return fail(err.message);
  }
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
  sendUi("shared-trail", { payload: sharedPreview() });
  return { ok: true };
}
const isShareLink = (url) => Boolean(ShareLink.parseLink(url, { api: shareApi() }));
ipcMain.handle("trail:link-open", (_e, text) => openShareLink(String(text || "")));
ipcMain.handle("trail:shared-choose", () => chooseSharedTrail());
ipcMain.handle("trail:shared-preview", () => (sharedTrail ? sharedPreview() : null));
ipcMain.handle("trail:shared-plan", (_e, id) => {
  const target = sharedTrail && research.read(String(id));
  return target ? TrailFile.mergePlan(sharedBase(target), sharedTrail.trail) : null;
});
ipcMain.handle("trail:shared-open", (_e, opts = {}) => {
  if (!sharedTrail) return { ok: false, error: "No shared trail is open." };
  const { trail } = sharedTrail;
  const { session, reports } = TrailApply.sessionFromTrail(trail, {});
  saveSharedReports(session, reports);
  changeTrail(() => research.adopt(session));
  if (opts.tabs) for (const u of trail.tabs.slice(0, 20)) createTab(u, { background: true, sleeping: true });
  sharedTrail = null;
  usage().count("sessions");
  return { ok: true, snapshot: research.snapshot() };
});
ipcMain.handle("trail:shared-merge", (_e, id, answers = {}) => {
  if (!sharedTrail) return { ok: false, error: "No shared trail is open." };
  const target = research.read(String(id));
  if (!target) return { ok: false, error: "That trail could not be read." };
  const base = sharedBase(target);
  const merged = TrailFile.merge(base, sharedTrail.trail, answers);
  const { reports, counts } = TrailApply.applyMerged(target, merged, sharedTrail.trail, { baseReportIds: base.reports.map((r) => r.id) });
  saveSharedReports(target, reports);
  research.write(target);
  changeTrail(() => research.switchTo(target.id));
  sharedTrail = null;
  return { ok: true, counts, snapshot: research.snapshot() };
});
ipcMain.handle("trail:shared-close", () => (sharedTrail = null));
ipcMain.handle("trail:show-file", (_e, file) => file && fs.existsSync(file) && shell.showItemInFolder(file));
ipcMain.handle("notes:add", (_e, url, text) => research.addNote(String(url), { text, by: authorName() }) && research.snapshot());
ipcMain.handle("notes:remove", (_e, url, id) => research.removeNote(String(url), String(id)) && research.snapshot());
ipcMain.handle("research:undismiss", () => research.undismissAll());
ipcMain.handle("research:export", () => {
  const name = stamp("session", "md");
  fs.writeFileSync(path.join(libraryRoot(), "saves", name), research.markdown());
  return addRecord("saves", name, "", `Session notes: ${research.current.name}`);
});
// Mutes and blanks every tab, then closes the pages (at most 1.5 s).
let pagesReleased = false;
async function releasePages() {
  if (pagesReleased) return;
  saveSessionNow();
  pagesReleased = true;
  const jobs = [...tabs.values()].map((tab) => {
    const wc = tab.view.webContents;
    if (wc.isDestroyed()) return null;
    try {
      wc.setAudioMuted(true);
    } catch (_) {}
    return wc.loadURL("about:blank").catch(() => {});
  });
  await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, 1500))]);
  for (const tab of tabs.values()) {
    try {
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    } catch (_) {}
  }
}

app.on("before-quit", (e) => {
  try {
    research?.saveNow();
    historyStore?.saveNow();
  } catch (_) {}
  if (!pagesReleased && tabs.size) {
    e.preventDefault();
    releasePages().then(() => app.quit());
  }
});

ipcMain.handle("library:root", () => libraryRoot());
ipcMain.handle("library:list", () =>
  readIndex().map((item) => ({
    ...item,
    // The id goes in the path: a numeric host would be read as an IP address.
    mediaUrl: `scoutlib://item/${item.id}`,
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
    : await runInPage(tab.view.webContents, `(() => {
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

