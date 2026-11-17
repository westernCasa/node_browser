// Sync between paired devices (B50): core/sync.js and core/sync-crypto.js.
// Two trail stores (a Mac and a phone) sync through sealed batches, as they
// would through the relay.
// Run: npm run test:sync
const assert = require("assert");
const { TrailStore } = require("../core/trail");
const { memoryStorage } = require("../core/storage");
const { SyncEngine } = require("../core/sync");
const Crypto = require("../core/sync-crypto");

let n = 0;
const ok = (name) => console.log(`ok ${++n} - ${name}`);

// ---- pairing and encryption ----
const code = Crypto.newPairingCode();
{
  assert.match(code, /^NODE-SYNC1:[A-Za-z0-9_-]{43}$/);
  const a = Crypto.keysFrom(code);
  const b = Crypto.keysFrom(` ${code}\n`.trim());
  assert.strictEqual(a.group, b.group);
  assert.strictEqual(a.auth, b.auth);
  assert.deepStrictEqual([...a.key], [...b.key]);
  assert.match(a.group, /^[0-9a-f]{32}$/);
  assert.match(a.auth, /^[0-9a-f]{64}$/);
  assert.notStrictEqual(a.group, a.auth.slice(0, 32));
  assert.strictEqual(Crypto.authHash(a.auth).length, 64);
  assert.notStrictEqual(Crypto.keysFrom(Crypto.newPairingCode()).group, a.group, "each code is its own group");
  assert.strictEqual(Crypto.parsePairingCode("NODE-SYNC1:short"), null);
  assert.strictEqual(Crypto.parsePairingCode("https://example.com"), null);
  assert.throws(() => Crypto.keysFrom("nonsense"), /not a NODE sync code/);
  const bytes = Crypto.seal({ hello: "rye", n: [1, 2] }, a.key);
  assert.deepStrictEqual(Crypto.open(bytes, a.key), { hello: "rye", n: [1, 2] });
  assert.ok(!Buffer.from(bytes).toString("latin1").includes("rye"), "the server sees no text");
  assert.throws(() => Crypto.open(bytes, Crypto.keysFrom(Crypto.newPairingCode()).key), /could not be decrypted/);
  const bad = Uint8Array.from(bytes);
  bad[40] ^= 1;
  assert.throws(() => Crypto.open(bad, a.key), /could not be decrypted/);
  ok("a pairing code gives the same group, token and key on both devices; batches are sealed and checked");
}

// ---- two devices ----
const keys = Crypto.keysFrom(code);
let clock = new Date(2026, 10, 16, 20, 0).getTime();
const now = () => clock;
const mkDevice = (device, sid) => {
  const store = new TrailStore(memoryStorage(), { device, now });
  const syncStorage = memoryStorage();
  return { store, syncStorage, engine: new SyncEngine(store, syncStorage, { device: sid, now }) };
};
const mac = mkDevice("desktop", "aaaa");
const phone = mkDevice("phone", "bbbb");
phone.store.current(); // the phone has its own trail open
// The relay: sealed batches, in order, never back to the sender.
const relay = [];
const push = (d) => {
  for (const b of d.engine.outgoing()) relay.push({ from: d.engine.device, bytes: Crypto.seal(b, keys.key) });
  d.engine.sent();
};
const pull = (d, seen) => {
  const out = [];
  for (let i = seen.n; i < relay.length; i++) if (relay[i].from !== d.engine.device) out.push(d.engine.apply(Crypto.open(relay[i].bytes, keys.key)));
  seen.n = relay.length;
  return out;
};
const macSeen = { n: 0 };
const phoneSeen = { n: 0 };
const syncBoth = () => {
  push(mac);
  pull(phone, phoneSeen);
  push(phone);
  return pull(mac, macSeen);
};
const tick = (ms = 60000) => (clock += ms);

