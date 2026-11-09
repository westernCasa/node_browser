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
  const { default: worker, MAX_BYTES } = await import("../worker/src/index.js");
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
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
