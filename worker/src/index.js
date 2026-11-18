// NODE share links (B82 phase 2, docs/19-trail-sharing.md).
//
// Stores trails that NODE encrypted on the sender's computer. The key is in the
// part of the link after "#", which browsers never send, so this server only
// ever holds data it cannot read. Each trail is deleted after 30 days (an R2
// lifecycle rule, and a date check here in case the rule runs late).
//
// POST   /api/trails        body: the encrypted trail (at most 1 MB)
//                           → { id, deleteToken, expiresAt }
// GET    /api/trails/:id    → the encrypted trail (for NODE)
// DELETE /api/trails/:id    Authorization: Bearer <deleteToken> → 204
// GET    /t/:id             → a page that decrypts and shows the trail in the
//                             browser, with Open in NODE and Download NODE
//
// POST   /api/active        body: { v, os, w, m } → 204. The daily active
//                           count (B116): one empty object per count, named by
//                           the day, OS, version and the week and month marks.
//                           No id, no address, nothing else.
// GET    /api/active        Authorization: Bearer <STATS_TOKEN> → counts per
//                           day, ISO week and month (?days=, at most 400)
//
// /api/sync/:group/…        The sync relay (B50): join, batches, ack,
//                           devices. Authorization: Bearer <token derived from
//                           the pairing code>. Batches are encrypted on the
//                           devices; see the "Sync relay" section below.
//
// Bindings (wrangler.toml): TRAILS (R2 bucket), UPLOAD_LIMIT and COUNT_LIMIT
// (rate limiters, optional), SYNC_LIMIT (rate limiter, optional), STATS_TOKEN (secret, optional: without it the
// counts can't be read here). Nothing else is stored: no names, no addresses,
// no logs of what is inside.

// Only the default export may be exported: newer Cloudflare runtimes refuse a
// Worker with other named exports ("Incorrect type for map entry").
const MAX_BYTES = 1024 * 1024;
const DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const ID = /^[A-Za-z0-9]{16}$/;
const MAGIC = [0x4e, 0x54, 0x31]; // "NT1": NODE trail, format 1

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function randomString(n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let out = "";
  for (const b of bytes) out += ALPHABET[b % 62];
  return out;
}
async function sha256(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
const fail = (status, error) => json({ error }, status);

async function readTrail(env, id) {
  if (!ID.test(id)) return null;
  const obj = await env.TRAILS.get(`t/${id}`);
  if (!obj) return null;
  const created = Number(obj.customMetadata?.created || 0);
  if (!created || Date.now() - created > DAYS * DAY_MS) return null;
  return { obj, created };
}

async function upload(request, env) {
  if (env.UPLOAD_LIMIT) {
    const who = request.headers.get("cf-connecting-ip") || "unknown";
    const { success } = await env.UPLOAD_LIMIT.limit({ key: who });
    if (!success) return fail(429, "Too many links made from here in the last minute. Try again shortly.");
  }
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BYTES) return fail(413, "This trail is too large to share as a link (over 1 MB). Save it as a file instead.");
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length > MAX_BYTES) return fail(413, "This trail is too large to share as a link (over 1 MB). Save it as a file instead.");
  // Only NODE's encrypted format is accepted: the magic bytes, a 12-byte IV
  // and at least an AES-GCM tag.
  if (body.length < 3 + 12 + 16 || MAGIC.some((b, i) => body[i] !== b)) return fail(400, "This is not an encrypted NODE trail.");
  const id = randomString(16);
  const deleteToken = randomString(32);
  const created = Date.now();
  await env.TRAILS.put(`t/${id}`, body, {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: { created: String(created), del: await sha256(deleteToken) },
  });
  return json({ id, deleteToken, expiresAt: created + DAYS * DAY_MS }, 201);
}

