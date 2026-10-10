const { app, BrowserWindow, WebContentsView, ipcMain, session, shell, protocol, net, Menu, dialog, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");
const { URL } = require("url");
// Platform-neutral logic lives in core/ (shared with the mobile app).
const { rankTerms, SessionDF } = require("./core/keywords");
const { PROVIDERS, Registry, defaultSettings } = require("./core/providers");
const Rules = require("./core/rules");
const AI = require("./core/ai");
const { ResearchStore } = require("./core/research");
const { HistoryStore } = require("./core/history");
const { createNet } = require("./core/net");
const { createSuggest } = require("./core/suggest");
const { createPreview } = require("./core/preview");
const { extractionScript, autoplayScript, blockAutoplayScript } = require("./core/page-scripts");
const { fsStorage } = require("./fs-storage");
const { normalizeUrl } = require("./core/urls");
let research = null; // current research session store (B17), created when the app is ready

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

function ruleFor(url) {
  return Rules.resolve(siteRules, url);
}

// Recompute a tab's rule after navigation. Sound follows the rule unless the
// user set this tab's sound with the speaker button.
function refreshRule(tab, url) {
  tab.rule = ruleFor(url || tab.view.webContents.getURL());
  if (!tab.audioByUser) tab.audio = tab.rule.sound;
}

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
  // Tabs whose site rule says "mosaic": false stay out of the grid unless active.
  const ids = [...tabs.keys()].filter((id) => id === activeId || tabs.get(id).rule?.mosaic !== false);
  const rect = contentRect();
  for (const [id, tab] of tabs) if (!ids.includes(id)) tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });

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
    zoom: Math.round(wc.getZoomFactor() * 100),
    rule: tab.rule ? { matched: tab.rule.matched, suggest: tab.rule.suggest, autoplay: tab.rule.autoplay } : null,
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


// Autoplay per site rule: "on" starts media (falls back to muted if the page
// refuses sound), "muted" starts it muted, "off" pauses media the page starts
// on its own before the user has interacted with it.
// Autoplay per site rule (scripts in core/page-scripts.js).
function tryAutoplay(wc, mode = "on") {
  if (mode === "off") return blockAutoplay(wc);
  wc.executeJavaScript(autoplayScript(mode), true).catch(() => {});
}

function blockAutoplay(wc) {
  wc.executeJavaScript(blockAutoplayScript()).catch(() => {});
}

