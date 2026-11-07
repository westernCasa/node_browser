// Platform services for the mobile app: storage, settings, keys, search and
// sessions, built from the shared core/ modules.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

const core = require("../../core");
const { TrailStore, migrateSessions, sessionStorageOver } = require("../../core/trail");
const appConfig = require("../app.json");

const PREFIX = "scout:";
const SECRET_KEYS = { brave: "scout.brave.key", grok: "scout.grok.key" };

// Load every saved file into memory first, so core stores can read
// synchronously; each write is persisted to AsyncStorage in the background.
async function loadStorage() {
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
  const pairs = keys.length ? await AsyncStorage.multiGet(keys) : [];
  const files = {};
  for (const [k, v] of pairs) if (v != null) files[k.slice(PREFIX.length)] = v;
  return core.memoryStorage(
    files,
    (name, text) => {
      AsyncStorage.setItem(PREFIX + name, text).catch(() => {});
    },
    (name) => {
      AsyncStorage.removeItem(PREFIX + name).catch(() => {});
    }
  );
}

// A view of storage under "trails/" that can also remove a trail's files.
function trailFiles(storage) {
  const prefix = "trails/";
  return {
    read: (name) => storage.read(prefix + name),
    write: (name, text) => storage.write(prefix + name, text),
    list: () => storage.list().filter((n) => n.startsWith(prefix)).map((n) => n.slice(prefix.length)),
    remove: (name) => storage.remove(prefix + name),
  };
}

// Trails, as on desktop (main.js openTrails): the old research sessions are
// copied in once, trails deleted last time are purged, and the research
// store reads and writes through the trail store. Phone visits go to the
// timeline only; the canvas is built on desktop.
function openTrails(storage) {
  const trails = new TrailStore(trailFiles(storage), { device: "phone" });
  const sessions = core.prefixedStorage(storage, "sessions/");
  if (!trails.index.migratedAt && sessions.list().some((n) => n.endsWith(".json"))) {
    try {
      migrateSessions(sessions, trails);
    } catch (_) {} // the old files stay; the next start tries again
  }
  trails.purge();
  trails.current();
  return { trails, research: new core.ResearchStore(sessionStorageOver(trails)) };
}

function defaultSettings() {
  return { ...core.defaultSettings(), ai: JSON.parse(JSON.stringify(core.AI.AI_DEFAULTS)) };
}

export async function createServices() {
  const storage = await loadStorage();

  // Settings: plain values in storage, API keys in the device keychain.
  const settings = defaultSettings();
  try {
    const saved = JSON.parse(storage.read("settings.json") || "{}");
    for (const [id, conf] of Object.entries(saved.providers || {})) settings.providers[id] = { ...settings.providers[id], ...conf };
    if (saved.ai) settings.ai = { ...settings.ai, ...saved.ai, local: { ...settings.ai.local, ...saved.ai.local }, grok: { ...settings.ai.grok, ...saved.ai.grok } };
  } catch (_) {}
  settings.providers.brave.key = (await SecureStore.getItemAsync(SECRET_KEYS.brave)) || "";
  settings.ai.grok.key = (await SecureStore.getItemAsync(SECRET_KEYS.grok)) || "";

  // Identify NODE to the sites it calls in the background (Wikipedia limits
  // unidentified apps to 10 requests a minute). Same contact URL as desktop.
  const userAgent = `NODE/${appConfig.expo.version} (research browser; mobile; +https://github.com/westernCasa/node_browser)`;
  const net = core.createNet({ fetch: (...args) => fetch(...args), userAgent });
  const registry = new core.Registry({ getText: net.getText, getConfig: (id) => settings.providers[id] || {} });
  const flow = core.createSuggest({ registry, getAISettings: () => settings.ai, ttl: net.ttl });
  const { preview } = core.createPreview({ getText: net.getText });
  const { trails, research } = openTrails(storage);
  const history = new core.HistoryStore(storage);
  const bookmarks = new core.BookmarkStore(storage);
  const rules = core.validate(core.DEFAULT_FILE).rules; // default rules for now; editing comes later (M-backlog)

  async function saveSettings(next) {
    for (const [id, conf] of Object.entries(next.providers || {})) {
      settings.providers[id] = { ...settings.providers[id], ...conf };
      registry.reset(id);
    }
    if (next.ai) {
      settings.ai = { ...settings.ai, ...next.ai, local: { ...settings.ai.local, ...(next.ai.local || {}) }, grok: { ...settings.ai.grok, ...(next.ai.grok || {}) } };
      flow.aiReset();
    }
    await SecureStore.setItemAsync(SECRET_KEYS.brave, settings.providers.brave.key || "");
    await SecureStore.setItemAsync(SECRET_KEYS.grok, settings.ai.grok.key || "");
    const disk = JSON.parse(JSON.stringify(settings));
    delete disk.providers.brave.key;
    delete disk.ai.grok.key;
    storage.write("settings.json", JSON.stringify(disk));
  }

  return {
    core,
    settings,
    saveSettings,
    registry,
    flow,
    preview,
    net,
    research,
    trails,
    storage,
    history,
    bookmarks,
    ruleFor: (url) => core.resolve(rules, url),
  };
}