// The Mac has a trail with pages, a link, a group and a note.
const rye = mac.store.current().trail.id;
mac.store.rename(rye, "Rye breads");
const visit = (d, tid, url, title, card = true) => {
  d.store.visit(tid, url, { title });
  tick(30000);
  if (card) return d.store.placePage(tid, url, { title, x: 0, y: 0 });
  d.store.bounce(tid, url, 30000);
  return null;
};
const p1 = visit(mac, rye, "https://example.com/hydration", "Hydration for rye");
const p2 = visit(mac, rye, "https://example.com/enzymes", "Rye and enzymes");
visit(mac, rye, "https://example.com/quick", "Quick look", false);
const ln = mac.store.link(rye, p1.id, p2.id, { kind: "you", label: "supports" });
const g = mac.store.groupAround(rye, { x: -20, y: -20, w: 700, h: 400 }, { label: "Science" });
mac.store.freeNote(rye, { x: 400, y: 400, text: "Try 80% hydration" });
mac.store.setView(rye, { x: 120, y: -40, z: 0.5 });
{
  const before = JSON.stringify(mac.store.snapshot(rye).cards);
  syncBoth();
  const got = phone.store.snapshot(rye);
  assert.ok(phone.store.has(rye), "the phone has the trail");
  assert.strictEqual(got.trail.name, "Rye breads");
  assert.strictEqual(JSON.stringify(got.cards), before, "the same cards, in the same order");
  assert.deepStrictEqual(got.lines.find((l) => l.id === ln.id)?.label, "supports");
  assert.strictEqual(got.groups.find((x) => x.id === g.id)?.label, "Science");
  assert.deepStrictEqual(phone.store.events(rye).map((e) => e.id), mac.store.events(rye).map((e) => e.id), "every event, same ids");
  assert.ok(phone.store.timeline(rye).flatMap((s) => s.items).some((i) => i.title === "Quick look" && i.timelineOnly), "timeline-only visits too");
  assert.deepStrictEqual(phone.store.view(rye).z, 1, "the canvas position and zoom stay per device");
  assert.notStrictEqual(phone.store.index.current, rye, "the phone stays on the trail it had open");
  ok("a trail on the Mac arrives on the phone: cards, lines, groups, notes, events, timeline; not the view");
}
{
  const before = relay.length;
  const out = syncBoth();
  assert.strictEqual(mac.engine.pending(), 0);
  assert.strictEqual(relay.length, before, `nothing new to send: ${relay.length - before}`);
  assert.deepStrictEqual(out, []);
  ok("nothing changed: nothing is sent, and nothing echoes back");
}
// Both sides work offline, then sync.
tick();
const phonePage = visit(phone, rye, "https://example.com/phone-find", "Found on the phone");
phone.store.renameGroup(rye, g.id, "Enzymes and acids");
tick();
mac.store.freeNote(rye, { x: 800, y: 0, text: "Ask the miller" });
tick();
mac.store.renameGroup(rye, g.id, "Acids (Mac, later)");
{
  syncBoth();
  push(mac);
  pull(phone, phoneSeen);
  for (const d of [mac, phone]) {
    const s = d.store.snapshot(rye);
    assert.ok(s.cards.some((c) => c.id === phonePage.id), `${d.store.device}: the phone's page`);
    assert.ok(s.cards.some((c) => c.text === "Ask the miller"), `${d.store.device}: the Mac's note`);
    assert.strictEqual(s.groups.find((x) => x.id === g.id).label, "Acids (Mac, later)", `${d.store.device}: the later rename wins`);
  }
  const byId = (d) => d.store.snapshot(rye).cards.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  assert.deepStrictEqual(byId(mac), byId(phone), "both end with the same cards");
  assert.ok(phone.store.timeline(rye).some((s) => s.device === "phone") && mac.store.timeline(rye).some((s) => s.device === "phone"), "the phone's visits show as phone sessions on the Mac");
  ok("both sides offline: new things from both are kept; the same group renamed on both: the later edit wins");
}
// The same card moved on both: the later move wins, and a local edit made
// after the remote one is not overwritten.
{
  tick();
  phone.store.moveCard(rye, p1.id, 10, 10);
  tick();
  mac.store.moveCard(rye, p1.id, 500, 500);
  push(phone); // the phone's earlier move reaches the relay first
  pull(mac, macSeen);
  assert.strictEqual(mac.store.card(rye, p1.id).x, 500, "the Mac's later move is kept");
  push(mac);
  pull(phone, phoneSeen);
  assert.strictEqual(phone.store.card(rye, p1.id).x, 500, "and wins on the phone");
  ok("a card moved on both devices ends where it was moved last");
}
// Deleting a trail deletes it everywhere; Undo brings it back everywhere.
const other = phone.store.create("Starters").trail.id;
visit(phone, other, "https://example.com/starter", "Starter smells");
syncBoth();
assert.ok(mac.store.has(other));
{
  tick();
  mac.store.remove(other);
  syncBoth();
  const res = pull(phone, phoneSeen);
  assert.ok(!phone.store.has(other), "deleted on the phone too");
  assert.ok(phone.store.deletedIds().includes(other), "kept until purge, for Undo");
  tick();
  mac.store.restore(other);
  push(mac);
  const back = pull(phone, phoneSeen);
  assert.ok(phone.store.has(other) && back.some((r) => r.restored.includes(other)), JSON.stringify(back));
  assert.notStrictEqual(phone.store.index.current, other, "brought back, not opened");
  // The phone had already purged the files: the Mac sends everything again.
  tick();
  mac.store.remove(other);
  push(mac);
  pull(phone, phoneSeen);
  phone.store.purge();
  assert.ok(!phone.store.get(other), "files gone on the phone");
  tick();
  mac.store.restore(other);
  push(mac);
  pull(phone, phoneSeen);
  assert.strictEqual(phone.store.get(other)?.trail.name, "Starters");
  assert.ok(phone.store.snapshot(other).cards.some((c) => c.title === "Starter smells"));
  assert.ok(res !== undefined);
  ok("deleting a trail deletes it on the other device; Undo brings it back, even after its files were removed");
}
// Changes made while a trail is deleted elsewhere do not bring it back.
{
  tick();
  phone.store.remove(other);
  push(phone);
  tick();
  mac.store.freeNote(other, { x: 0, y: 0, text: "late note" });
  pull(mac, macSeen);
  assert.ok(!mac.store.has(other), "deleted on the Mac, though it had a newer note");
  push(mac);
  pull(phone, phoneSeen);
  assert.ok(!phone.store.has(other));
  ok("a trail deleted on one device stays deleted, even with later edits elsewhere");
}
// A third device paired later gets everything.
{
  const ipad = mkDevice("phone", "cccc");
  mac.engine.resetAll();
  push(mac);
  const seen = { n: 0 };
  pull(ipad, seen);
  assert.strictEqual(ipad.store.get(rye)?.trail.name, "Rye breads");
  const sorted = (d) => d.store.snapshot(rye).cards.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  assert.deepStrictEqual(sorted(ipad), sorted(mac));
  assert.ok(!ipad.store.has(other), "not the deleted trail");
  ok("a newly paired device gets every trail from a full resend");
}

