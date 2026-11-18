// Sync on the phone (B50): pairing by scanning the QR code NODE shows on a
// computer (Settings → Sync), then trails sync both ways, as on desktop
// (main.js "Sync (B50)"). The logic is in core/sync.js, core/sync-crypto.js
// and core/sync-relay.js; this file keeps the phone's state and runs rounds.
//
// Platform parts are passed in, so this file runs in Node tests too:
//   storage   the app's storage (sync state goes under "sync/")
//   trails    the TrailStore; research: the ResearchStore over it
//   secret    { get(key), set(key, value), del(key) } (expo-secure-store)
//   fetch     the fetch to use; api: the share server
//   kind      "phone"; defaultName: e.g. "NODE on iPhone"

const { SyncEngine } = require("../../core/sync");
const SyncCrypto = require("../../core/sync-crypto");
const { RelayClient, SyncError, syncOnce } = require("../../core/sync-relay");
const { prefixedStorage } = require("../../core/storage");
const { SHARE_API } = require("../../core/urls");

const CODE_KEY = "node.sync.code";

const AFTER_EDIT_MS = 1500; // an edit is sent this long after edits pause

function createSync({ storage, trails, research, secret, fetch: f = globalThis.fetch, api = SHARE_API, kind = "phone", defaultName = "NODE on a phone", now = () => Date.now(), afterEditMs = AFTER_EDIT_MS }) {
  const files = prefixedStorage(storage, "sync/");
  const readJson = (name) => {
    try {
      return JSON.parse(files.read(name) || "null");
    } catch (_) {
      return null;
    }
  };
  const writeJson = (name, v) => files.write(name, JSON.stringify(v));
  let device = readJson("device.json");
  if (!device?.id || !/^[0-9a-f]{16}$/.test(device.id)) {
    device = { id: SyncCrypto.newDeviceId(), name: defaultName };
    writeJson("device.json", device);
  }
  let s = null; // { code, keys, engine, client, relay }
  let status = { state: "off" };
  let busy = null;
  let soonTimer = null;
  let dirty = false; // an edit while a round was running
  const listeners = new Set();
  const tell = (event) => listeners.forEach((fn) => fn(event, info()));

  function setup(code) {
    if (!code || !SyncCrypto.parsePairingCode(code)) return (s = null);
    const keys = SyncCrypto.keysFrom(code);
    s = {
      code,
      keys,
      engine: new SyncEngine(trails, files, { device: device.id, now }),
      // Phones send batches as text: not every phone fetch sends binary.
      client: new RelayClient({ api, group: keys.group, auth: keys.auth, device: device.id, fetch: f, text: true }),
      relay: { ...(readJson("relay.json") || {}), joined: 0 },
    };
    return s;
  }
  function info() {
    const peers = s?.relay.peers || {};
    return {
      paired: Boolean(s),
      ...status,
      device,
      peers: Object.entries(peers).map(([id, p]) => ({ id, name: p.name || "Unnamed device", kind: p.kind, at: p.at })),
      pending: s ? s.engine.pending() : 0,
      busy: Boolean(busy),
    };
  }
  // An edit on this phone: sync shortly after, once edits pause.
  function soon() {
    if (!s) return;
    if (busy) {
      dirty = true;
      return;
    }
    clearTimeout(soonTimer);
    soonTimer = setTimeout(now_, afterEditMs);
  }
  trails.onChange = soon;
  async function start() {
    setup(await secret.get(CODE_KEY));
    return info();
  }
  // One round. events: "changed" (trails arrived), "deleted" ([{ id, name, by }]).
  async function now_() {
    if (!s) return info();
    if (busy) return busy;
    clearTimeout(soonTimer);
    dirty = false;
    busy = (async () => {
      await null; // so busy is set before anything below runs
      tell({ type: "status" }); // "Syncing…"
      research.saveNow?.();
      const before = research.current?.id;
      try {
        const res = await syncOnce({ engine: s.engine, client: s.client, key: s.keys.key, state: s.relay, me: { name: device.name, kind }, now });
        writeJson("relay.json", { cursor: s.relay.cursor || "", peers: s.relay.peers || {} });
        if (res.deleted.some((d) => d.id === before)) research.switchTo?.(trails.index.current);
        else if (res.trails.includes(before) || res.restored.length) research.reload?.();
        status = { state: "ok", at: now() };
        if (res.deleted.length) tell({ type: "deleted", trails: res.deleted.map((d) => ({ ...d, byName: s.relay.peers?.[d.by]?.name || "another device" })) });
        if (res.trails.length || res.added.length || res.deleted.length || res.restored.length) tell({ type: "changed" });
      } catch (err) {
        if (err instanceof SyncError && err.unpaired) status = { state: "unpaired", message: "This phone was removed from sync on another device. Scan the code again to sync." };
        else if (err instanceof SyncError && err.status === 0) status = { state: "offline", at: status.at, message: "Can't reach the sync server. Changes are kept and sent later." };
        else status = { state: "error", at: status.at, message: err.message };
      } finally {
        busy = null;
      }
      // Edits made during the round go out next; changes that arrived are
      // not edits, so they don't start another round.
      if (dirty && s) {
        dirty = false;
        s.engine.collect();
        if (s.engine.pending()) soon();
      }
      tell({ type: "status" });
      return info();
    })();
    return busy;
  }
  // A scanned or pasted code.
  async function pair(text) {
    const code = String(text || "").trim();
    if (!SyncCrypto.parsePairingCode(code)) return { ok: false, error: "That isn't a NODE sync code. On your computer, open Settings → Sync → Pair a device…, then scan the code it shows." };
    if (s && s.code === code) return { ok: true, info: info() };
    if (s) return { ok: false, error: "This phone already syncs with other devices. Stop syncing first to join another group." };
    files.remove?.("state.json");
    files.remove?.("relay.json");
    await secret.set(CODE_KEY, code);
    setup(code);
    const r = await now_();
    return { ok: r.state === "ok" || r.state === "offline", info: r, error: r.message };
  }
  async function stop() {
    if (s) {
      await busy;
      try {
        await s.client.leave();
      } catch (_) {} // already removed, or offline: the relay drops it after 30 days
    }
    await secret.del(CODE_KEY);
    for (const name of ["state.json", "relay.json"]) files.remove?.(name);
    s = null;
    clearTimeout(soonTimer);
    status = { state: "off" };
    tell({ type: "status" });
    return info();
  }
  async function removeDevice(id) {
    if (!s) return info();
    await s.client.leave(String(id));
    delete s.relay.peers?.[id];
    writeJson("relay.json", { cursor: s.relay.cursor || "", peers: s.relay.peers || {} });
    return info();
  }
  function rename(name) {
    device = { ...device, name: String(name || "").trim().slice(0, 60) || defaultName };
    writeJson("device.json", device);
    return info();
  }
  return { start, now: now_, pair, stop, removeDevice, rename, info, on: (fn) => (listeners.add(fn), () => listeners.delete(fn)) };
}

module.exports = { createSync, CODE_KEY };