function attachListeners(tab) {
  const wc = tab.view.webContents;
  const ping = () => emit({ type: "update", tab: tabState(tab), activeId });
  wc.on("focus", () => {
    if (activeId !== tab.id) activateTab(tab.id);
  });
  wc.on("page-title-updated", (_e, title) => {
    historyStore.updateTitle(wc.getURL(), title);
    ping();
  });
  wc.on("found-in-page", (_e, r) => {
    if (r.finalUpdate) emit({ type: "find", tabId: tab.id, active: r.activeMatchOrdinal, total: r.matches });
  });
  // Ctrl/Cmd + mouse wheel or trackpad pinch.
  wc.on("zoom-changed", (_e, direction) => zoomTab(tab, direction === "in" ? 0.5 : -0.5));
  wc.on("did-navigate", (_e, url) => {
    historyStore.record(url, wc.getTitle());
    refreshRule(tab, url);
    applyLayout();
    ping();
  });
  wc.on("did-navigate-in-page", (_e, url, isMainFrame) => {
    if (isMainFrame) refreshRule(tab, url);
    applyLayout();
    ping();
  });
  wc.on("dom-ready", () => {
    if (tab.rule?.autoplay === "off") blockAutoplay(wc);
  });
  wc.on("did-start-loading", ping);
  wc.on("did-stop-loading", () => {
    ping();
    tryAutoplay(wc, tab.rule?.autoplay);
    emit({ type: "settled", tab: tabState(tab) });
  });
  wc.on("audio-state-changed", ping);
  // Popups (B04): only open a new tab if the user clicked or typed in this
  // page in the last 2 s. Everything else is blocked and reported to the UI.
  wc.setWindowOpenHandler(({ url, disposition }) => {
    const policy = tab.rule?.popups || "gesture";
    const allowed = policy === "allow" || (policy === "gesture" && Date.now() - tab.lastGesture < 2000);
    if (allowed) {
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
  const view = new WebContentsView({
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
  const tab = { id, view, audio: "auto", audioByUser: false, lastGesture: 0 };
  refreshRule(tab, normalizeUrl(url));
  tabs.set(id, tab);
  win.contentView.addChildView(view);
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
  win.contentView.removeChildView(tab.view);
  try {
    // WebContentsView does not free its page on removal; close it explicitly.
    tab.view.webContents.close();
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
  try {
    return await tab.view.webContents.executeJavaScript(extractionScript(tab.rule?.extract), true);
  } catch (err) {
    return { url: tab.view.webContents.getURL(), title: tab.view.webContents.getTitle(), error: String(err) };
  }
}

// ---- Network layer (B12, B13): core/net.js ----
// fetch is looked up on each call so tests can replace globalThis.fetch.
const netLayer = createNet({ fetch: (...args) => globalThis.fetch(...args), userAgent: USER_AGENT });
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
  // AI query ideas (B20). The Grok key is stored like the search keys.
  const ai = raw.ai || {};
  base.ai = {
    enabled: Boolean(ai.enabled),
    provider: ai.provider === "grok" ? "grok" : "local",
    local: { ...AI.AI_DEFAULTS.local, ...(ai.local || {}) },
    grok: { model: ai.grok?.model || AI.AI_DEFAULTS.grok.model, key: decryptSecret(ai.grok?.key) },
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
  const disk = { providers: {} };
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
    meta: Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label, role: p.role, fields: p.fields })),
    encrypted: safeStorage.isEncryptionAvailable(),
  };
}

const search = new Registry({ getText, getConfig: (id) => loadSettings().providers[id] || {} });

// ---- Search flow and AI query ideas (B09, B20, B25): core/suggest.js ----
const searchFlow = createSuggest({ registry: search, getAISettings: () => loadSettings().ai, ttl: CACHE_TTL });
const { suggest, suggestFor, aiTest, aiReset, aiState } = searchFlow;

// Session-wide document frequency, so words that appear on every page lose weight.
const sessionDF = new SessionDF();

async function pageKeywords(id, banned = []) {
  const tab = tabs.get(id);
  if (tab?.rule && tab.rule.suggest === false) {
    // Site rule: never read this page or send its words to a search engine.
    const wc = tab.view.webContents;
    return { disabled: true, matched: tab.rule.matched, page: { url: wc.getURL(), title: wc.getTitle() }, ranked: [] };
  }
  const page = await extractPage(id);
  if (!page || page.error) return { page, ranked: [] };
  const ranked = rankTerms(page, { df: sessionDF, banned, limit: 12 });
  return { page: { url: page.url, title: page.title, selection: page.selection }, ranked };
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
        { label: "Edit Site Rules…", click: () => shell.openPath(rulesFile()) },
        { label: "Reload Site Rules", click: () => loadRules(true) },
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
  loadRules();
  watchRules();
  research = new ResearchStore(fsStorage(path.join(app.getPath("userData"), "sessions")));
  historyStore = new HistoryStore(fsStorage(app.getPath("userData")));
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
  tab.audioByUser = true;
  applyAudio();
  emitList();
  return tab.audio;
});
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
ipcMain.handle("history:clear", () => {
  historyStore.clear();
  return true;
});
ipcMain.handle("history:remove", (_e, url) => {
  historyStore.remove(url);
  return true;
});
ipcMain.handle("rules:edit", () => shell.openPath(rulesFile()));
ipcMain.handle("rules:reload", () => {
  loadRules(true);
  return { count: siteRules.length, errors: rulesErrors };
});
ipcMain.handle("settings:set", (_e, next) => saveSettings(next));
ipcMain.handle("search:status", () => search.status());
ipcMain.handle("search:test", (_e, id) => (PROVIDERS[id] ? search.test(id) : { ok: false, error: "Unknown source" }));
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

// ---- Research session IPC (B17) ----
ipcMain.handle("research:get", () => research.snapshot());
ipcMain.handle("research:list", () => research.list());
ipcMain.handle("research:new", (_e, name) => {
  research.create(name);
  return research.snapshot();
});
ipcMain.handle("research:switch", (_e, id) => {
  research.switchTo(String(id));
  return research.snapshot();
});
ipcMain.handle("research:rename", (_e, name) => {
  research.rename(name);
  return research.snapshot();
});
ipcMain.handle("research:pins", (_e, pins) => research.setPins(pins));
ipcMain.handle("research:visit", (_e, url, title, keywords) => research.visit(url, title, keywords));
ipcMain.handle("research:opened", (_e, item) => research.opened(item));
ipcMain.handle("research:dismiss", (_e, url) => research.dismiss(url));
ipcMain.handle("research:undismiss", () => research.undismissAll());
ipcMain.handle("research:export", () => {
  const name = stamp("session", "md");
  fs.writeFileSync(path.join(libraryRoot(), "saves", name), research.markdown());
  return addRecord("saves", name, "", `Session notes: ${research.current.name}`);
});
app.on("before-quit", () => {
  try {
    research?.saveNow();
    historyStore?.saveNow();
  } catch (_) {}
});

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

