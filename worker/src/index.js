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
// Bindings (wrangler.toml): TRAILS (R2 bucket), UPLOAD_LIMIT (rate limiter,
// optional). Nothing else is stored: no names, no addresses, no logs of what
// is inside.

export const MAX_BYTES = 1024 * 1024;
export const DAYS = 30;
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