// ---- Sync relay (B50) ----
// Passes encrypted batches between a person's paired devices. The devices
// derive the group id and the token from the pairing code; the key that
// encrypts the batches never comes here (core/sync-crypto.js), so this server
// cannot read them. Stored in R2:
//   s/g/<group>             the token's SHA-256 (written at the first join)
//   s/d/<group>/<device>    a paired device: when it joined, was last seen,
//                           and the last batch it has (cursor)
//   s/b/<group>/<time>-<random>-<device>   a batch, as the device sealed it ("NS2")
//   s/h/<group>             the newest batch's name, so a check with nothing
//                           new is one read, not a list (devices check often)
// A batch is deleted once every other device has it, and after 30 days at
// most (lifecycle rule on s/b/, and a date check here). A device not seen for
// 30 days is told it missed batches, and asks the others to send everything.
// Batches made in the same millisecond may be listed in either order; that is
// fine, because every change carries its own time (core/sync.js).
const SYNC_GROUP = /^[0-9a-f]{32}$/;
const SYNC_DEVICE = /^[0-9a-f]{16}$/;
const SYNC_BATCH = /^\d{13}-[A-Za-z0-9]{8}-[0-9a-f]{16}$/;
const SYNC_MAGIC = [0x4e, 0x53, 0x32]; // "NS2": AES-256-GCM (core/sync-crypto.js)
const SYNC_DAYS = 30;
const toB64url = (bytes) => toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function fromB64urlBytes(text) {
  const t = String(text).trim();
  if (!/^[A-Za-z0-9_-]*$/.test(t) || t.length > (MAX_BYTES * 4) / 3 + 4) return null;
  try {
    const bin = atob(t.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((t.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
async function listAll(env, prefix, { startAfter, max = 5000 } = {}) {
  const out = [];
  let cursor;
  do {
    const page = await env.TRAILS.list({ prefix, cursor, startAfter: cursor ? undefined : startAfter });
    out.push(...page.objects.map((o) => o.key));
    cursor = page.truncated && out.length < max ? page.cursor : undefined;
  } while (cursor);
  return out;
}
async function syncDevices(env, group) {
  const out = [];
  for (const key of await listAll(env, `s/d/${group}/`, { max: 50 })) {
    const o = await env.TRAILS.get(key);
    if (o) out.push({ id: key.split("/").pop(), joined: Number(o.customMetadata?.joined || 0), seen: Number(o.customMetadata?.seen || 0), cursor: o.customMetadata?.cursor || "" });
  }
  return out;
}
async function syncDevice(env, group, id) {
  if (!SYNC_DEVICE.test(id)) return null;
  const o = await env.TRAILS.get(`s/d/${group}/${id}`);
  return o ? { id, joined: Number(o.customMetadata?.joined || 0), seen: Number(o.customMetadata?.seen || 0), cursor: o.customMetadata?.cursor || "" } : null;
}
const putDevice = (env, group, d) => env.TRAILS.put(`s/d/${group}/${d.id}`, new Uint8Array(0), { customMetadata: { joined: String(d.joined), seen: String(d.seen), cursor: d.cursor || "" } });
// Deletes the batches every other device has (devices not seen for 30 days
// do not hold them back).
async function syncClean(env, group, devices) {
  const live = devices.filter((d) => Date.now() - d.seen < SYNC_DAYS * DAY_MS);
  let n = 0;
  for (const key of await listAll(env, `s/b/${group}/`, { max: 1000 })) {
    const name = key.split("/").pop();
    const from = name.split("-")[2];
    const old = Date.now() - Number(name.slice(0, 13)) > SYNC_DAYS * DAY_MS;
    if (old || live.every((d) => d.id === from || d.cursor >= name)) {
      await env.TRAILS.delete(key);
      n++;
    }
  }
  return n;
}
async function sync(request, env, url, group, rest) {
  if (env.SYNC_LIMIT) {
    const { success } = await env.SYNC_LIMIT.limit({ key: request.headers.get("cf-connecting-ip") || "unknown" });
    if (!success) return fail(429, "Too many sync requests from here. NODE will try again shortly.");
  }
  if (!SYNC_GROUP.test(group)) return fail(404, "Not found.");
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!/^[0-9a-f]{64}$/.test(token)) return fail(401, "Pair this device again.");
  const hash = await sha256(token);
  const g = await env.TRAILS.get(`s/g/${group}`);
  const method = request.method;
  // Joining makes the group on first use.
  if (rest === "join" && method === "POST") {
    if (g && g.customMetadata?.auth !== hash) return fail(403, "Pair this device again.");
    let body;
    try {
      body = await request.json();
    } catch {
      return fail(400, "Not a join request.");
    }
    if (!SYNC_DEVICE.test(String(body?.device))) return fail(400, "Not a join request.");
    if (!g) await env.TRAILS.put(`s/g/${group}`, new Uint8Array(0), { customMetadata: { auth: hash, created: String(Date.now()) } });
    const devices = await syncDevices(env, group);
    const me = devices.find((d) => d.id === body.device);
    // A device back after 30 days missed batches: it should ask for everything.
    const missed = Boolean(me && Date.now() - me.seen > SYNC_DAYS * DAY_MS);
    await putDevice(env, group, { id: body.device, joined: me?.joined || Date.now(), seen: Date.now(), cursor: me?.cursor || "" });
    return json({ devices: devices.length + (me ? 0 : 1), missed, joined: !me });
  }
  if (!g || g.customMetadata?.auth !== hash) return fail(403, "Pair this device again.");
  const device = url.searchParams.get("device") || "";
  if (rest === "devices" && method === "GET") return json({ devices: (await syncDevices(env, group)).map(({ id, joined, seen }) => ({ id, joined, seen })) });
  const leave = rest.match(/^devices\/([0-9a-f]{16})$/);
  if (leave && method === "DELETE") {
    await env.TRAILS.delete(`s/d/${group}/${leave[1]}`);
    const left = (await syncDevices(env, group)).filter((d) => d.id !== leave[1]);
    if (!left.length) {
      for (const key of await listAll(env, `s/b/${group}/`)) await env.TRAILS.delete(key);
      await env.TRAILS.delete(`s/h/${group}`);
      await env.TRAILS.delete(`s/g/${group}`);
    } else await syncClean(env, group, left);
    return new Response(null, { status: 204 });
  }
  // One read for this device, not a list of all of them.
  const me = await syncDevice(env, group, device);
  if (!me) return fail(403, "This device was unpaired. Pair it again to sync.");
  if (rest === "batches" && method === "POST") {
    const length = Number(request.headers.get("content-length") || 0);
    if (length > MAX_BYTES) return fail(413, "Batch too large.");
    // Phones send the bytes as base64url text (not every phone fetch sends
    // binary bodies reliably).
    const text = /x-node-sync-b64url/.test(request.headers.get("content-type") || "");
    const body = text ? fromB64urlBytes(await request.text()) : new Uint8Array(await request.arrayBuffer());
    if (!body || body.length > MAX_BYTES) return fail(body ? 413 : 400, body ? "Batch too large." : "Not an encrypted NODE sync batch.");
    if (body.length < 3 + 12 + 16 || SYNC_MAGIC.some((b, i) => body[i] !== b)) return fail(400, "Not an encrypted NODE sync batch.");
    const name = `${String(Date.now()).padStart(13, "0")}-${randomString(8)}-${device}`;
    await env.TRAILS.put(`s/b/${group}/${name}`, body, { httpMetadata: { contentType: "application/octet-stream" } });
    await env.TRAILS.put(`s/h/${group}`, new Uint8Array(0), { customMetadata: { last: name } });
    return json({ batch: name }, 201);
  }
  if (rest === "batches" && method === "GET") {
    const after = url.searchParams.get("after") || me.cursor || "";
    // "Last seen" is written at most once an hour, to keep writes down.
    if (Date.now() - me.seen > 60 * 60 * 1000) await putDevice(env, group, { ...me, seen: Date.now() });
    // Nothing newer than this device's cursor: answer without listing. Two
    // batches sent at once can leave the marker one behind, so devices ask
    // for a full list now and then (full=1).
    const head = url.searchParams.get("full") ? null : await env.TRAILS.get(`s/h/${group}`);
    if (head && after && String(head.customMetadata?.last || "") <= after) return json({ batches: [], last: "", more: false });
    const keys = await listAll(env, `s/b/${group}/`, { startAfter: after ? `s/b/${group}/${after}` : undefined, max: 200 });
    const names = keys.map((k) => k.split("/").pop()).filter((n) => SYNC_BATCH.test(n) && Date.now() - Number(n.slice(0, 13)) <= SYNC_DAYS * DAY_MS);
    // The last name is returned even for the device's own batches, so its
    // cursor can move past them.
    return json({ batches: names.filter((n) => !n.endsWith(`-${device}`)).slice(0, 100), last: names.slice(0, 100).at(-1) || "", more: names.length > 100 });
  }
  const one = rest.match(/^batches\/(\d{13}-[A-Za-z0-9]{8}-[0-9a-f]{16})$/);
  if (one && method === "GET") {
    const o = await env.TRAILS.get(`s/b/${group}/${one[1]}`);
    if (!o || Date.now() - Number(one[1].slice(0, 13)) > SYNC_DAYS * DAY_MS) return fail(404, "That batch is gone.");
    if (url.searchParams.get("as") === "b64url") return new Response(toB64url(new Uint8Array(await o.arrayBuffer())), { headers: { "content-type": "text/plain", "cache-control": "no-store" } });
    return new Response(o.body, { headers: { "content-type": "application/octet-stream", "cache-control": "no-store" } });
  }
  if (rest === "ack" && method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return fail(400, "Not an ack.");
    }
    const upTo = String(body?.upTo || "");
    if (!SYNC_BATCH.test(upTo)) return fail(400, "Not an ack.");
    const updated = { ...me, seen: Date.now(), cursor: upTo > me.cursor ? upTo : me.cursor };
    await putDevice(env, group, updated);
    const deleted = await syncClean(env, group, (await syncDevices(env, group)).map((d) => (d.id === me.id ? updated : d)));
    return json({ deleted });
  }
  return fail(404, "Not found.");
}

// ---- Daily active count (B116) ----
const COUNT_OS = new Set(["mac", "windows", "linux", "other"]);
const COUNT_VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,4}(?:-[0-9A-Za-z.]{1,20})?$/;
const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
async function count(request, env) {
  if (env.COUNT_LIMIT) {
    // The address is only used for this limit, in memory, and never stored.
    const { success } = await env.COUNT_LIMIT.limit({ key: request.headers.get("cf-connecting-ip") || "unknown" });
    if (!success) return fail(429, "Too many counts from here.");
  }
  if (Number(request.headers.get("content-length") || 0) > 200) return fail(413, "Too large.");
  let b;
  try {
    b = JSON.parse((await request.text()).slice(0, 200));
  } catch (_) {
    return fail(400, "Not a count.");
  }
  if (!b || !COUNT_VERSION.test(String(b.v)) || !COUNT_OS.has(b.os) || typeof b.w !== "boolean" || typeof b.m !== "boolean") return fail(400, "Not a count.");
  const flags = `${b.w ? "w" : "-"}${b.m ? "m" : "-"}`;
  await env.TRAILS.put(`a/${utcDay(Date.now())}/${b.os}/${b.v}/${flags}/${randomString(12)}`, new Uint8Array(0));
  return new Response(null, { status: 204 });
}
// Counts per day (with OS and version), and weekly and monthly users from
// the counts marked first this week or month, for the last ?days= days.
async function counts(request, env, url) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.STATS_TOKEN || token !== env.STATS_TOKEN) return fail(403, "Counts are private.");
  const days = Math.min(400, Math.max(1, Number(url.searchParams.get("days")) || 30));
  const from = utcDay(Date.now() - (days - 1) * DAY_MS);
  const out = { days: {}, weeks: {}, months: {} };
  let cursor;
  do {
    const page = await env.TRAILS.list({ prefix: "a/", cursor, startAfter: cursor ? undefined : `a/${from}` });
    for (const o of page.objects) {
      const [, day, os, v, flags] = o.key.split("/");
      if (day < from) continue;
      const d = (out.days[day] = out.days[day] || { total: 0, os: {}, versions: {} });
      d.total++;
      d.os[os] = (d.os[os] || 0) + 1;
      d.versions[v] = (d.versions[v] || 0) + 1;
      // Weeks and months are counted on the day of the first count in them.
      if (flags[0] === "w") out.weeks[weekOfDay(day)] = (out.weeks[weekOfDay(day)] || 0) + 1;
      if (flags[1] === "m") out.months[day.slice(0, 7)] = (out.months[day.slice(0, 7)] || 0) + 1;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return json(out);
}
function weekOfDay(day) {
  const t = new Date(`${day}T00:00:00Z`);
  const wd = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - wd);
  const year = t.getUTCFullYear();
  return `${year}-W${String(Math.ceil(((t - Date.UTC(year, 0, 1)) / DAY_MS + 1) / 7)).padStart(2, "0")}`;
}

async function remove(request, env, id) {
  const found = await readTrail(env, id);
  if (!found) return fail(404, "This link has expired or was removed.");
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || (await sha256(token)) !== found.obj.customMetadata.del) return fail(403, "Only the person who made this link can remove it.");
  await env.TRAILS.delete(`t/${id}`);
  return new Response(null, { status: 204 });
}

