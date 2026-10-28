// The share-link Worker (worker/src/index.js) with an in-memory R2 bucket.
//   node test/share-worker-demo.js
const assert = require("assert");
const ok = (name) => console.log("ok  ", name);

function memoryBucket() {
  const items = new Map();
  return {
    items,
    async put(key, body, opts) { items.set(key, { bytes: new Uint8Array(body), customMetadata: opts.customMetadata }); },
    async get(key) {
      const it = items.get(key);
      if (!it) return null;
      return { customMetadata: it.customMetadata, body: new Blob([it.bytes]).stream(), arrayBuffer: async () => it.bytes.buffer.slice(0) };
    },
    async delete(key) { items.delete(key); },
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
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
