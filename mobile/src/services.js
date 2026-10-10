// Platform services for the mobile app: storage, settings, keys, search and
// sessions, built from the shared core/ modules.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

const core = require("../../core");

const PREFIX = "scout:";
const SECRET_KEYS = { brave: "scout.brave.key", grok: "scout.grok.key" };

// Load every saved file into memory first, so core stores can read
// synchronously; each write is persisted to AsyncStorage in the background.
async function loadStorage() {
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
  const pairs = keys.length ? await AsyncStorage.multiGet(keys) : [];
  const files = {};
  for (const [k, v] of pairs) if (v != null) files[k.slice(PREFIX.length)] = v;
  return core.memoryStorage(files, (name, text) => {
    AsyncStorage.setItem(PREFIX + name, text).catch(() => {});
  });
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

  const net = core.createNet({ fetch: (...args) => fetch(...args) });
  const registry = new core.Registry({ getText: net.getText, getConfig: (id) => settings.providers[id] || {} });
  const flow = core.createSuggest({ registry, getAISettings: () => settings.ai, ttl: net.ttl });
  const { preview } = core.createPreview({ getText: net.getText });
  const research = new core.ResearchStore(core.prefixedStorage(storage, "sessions/"));
  const history = new core.HistoryStore(storage);
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
    research,
    history,
    ruleFor: (url) => core.resolve(rules, url),
  };
}