function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const SECURITY = (nonce) => ({
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
  "x-content-type-options": "nosniff",
  "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; font-src https://noderesearch.app; img-src 'self' https://noderesearch.app; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
});

async function viewer(env, id) {
  const found = await readTrail(env, id);
  const nonce = randomString(22);
  if (!found) return new Response(page(nonce, null), { status: 404, headers: SECURITY(nonce) });
  const bytes = new Uint8Array(await found.obj.arrayBuffer());
  return new Response(page(nonce, { data: toBase64(bytes), expiresAt: found.created + DAYS * DAY_MS }), { headers: SECURITY(nonce) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n", { headers: { "content-type": "text/plain" } });
    if (path === "/api/trails" && request.method === "POST") return upload(request, env);
    if (path === "/api/active" && request.method === "POST") return count(request, env);
    if (path === "/api/active" && request.method === "GET") return counts(request, env, url);
    const syncPath = path.match(/^\/api\/sync\/([^/]+)\/(.+)$/);
    if (syncPath) return sync(request, env, url, syncPath[1], syncPath[2]);
    const api = path.match(/^\/api\/trails\/([^/]+)$/);
    if (api && request.method === "GET") {
      const found = await readTrail(env, api[1]);
      if (!found) return fail(404, "This link has expired or was removed.");
      return new Response(found.obj.body, { headers: { "content-type": "application/octet-stream", "cache-control": "no-store", "x-node-expires": String(found.created + DAYS * DAY_MS) } });
    }
    if (api && request.method === "DELETE") return remove(request, env, api[1]);
    const view = path.match(/^\/t\/([^/]+)$/);
    if (view && (request.method === "GET" || request.method === "HEAD")) return viewer(env, view[1]);
    if (path === "/" || path === "/t" || path === "/t/") return Response.redirect("https://noderesearch.app/", 302);
    return fail(404, "Not found.");
  },
};

// ---- The page ----
// Decrypts in the browser with the key after "#", shows the trail as plain
// Markdown made safe (no HTML from the file is ever used), and offers Open in
// NODE (node:// link) and Download NODE.
function page(nonce, trail) {
  const data = trail ? JSON.stringify({ data: trail.data, expiresAt: trail.expiresAt }).replace(/</g, "\\u003c") : "null";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Shared trail · NODE</title>
<style nonce="${nonce}">
@font-face{font-family:"Barlow";font-weight:400;font-display:swap;src:url(https://noderesearch.app/fonts/barlow-latin-400-normal.woff2) format("woff2")}
@font-face{font-family:"Barlow";font-weight:600;font-display:swap;src:url(https://noderesearch.app/fonts/barlow-latin-600-normal.woff2) format("woff2")}
@font-face{font-family:"JetBrains Mono";font-weight:400;font-display:swap;src:url(https://noderesearch.app/fonts/jetbrains-mono-latin-400-normal.woff2) format("woff2")}
:root{--bg:#000;--surface:#0b0b0c;--ink:#fff;--muted:#a1a1a6;--line:#2a2a2e;--signal:#b18cff;--sans:"Barlow",system-ui,-apple-system,"Segoe UI",sans-serif;--mono:"JetBrains Mono",ui-monospace,Menlo,monospace}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink)}
body{font:400 16px/1.55 var(--sans);-webkit-font-smoothing:antialiased}
main{max-width:760px;margin:0 auto;padding:32px 16px 64px}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:24px;flex-wrap:wrap}
.brand{font:600 13px/16px var(--sans);letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.actions{display:flex;gap:8px;flex-wrap:wrap}
.btn{display:inline-block;border:1px solid var(--line);color:var(--ink);text-decoration:none;font:600 12px/16px var(--sans);letter-spacing:.12em;text-transform:uppercase;padding:9px 14px}
.btn.primary{border-color:var(--signal)}
.btn:focus-visible,a:focus-visible{outline:2px solid var(--signal);outline-offset:2px}
.meta{color:var(--muted);font-size:14px}
h1{font:600 32px/1.2 var(--sans);margin:8px 0 12px}
h2{font:600 13px/16px var(--sans);letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin:40px 0 12px;border-top:1px solid var(--line);padding-top:16px}
h3{font:600 20px/1.3 var(--sans);margin:24px 0 6px}
h4,h5,h6{font:600 16px/1.3 var(--sans);margin:16px 0 6px}
p{margin:6px 0}
ul{margin:6px 0;padding-left:20px}
li{margin:4px 0}
a{color:var(--ink);text-underline-offset:3px;overflow-wrap:anywhere}
code{font:13px/1.4 var(--mono);background:var(--surface);padding:1px 4px}
.notice{border:1px solid var(--line);padding:16px;color:var(--muted)}
.foot{margin-top:48px;color:var(--muted);font-size:13px;border-top:1px solid var(--line);padding-top:16px}
</style>
</head>
<body>
<main>
<header>
  <span class="brand">NODE · Shared trail</span>
  <span class="actions">
    <a class="btn primary" id="open" href="#">Open in NODE</a>
    <a class="btn" href="https://noderesearch.app/">Download NODE</a>
  </span>
</header>
<div id="out"><p class="meta">Opening the trail…</p></div>
<p class="foot" id="foot">This trail was encrypted on the sender's computer. It is decrypted here, in your browser, with the key in the link. The server cannot read it.</p>
</main>
<script nonce="${nonce}">
const TRAIL = ${data};
const out = document.getElementById("out");
const say = (text) => { out.innerHTML = ""; const p = document.createElement("p"); p.className = "notice"; p.textContent = text; out.appendChild(p); };
document.getElementById("open").href = "noderesearch://open?link=" + encodeURIComponent(location.href);

function bytesOf(b64) { const s = atob(b64); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
function keyOf() {
  const m = location.hash.match(/[#&]k=([A-Za-z0-9_-]{43})/);
  if (!m) return null;
  return bytesOf(m[1].replace(/-/g, "+").replace(/_/g, "/") + "=");
}

// Markdown to safe elements: headings, lists (nested), links, bold, code.
// Text is only ever set with textContent; links must be http or https.
function inline(parent, text) {
  const re = /\\[((?:\\\\.|[^\\]])*)\\]\\((https?:\\/\\/[^\\s)]+)\\)|\\*\\*([^*]+)\\*\\*|\`([^\`]+)\`|<(https?:\\/\\/[^\\s>]+)>/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    if (m[2] || m[5]) { const a = document.createElement("a"); a.href = m[2] || m[5]; a.rel = "noopener noreferrer nofollow"; a.target = "_blank"; a.textContent = m[2] ? m[1].replace(/\\\\([\\[\\]])/g, "$1") : m[5]; parent.appendChild(a); }
    else if (m[3]) { const b = document.createElement("strong"); b.textContent = m[3]; parent.appendChild(b); }
    else { const c = document.createElement("code"); c.textContent = m[4]; parent.appendChild(c); }
    last = re.lastIndex;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}
function render(md) {
  md = md.replace(/<!--[\\s\\S]*?-->/g, "");
  let body = md;
  const front = md.match(/^---\\n([\\s\\S]*?)\\n---\\n/);
  const info = {};
  if (front) {
    body = md.slice(front[0].length);
    for (const line of front[1].split("\\n")) { const m = line.match(/^([\\w-]+):\\s*(.*)$/); if (m) info[m[1]] = m[2].replace(/^"|"$/g, ""); }
  }
  out.innerHTML = "";
  const meta = document.createElement("p");
  meta.className = "meta";
  const when = info["exported-at"] ? new Date(info["exported-at"]).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "";
  meta.textContent = ["Shared" + (info["exported-by"] ? " by " + info["exported-by"] : ""), when, TRAIL.expiresAt ? "link works until " + new Date(TRAIL.expiresAt).toLocaleDateString([], { month: "short", day: "numeric" }) : ""].filter(Boolean).join(" · ");
  out.appendChild(meta);
  const stack = [{ depth: -1, el: out }];
  let para = null;
  for (const raw of body.split("\\n")) {
    const line = raw.replace(/\\s+$/, "");
    if (!line.trim()) { para = null; continue; }
    const h = line.match(/^(#{1,6})\\s+(.*)$/);
    const li = line.match(/^(\\s*)[-*]\\s+(.*)$/);
    if (h) {
      stack.length = 1; para = null;
      const el = document.createElement("h" + h[1].length); inline(el, h[2]); out.appendChild(el);
      if (h[1].length === 1) document.title = h[2] + " · NODE";
    } else if (li) {
      para = null;
      const depth = Math.floor(li[1].length / 2);
      while (stack.length > 1 && stack[stack.length - 1].depth > depth) stack.pop();
      let top = stack[stack.length - 1];
      if (top.depth < depth) {
        const ul = document.createElement("ul");
        (top.li || top.el).appendChild(ul);
        top = { depth, el: ul, li: null };
        stack.push(top);
      }
      const item = document.createElement("li"); inline(item, li[2]); top.el.appendChild(item); top.li = item;
    } else {
      // The trail file puts one fact per line (Status, Conclusion, Pages), so
      // each line is its own paragraph.
      stack.length = 1;
      para = document.createElement("p");
      out.appendChild(para);
      inline(para, line.trim());
    }
  }
}

(async () => {
  if (!TRAIL) return say("This link has expired or was removed. Shared trails are kept for 30 days.");
  const raw = keyOf();
  if (!raw) return say("This link is missing its key (the part after #). Ask the sender to copy the whole link again.");
  try {
    const bytes = bytesOf(TRAIL.data);
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(3, 15) }, key, bytes.slice(15));
    const text = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    render(text);
  } catch (e) {
    say("This trail could not be opened. The link may be incomplete: ask the sender to copy the whole link again.");
  }
})();
</script>
</body>
</html>`;
}
