// Platform services for the mobile app: storage, settings, keys, search and
// sessions, built from the shared core/ modules.
import { Directory, Paths } from "expo-file-system";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const core = require("../../core");
const AIPolicy = require("./aiPolicy");
const { TrailStore, migrateSessions, sessionStorageOver } = require("../../core/trail");
const appConfig = require("../app.json");
const { createSync, CODE_KEY: SYNC_CODE_KEY } = require("./sync");

const PREFIX = "scout:";
const SECRET_KEYS = { brave: "scout.brave.key", grok: "scout.grok.key", unpaywallEmail: "node.unpaywall.email", openalex: "node.openalex.key" };

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
    // New installs start on the demo AI (nothing sent); see src/aiPolicy.js.
    else settings.ai = { ...settings.ai, provider: "demo", enabled: false };
    settings.aiConsent = saved.aiConsent || {};
  } catch (_) {}
  settings.aiConsent = settings.aiConsent || {};
  settings.providers.brave.key = (await SecureStore.getItemAsync(SECRET_KEYS.brave)) || "";
  settings.ai.grok.key = (await SecureStore.getItemAsync(SECRET_KEYS.grok)) || "";
  // M19 full text: off until the person turns it on; email and key in the keychain.
  settings.fulltext = { enabled: false, tutorialSeen: false, ...(safeParse(storage.read("settings.json")).fulltext || {}) };
  settings.fulltext.email = (await SecureStore.getItemAsync(SECRET_KEYS.unpaywallEmail)) || "";
  settings.fulltext.openalexKey = (await SecureStore.getItemAsync(SECRET_KEYS.openalex)) || "";

  // Identify NODE to the sites it calls in the background (Wikipedia limits
  // unidentified apps to 10 requests a minute). Same contact URL as desktop.
  const userAgent = `NODE/${appConfig.expo.version} (research browser; mobile; +https://github.com/westernCasa/node_browser)`;
  const net = core.createNet({ fetch: (...args) => fetch(...args), userAgent });
  const registry = new core.Registry({ getText: net.getText, getConfig: (id) => settings.providers[id] || {} });
  // AI query ideas run only with consent for the chosen provider (Apple 5.1.2(i)).
  const flow = core.createSuggest({ registry, getAISettings: () => AIPolicy.aiForQueries(settings.ai, settings.aiConsent), ttl: net.ttl });
  const { preview } = core.createPreview({ getText: net.getText });
  const { trails, research } = openTrails(storage);
  // Sync with NODE on a computer (B50): the pairing code in the keychain.
  const sync = createSync({
    storage,
    trails,
    research,
    secret: { get: (k) => SecureStore.getItemAsync(k), set: (k, v) => SecureStore.setItemAsync(k, v), del: (k) => SecureStore.deleteItemAsync(k) },
    fetch: (...args) => fetch(...args),
    defaultName: Platform.OS === "ios" ? (Platform.isPad ? "NODE on iPad" : "NODE on iPhone") : "NODE on Android",
  });
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
    if (next.fulltext) settings.fulltext = { ...settings.fulltext, ...next.fulltext };
    if (next.aiConsent) settings.aiConsent = { ...next.aiConsent };
    await SecureStore.setItemAsync(SECRET_KEYS.unpaywallEmail, String(settings.fulltext.email || "").trim());
    await SecureStore.setItemAsync(SECRET_KEYS.openalex, String(settings.fulltext.openalexKey || "").trim());
    const disk = JSON.parse(JSON.stringify(settings));
    delete disk.providers.brave.key;
    delete disk.ai.grok.key;
    delete disk.fulltext.email;
    delete disk.fulltext.openalexKey;
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
    sync,
    storage,
    history,
    bookmarks,
    ruleFor: (url) => core.resolve(rules, url),
    // Settings → Delete all NODE data: trails, history, settings, keys and
    // capture thumbnails on this phone. NODE keeps no copy anywhere else.
    clearAll: async () => {
      await sync.stop().catch(() => {}); // B50: leaves the sync group first
      await SecureStore.deleteItemAsync(SYNC_CODE_KEY).catch(() => {});
      const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
      await AsyncStorage.multiRemove(keys);
      for (const k of Object.values(SECRET_KEYS)) await SecureStore.deleteItemAsync(k).catch(() => {});
      for (const name of storage.list()) storage.remove(name);
      try {
        const shots = new Directory(Paths.document, "captures");
        if (shots.exists) shots.delete();
      } catch (_) {}
    },
  };
}

function safeParse(text) {
  try {
    return JSON.parse(text || "{}");
  } catch (_) {
    return {};
  }
}