// A full resend keeps each item's time: an old copy doesn't beat a newer edit.
{
  tick();
  phone.store.renameGroup(rye, g.id, "Phone, newest");
  push(phone);
  pull(mac, macSeen);
  tick();
  phone.store.renameGroup(rye, g.id, "Phone, newer still");
  // The Mac resends everything before it has the phone's last rename.
  mac.engine.resetAll();
  push(mac);
  pull(phone, phoneSeen);
  assert.strictEqual(phone.store.get(rye).groups.find((x) => x.id === g.id).label, "Phone, newer still");
  push(phone);
  pull(mac, macSeen);
  assert.strictEqual(mac.store.get(rye).groups.find((x) => x.id === g.id).label, "Phone, newer still");
  ok("a full resend sends items with their own times, so it never undoes a newer edit");
}
// Nothing unsafe arrives, and the outbox survives a restart.
{
  const bad = { changes: [{ t: rye, k: "c:x1", v: { id: "x1", kind: "page", url: "https://accounts.google.com/signin", x: 0, y: 0, w: 1, h: 1 }, at: clock + 9e9, by: "zzzz" }], events: [{ t: rye, e: { id: "e-bad", at: clock, type: "opened", data: { url: "https://accounts.google.com/x" } } }, { t: rye, e: { id: "e-odd", at: clock, type: "deleted-everything" } }], life: [] };
  mac.engine.apply(bad);
  assert.ok(!mac.store.card(rye, "x1"), "a sign-in page never becomes a card (B66)");
  assert.ok(!mac.store.events(rye).some((e) => e.id === "e-bad" || e.id === "e-odd"));
  tick();
  mac.store.freeNote(rye, { x: 0, y: 900, text: "not sent yet" });
  mac.engine.collect();
  const again = new SyncEngine(mac.store, mac.syncStorage, { device: "aaaa", now });
  assert.ok(again.pending() > 0, "the stamped change is still waiting after a restart");
  const batches = again.outgoing();
  assert.ok(batches.some((b) => b.changes.some((c) => c.v?.text === "not sent yet")));
  ok("sign-in pages and unknown events from another device are refused; unsent changes survive a restart");
}
// Big trails go in several batches.
{
  const big = mac.store.create("Big").trail.id;
  for (let i = 0; i < 1500; i++) mac.store.freeNote(big, { x: i, y: 0, text: `note ${i} ${"x".repeat(200)}` });
  const batches = mac.engine.outgoing();
  assert.ok(batches.length > 1, String(batches.length));
  assert.ok(batches.every((b) => JSON.stringify(b).length < 450 * 1024));
  mac.engine.sent();
  ok(`a big trail goes in ${batches.length} batches, each under 450 KB`);
}

