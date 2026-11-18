// The share-link Worker (worker/src/index.js) with an in-memory R2 bucket.
//   node test/share-worker-demo.js
const assert = require("assert");
const ok = (name) => console.log("ok  ", name);

function memoryBucket() {
  const items = new Map();
  return {
    items,
    async put(key, body, opts) { items.set(key, { bytes: new Uint8Array(body), customMetadata: opts?.customMetadata }); },
    async get(key) {
      const it = items.get(key);
      if (!it) return null;
      return { customMetadata: it.customMetadata, body: new Blob([it.bytes]).stream(), arrayBuffer: async () => it.bytes.buffer.slice(0) };
    },
    async delete(key) { items.delete(key); },
    // R2 list(): keys in order, after startAfter, 2 a page to test paging.
    async list({ prefix = "", cursor, startAfter } = {}) {
      const keys = [...items.keys()].filter((k) => k.startsWith(prefix) && (!startAfter || k > startAfter)).sort();
      const at = cursor ? Number(cursor) : 0;
      const page = keys.slice(at, at + 2);
      return { objects: page.map((key) => ({ key })), truncated: at + 2 < keys.length, cursor: String(at + 2) };
    },
  };
}

(async () => {
  const { default: worker } = await import("../worker/src/index.js");
  const MAX_BYTES = 1024 * 1024; // as in the Worker
  const env = { TRAILS: memoryBucket() };
  const call = (path, init) => worker.fetch(new Request("https://node-share.example.workers.dev" + path, init), env);
  const sealed = new Uint8Array([0x4e, 0x54, 0x31, ...new Uint8Array(12 + 40).fill(7)]);

  let r = await call("/api/trails", { method: "POST", body: sealed });
  assert.strictEqual(r.status, 201);
  const made = await r.json();
  assert.ok(/^[A-Za-z0-9]{16}$/.test(made.id) && made.deleteToken.length === 32 && made.expiresAt > Date.now() + 29 * 864e5);
  ok("an encrypted trail is stored; the reply has an id, a delete key and the expiry");

  const meta = env.TRAILS.items.get(`t/${made.id}`).customMetadata;
  assert.ok(!JSON.stringify(meta).includes(made.deleteToken));
  ok("the delete key itself is not stored, only its hash");

  r = await call(`/api/trails/${made.id}`);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(new Uint8Array(await r.arrayBuffer()), sealed);
  ok("NODE gets the same bytes back");

  r = await call(`/t/${made.id}`);
  const html = await r.text();
  assert.ok(r.status === 200 && /Open in NODE/.test(html) && html.includes(Buffer.from(sealed).toString("base64")));
  assert.ok(/script-src 'nonce-/.test(r.headers.get("content-security-policy")) && r.headers.get("referrer-policy") === "no-referrer" && /noindex/.test(r.headers.get("x-robots-tag")));
  ok("the web page carries the encrypted trail, a strict content policy, no referrer, not indexed");

  r = await call("/api/trails", { method: "POST", body: new TextEncoder().encode("# plain text trail") });
  assert.strictEqual(r.status, 400);
  r = await call("/api/trails", { method: "POST", body: new Uint8Array(MAX_BYTES + 1).fill(0x4e) });
  assert.strictEqual(r.status, 413);
  ok("anything not encrypted by NODE, or over 1 MB, is refused");

  r = await call(`/api/trails/${made.id}`, { method: "DELETE", headers: { authorization: "Bearer wrongwrongwrongwrongwrongwrong12" } });
  assert.strictEqual(r.status, 403);
  r = await call(`/api/trails/${made.id}`, { method: "DELETE", headers: { authorization: `Bearer ${made.deleteToken}` } });
  assert.strictEqual(r.status, 204);
  r = await call(`/api/trails/${made.id}`);
  assert.strictEqual(r.status, 404);
  r = await call(`/t/${made.id}`);
  assert.ok(r.status === 404 && /expired or was removed/.test(await r.text()));
  ok("only the delete key removes a link; after that it is gone");

  r = await call("/api/trails", { method: "POST", body: sealed });
  const old = await r.json();
  env.TRAILS.items.get(`t/${old.id}`).customMetadata.created = String(Date.now() - 31 * 864e5);
  assert.strictEqual((await call(`/api/trails/${old.id}`)).status, 404);
  ok("a trail older than 30 days is not served, even before the lifecycle rule deletes it");

  assert.strictEqual((await call("/api/trails/../../etc")).status, 404);
  assert.strictEqual((await call("/robots.txt")).status, 200);
  env.UPLOAD_LIMIT = { limit: async () => ({ success: false }) };
  assert.strictEqual((await call("/api/trails", { method: "POST", body: sealed })).status, 429);
  ok("bad ids, robots.txt, and the upload limit");

  // ---- Daily active count (B116) ----
  const countReq = (body, headers = {}) => call("/api/active", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9", ...headers }, body: JSON.stringify(body) });
  assert.strictEqual((await countReq({ v: "0.11.0", os: "mac", w: true, m: true })).status, 204);
  assert.strictEqual((await countReq({ v: "0.11.0", os: "windows", w: false, m: false })).status, 204);
  assert.strictEqual((await countReq({ v: "0.10.0", os: "windows", w: true, m: false })).status, 204);
  const keys = [...env.TRAILS.items.keys()].filter((k) => k.startsWith("a/"));
  const today = new Date().toISOString().slice(0, 10);
  assert.strictEqual(keys.length, 3);
  assert.ok(keys.every((k) => new RegExp(`^a/${today}/(mac|windows)/0\\.1[01]\\.0/[w-][m-]/[A-Za-z0-9]{12}$`).test(k)), keys.join());
  assert.ok(keys.every((k) => env.TRAILS.items.get(k).bytes.length === 0 && !env.TRAILS.items.get(k).customMetadata), "nothing in the object");
  assert.ok(!JSON.stringify([...env.TRAILS.items]).includes("203.0.113.9"), "the address is not stored");
  ok("a count is one empty object named by day, OS, version and the week and month marks; no address");

  for (const bad of [{ v: "0.11.0", os: "mac", w: true }, { v: "<script>", os: "mac", w: true, m: true }, { v: "0.11.0", os: "beos", w: true, m: true }, { v: "0.11.0", os: "mac", w: "yes", m: true }]) assert.strictEqual((await countReq(bad)).status, 400, JSON.stringify(bad));
  assert.strictEqual((await call("/api/active", { method: "POST", body: "{" })).status, 400);
  ok("anything but a version, an OS and two marks is refused");

  assert.strictEqual((await call("/api/active")).status, 403, "no token set: counts can't be read");
  env.STATS_TOKEN = "secret-token-for-tests";
  assert.strictEqual((await call("/api/active", { headers: { authorization: "Bearer wrong" } })).status, 403);
  r = await call("/api/active?days=7", { headers: { authorization: "Bearer secret-token-for-tests" } });
  assert.strictEqual(r.status, 200);
  const stats = await r.json();
  assert.deepStrictEqual(stats.days[today], { total: 3, os: { mac: 1, windows: 2 }, versions: { "0.10.0": 1, "0.11.0": 2 } });
  assert.strictEqual(Object.values(stats.weeks)[0], 2, "weekly users: counts marked first this week");
  assert.deepStrictEqual(stats.months, { [today.slice(0, 7)]: 1 });
  ok("with the token, counts per day (by OS and version), week and month");

  env.COUNT_LIMIT = { limit: async () => ({ success: false }) };
  assert.strictEqual((await countReq({ v: "0.11.0", os: "mac", w: true, m: true })).status, 429);
  ok("the count limit");

  // ---- Sync relay (B50) ----
  {
    const Crypto = require("../core/sync-crypto");
    const keys = Crypto.keysFrom(Crypto.newPairingCode());
    const G = keys.group;
    const auth = { authorization: `Bearer ${keys.auth}`, "content-type": "application/json" };
    const mac = "aaaaaaaaaaaaaaaa";
    const phone = "bbbbbbbbbbbbbbbb";
    const sjson = async (path, init) => {
      const res = await call(`/api/sync/${G}/${path}`, init);
      return { status: res.status, body: res.headers.get("content-type")?.includes("json") ? await res.json() : null, res };
    };
    const join = (device, headers = auth) => sjson("join", { method: "POST", headers, body: JSON.stringify({ device }) });
    let j = await join(mac);
    assert.deepStrictEqual([j.status, j.body.devices, j.body.joined, j.body.missed], [200, 1, true, false]);
    const stored = JSON.stringify([...env.TRAILS.items].filter(([k]) => k.startsWith("s/")));
    assert.ok(!stored.includes(keys.auth), "the token itself is not stored");
    assert.strictEqual((await join(phone, { ...auth, authorization: `Bearer ${"0".repeat(64)}` })).status, 403);
    j = await join(phone);
    assert.deepStrictEqual([j.status, j.body.devices], [200, 2]);
    ok("sync: the first join makes the group; another device joins with the same token; a wrong token is refused");

    const sealed = (obj) => Crypto.seal(obj, keys.key); // a promise; awaited where used
    const post = async (device, bytes) => sjson(`batches?device=${device}`, { method: "POST", headers: { authorization: auth.authorization }, body: await bytes });
    const b1 = await post(mac, sealed({ hello: 1 }));
    const b2 = await post(mac, sealed({ hello: 2 }));
    const b3 = await post(phone, sealed({ hello: 3 }));
    assert.ok(b1.status === 201 && /^\d{13}-[A-Za-z0-9]{8}-a{16}$/.test(b1.body.batch), JSON.stringify(b1.body));
    assert.strictEqual((await post(mac, new TextEncoder().encode('{"plain":"text"}'))).status, 400, "only sealed batches");
    assert.strictEqual((await post("cccccccccccccccc", sealed({}))).status, 403, "only paired devices");
    ok("sync: paired devices post sealed batches; plain text and unknown devices are refused");

    let list = await sjson(`batches?device=${phone}`, { headers: auth });
    assert.deepStrictEqual(list.body.batches.slice().sort(), [b1.body.batch, b2.body.batch].sort(), "the phone sees the Mac's batches, not its own");
    assert.strictEqual(list.body.last, [b1.body.batch, b2.body.batch, b3.body.batch].sort().at(-1));
    const got = await call(`/api/sync/${G}/batches/${b2.body.batch}?device=${phone}`, { headers: auth });
    assert.deepStrictEqual(await Crypto.open(new Uint8Array(await got.arrayBuffer()), keys.key), { hello: 2 });
    ok("sync: a device lists the other devices' batches and gets the bytes back");

    let ack = await sjson(`ack?device=${phone}`, { method: "POST", headers: auth, body: JSON.stringify({ upTo: list.body.last }) });
    assert.strictEqual(ack.body.deleted, 2, "the Mac's two batches: the only other device has them");
    assert.ok(env.TRAILS.items.has(`s/b/${G}/${b3.body.batch}`), "the phone's own batch waits for the Mac");
    list = await sjson(`batches?device=${mac}`, { headers: auth });
    assert.deepStrictEqual(list.body.batches, [b3.body.batch]);
    ack = await sjson(`ack?device=${mac}`, { method: "POST", headers: auth, body: JSON.stringify({ upTo: list.body.last }) });
    assert.strictEqual(ack.body.deleted, 1);
    assert.strictEqual([...env.TRAILS.items.keys()].filter((k) => k.startsWith(`s/b/${G}/`)).length, 0);
    list = await sjson(`batches?device=${phone}`, { headers: auth });
    assert.deepStrictEqual(list.body.batches, []);
    ok("sync: a batch is deleted once every other device has it");

    // A check with nothing new is one read of the "newest batch" marker, not a
    // list; full=1 lists anyway; a new batch is seen at once.
    let lists = 0;
    const realList = env.TRAILS.list;
    env.TRAILS.list = (o) => (lists++, realList.call(env.TRAILS, o));
    list = await sjson(`batches?device=${phone}`, { headers: auth });
    assert.deepStrictEqual([list.body.batches, lists], [[], 0]);
    await sjson(`batches?device=${phone}&full=1`, { headers: auth });
    assert.strictEqual(lists, 1, "full=1 lists anyway");
    const b4 = await post(mac, Crypto.seal({ hello: 4 }, keys.key));
    list = await sjson(`batches?device=${phone}`, { headers: auth });
    assert.deepStrictEqual(list.body.batches, [b4.body.batch]);
    env.TRAILS.list = realList;
    ack = await sjson(`ack?device=${phone}`, { method: "POST", headers: auth, body: JSON.stringify({ upTo: list.body.last }) });
    assert.strictEqual(ack.body.deleted, 1);
    ok("sync: a check with nothing new reads one marker instead of listing; a new batch shows at once");

    // A device away for over 30 days is told it missed batches.
    const rec = env.TRAILS.items.get(`s/d/${G}/${phone}`);
    rec.customMetadata.seen = String(Date.now() - 31 * 864e5);
    j = await join(phone);
    assert.strictEqual(j.body.missed, true);
    // An old batch is refused even if the lifecycle rule has not run yet.
    const oldName = `${String(Date.now() - 31 * 864e5)}-AAAAAAAA-${mac}`;
    env.TRAILS.items.set(`s/b/${G}/${oldName}`, { bytes: await sealed({ old: 1 }) });
    assert.strictEqual((await call(`/api/sync/${G}/batches/${oldName}?device=${phone}`, { headers: auth })).status, 404);
    assert.deepStrictEqual((await sjson(`batches?device=${phone}`, { headers: auth })).body.batches, []);
    ok("sync: a device back after 30 days is told it missed batches; batches over 30 days old are gone");

    const devs = await sjson(`devices?device=${mac}`, { headers: auth });
    assert.deepStrictEqual(devs.body.devices.map((d) => d.id).sort(), [mac, phone]);
    assert.ok(!JSON.stringify(devs.body).includes("cursor"));
    assert.strictEqual((await call(`/api/sync/${G}/devices/${phone}?device=${mac}`, { method: "DELETE", headers: auth })).status, 204);
    assert.strictEqual((await post(phone, sealed({}))).status, 403, "an unpaired device can't post");
    await post(mac, sealed({ x: 1 }));
    assert.strictEqual((await call(`/api/sync/${G}/devices/${mac}?device=${mac}`, { method: "DELETE", headers: auth })).status, 204);
    assert.strictEqual([...env.TRAILS.items.keys()].filter((k) => k.includes(G)).length, 0, "the last device leaving removes the group");
    ok("sync: unpairing removes a device; when the last one leaves, nothing of the group is kept");

    env.SYNC_LIMIT = { limit: async () => ({ success: false }) };
    assert.strictEqual((await join(mac)).status, 429);
    delete env.SYNC_LIMIT;
    assert.strictEqual((await call(`/api/sync/not-a-group/join`, { method: "POST" })).status, 404);
    ok("sync: the rate limit; bad group ids are not found");
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
