// Sync on the phone (B50): src/sync.js with the trail store, the research
// store and the relay (the share Worker's code in this process). A "Mac" made
// from core/ is the other device.
// Run: npm test (in mobile/).
const assert = require("assert");
const core = require("../../core");
const { TrailStore, sessionStorageOver } = require("../../core/trail");
const { SyncEngine } = require("../../core/sync");
const { RelayClient, syncOnce } = require("../../core/sync-relay");
const Crypto = require("../../core/sync-crypto");
const { createSync, CODE_KEY } = require("../src/sync");

let passed = 0;
const ok = (name) => console.log(`ok ${++passed} - ${name}`);
let clock = Date.UTC(2026, 10, 16, 22, 0);
const now = () => clock;

(async () => {
  const { default: worker } = await import("../../worker/src/index.js");
  const items = new Map();
  const env = {
    TRAILS: {
      async put(k, body, o) { items.set(k, { bytes: new Uint8Array(body), customMetadata: o?.customMetadata }); },
      async get(k) { const it = items.get(k); return it ? { customMetadata: it.customMetadata, body: new Blob([it.bytes]).stream(), arrayBuffer: async () => it.bytes.buffer.slice(0) } : null; },
      async delete(k) { items.delete(k); },
      async list({ prefix = "", startAfter } = {}) { return { objects: [...items.keys()].filter((k) => k.startsWith(prefix) && (!startAfter || k > startAfter)).sort().map((key) => ({ key })), truncated: false }; },
    },
  };
  // A phone fetch: text bodies only, to check the phone never sends binary.
  const sentTypes = new Set();
  const phoneFetch = (url, init = {}) => {
    if (init.body && typeof init.body !== "string") throw new Error("the phone sent a binary body");
    if (init.headers?.["content-type"]) sentTypes.add(init.headers["content-type"]);
    return worker.fetch(new Request(url, init), env);
  };

  // The Mac shows a code.
  const code = Crypto.newPairingCode();
  const k = Crypto.keysFrom(code);
  const macStore = new TrailStore(core.memoryStorage({}), { device: "desktop", now });
  const macId = Crypto.newDeviceId();
  const mac = { engine: new SyncEngine(macStore, core.memoryStorage({}), { device: macId, now }), client: new RelayClient({ api: "https://relay.test", group: k.group, auth: k.auth, device: macId, fetch: (u, i) => worker.fetch(new Request(u, i), env) }), state: {} };
  const macRound = () => syncOnce({ engine: mac.engine, client: mac.client, key: k.key, state: mac.state, me: { name: "Sven's MacBook", kind: "desktop" }, now });
  const levain = macStore.current().trail.id;
  macStore.rename(levain, "Levain");
  macStore.freeNote(levain, { x: 0, y: 0, text: "Feed at 25°C" });
  await macRound();

  // The phone.
  const storage = core.memoryStorage({});
  const trails = new TrailStore(core.prefixedStorage(storage, "trails/"), { device: "phone", now });
  trails.current();
  const research = new core.ResearchStore(sessionStorageOver(trails));
  const keychain = new Map();
  const secret = { get: async (key) => keychain.get(key) || null, set: async (key, v) => keychain.set(key, v), del: async (key) => keychain.delete(key) };
  const events = [];
  let sync = createSync({ storage, trails, research, secret, fetch: phoneFetch, api: "https://relay.test", defaultName: "NODE on iPhone", now });
  sync.on((e) => events.push(e));
  let info = await sync.start();
  assert.deepStrictEqual([info.paired, info.state, info.device.name], [false, "off", "NODE on iPhone"]);
  assert.match(info.device.id, /^[0-9a-f]{16}$/);
  ok("off until a code is scanned; the phone has a random id and a name");

  let r = await sync.pair("https://example.com/not-a-code");
  assert.ok(!r.ok && /isn't a NODE sync code/.test(r.error));
  r = await sync.pair(code);
  assert.ok(r.ok && r.info.paired && r.info.state === "ok", JSON.stringify(r));
  assert.strictEqual(keychain.get(CODE_KEY), code, "the code is kept in the keychain");
  assert.ok(!storage.list().some((n) => (storage.read(n) || "").includes(code.split(":")[1])), "and nowhere else");
  await macRound();
  await sync.now();
  assert.strictEqual(trails.get(levain)?.trail.name, "Levain");
  assert.ok(trails.snapshot(levain).cards.some((c) => c.text === "Feed at 25°C"));
  assert.ok(sync.info().peers.some((p) => p.name === "Sven's MacBook" && p.kind === "desktop"));
  assert.ok(events.some((e) => e.type === "changed"));
  assert.deepStrictEqual([...sentTypes].sort(), ["application/json", "application/x-node-sync-b64url"]);
  ok("scanning the code pairs: the Mac's trail and name arrive; batches go as text");

  // A visit and a note on the phone reach the Mac, as a phone session.
  research.switchTo(levain);
  trails.visit(levain, "https://example.com/bus", { title: "Read on the bus" });
  trails.freeNote(levain, { x: 200, y: 0, text: "From the phone" });
  await sync.now();
  await macRound();
  assert.ok(macStore.snapshot(levain).cards.some((c) => c.text === "From the phone"));
  assert.ok(macStore.timeline(levain).some((s) => s.device === "phone"));
  ok("the phone's visit and note reach the Mac");

  // The Mac renames the open trail: the research store picks it up.
  clock += 60000;
  macStore.rename(levain, "Levain, Mac name");
  await macRound();
  await sync.now();
  assert.strictEqual(research.current.name, "Levain, Mac name");
  ok("a rename on the Mac shows on the phone's open trail");

  // The Mac deletes the phone's open trail.
  clock += 60000;
  macStore.remove(levain);
  await macRound();
  events.length = 0;
  await sync.now();
  assert.ok(!trails.has(levain) && research.current.id !== levain, "deleted here, and the phone moved to another trail");
  const del = events.find((e) => e.type === "deleted");
  assert.deepStrictEqual(del?.trails.map((t) => [t.name, t.byName]), [["Levain, Mac name", "Sven's MacBook"]]);
  ok("a trail deleted on the Mac goes here, with the Mac's name for the notice");

  // Restart: pairing and progress are kept.
  sync = createSync({ storage, trails, research, secret, fetch: phoneFetch, api: "https://relay.test", now });
  info = await sync.start();
  assert.ok(info.paired && info.peers.length === 1);
  await sync.now();
  assert.strictEqual(sync.info().state, "ok");
  ok("after a restart the phone is still paired");

  // Removed on the Mac: told to scan again. Stop syncing clears the code.
  await mac.client.leave(info.device.id);
  await sync.now();
  assert.strictEqual(sync.info().state, "unpaired");
  info = await sync.stop();
  assert.ok(!info.paired && !keychain.has(CODE_KEY) && storage.read("sync/state.json") === null);
  ok("removed on the Mac: the phone is told; Stop syncing clears the code and state");

  console.log(`\n${passed} checks passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