// Through the relay itself: the Worker's code with an in-memory bucket.
(async () => {
  const { RelayClient, syncOnce } = require("../core/sync-relay");
  const { default: worker } = await import("../worker/src/index.js");
  const items = new Map();
  const bucket = {
    async put(k, body, o) { items.set(k, { bytes: new Uint8Array(body), customMetadata: o?.customMetadata }); },
    async get(k) { const it = items.get(k); return it ? { customMetadata: it.customMetadata, body: new Blob([it.bytes]).stream(), arrayBuffer: async () => it.bytes.buffer.slice(0) } : null; },
    async delete(k) { items.delete(k); },
    async list({ prefix = "", startAfter } = {}) { return { objects: [...items.keys()].filter((k) => k.startsWith(prefix) && (!startAfter || k > startAfter)).sort().map((key) => ({ key })), truncated: false }; },
  };
  const env = { TRAILS: bucket };
  const fetchVia = (url, init = {}) => worker.fetch(new Request(url, init), env);
  const pairing = Crypto.newPairingCode();
  const k = Crypto.keysFrom(pairing);
  const dev = (kind, name) => {
    const id = Crypto.newDeviceId();
    const d = mkDevice(kind === "phone" ? "phone" : "desktop", id);
    d.client = new RelayClient({ api: "https://relay.test", group: k.group, auth: k.auth, device: id, fetch: fetchVia });
    d.relayState = {};
    d.round = () => syncOnce({ engine: d.engine, client: d.client, key: k.key, state: d.relayState, me: { name, kind }, now });
    return d;
  };
  const mbp = dev("desktop", "Sven's MacBook Pro");
  const iphone = dev("phone", "Sven's iPhone");
  iphone.client.text = true; // as on the phone: batches as base64url text
  const t1 = mbp.store.current().trail.id;
  mbp.store.rename(t1, "Levain");
  mbp.store.freeNote(t1, { x: 0, y: 0, text: "Feed at 25°C" });
  iphone.store.current();
  const iphoneOwn = iphone.store.create("On the bus").trail.id;
  iphone.store.freeNote(iphoneOwn, { x: 0, y: 0, text: "Look up rye malt" });

  // The Mac pairs first (alone: nothing to keep), then the phone scans.
  let r = await mbp.round();
  assert.ok(r.sent >= 1);
  r = await iphone.round(); // joins, sends everything and asks for everything
  r = await mbp.round();
  assert.ok(mbp.store.snapshot(iphoneOwn)?.cards.some((c) => c.text === "Look up rye malt"), "the phone's own trail reached the Mac");
  assert.deepStrictEqual(mbp.relayState.peers[iphone.engine.device], { name: "Sven's iPhone", kind: "phone", at: clock });
  r = await iphone.round();
  assert.ok(iphone.store.get(t1)?.trail.name === "Levain" && r.added.includes(t1), JSON.stringify(r));
  assert.strictEqual(iphone.relayState.peers[mbp.engine.device].name, "Sven's MacBook Pro");
  ok("through the relay: pairing sends everything both ways, with each device's name (encrypted)");

  tick();
  iphone.store.rename(iphoneOwn, "On the bus, renamed");
  await iphone.round();
  r = await mbp.round();
  assert.strictEqual(mbp.store.get(iphoneOwn).trail.name, "On the bus, renamed");
  assert.deepStrictEqual(r.trails, [iphoneOwn]);
  const left = [...items.keys()].filter((key) => key.startsWith("s/b/"));
  await iphone.round();
  assert.ok([...items.keys()].filter((key) => key.startsWith("s/b/")).length <= left.length, "batches every device has are deleted");
  const stored = Buffer.concat([...items.values()].map((v) => Buffer.from(v.bytes))).toString("latin1") + JSON.stringify([...items].map(([key, v]) => [key, v.customMetadata]));
  assert.ok(!/Levain|rye malt|MacBook|iPhone/.test(stored), "the relay holds no names, notes or titles");
  ok("a rename on the phone reaches the Mac; the relay holds nothing readable");

  await iphone.client.leave(mbp.engine.device);
  await assert.rejects(mbp.round().then(() => mbp.client.post(Crypto.seal({}, k.key))), (e) => e.unpaired === true);
  ok("an unpaired device is told to pair again");
  console.log(`\n${n} checks passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
