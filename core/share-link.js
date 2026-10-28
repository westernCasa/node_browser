// Share links (B82 phase 2): a trail file encrypted on this computer and
// stored by the NODE share server (worker/), which cannot read it.
//
// Format: "NT1" | 12-byte IV | AES-256-GCM(gzip(trail Markdown)) with the
// 16-byte tag at the end (as Web Crypto expects). The 32-byte key goes in the
// link after "#k=", which browsers never send to a server.
const crypto = require("crypto");
const zlib = require("zlib");

const MAGIC = Buffer.from("NT1");
const MAX_BYTES = 1024 * 1024;
// Links are on the NODE website, which passes /t/… to the share server.
const LINK_BASE = "https://noderesearch.app";
const API_BASE = process.env.NODE_SHARE_API || "https://node-share.westerncasa.workers.dev";

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function seal(markdown) {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(zlib.gzipSync(Buffer.from(markdown, "utf8"))), cipher.final(), cipher.getAuthTag()]);
  return { bytes: Buffer.concat([MAGIC, iv, body]), key: b64url(key) };
}

function unseal(bytes, key) {
  const buf = Buffer.from(bytes);
  if (buf.length < 31 || !buf.subarray(0, 3).equals(MAGIC)) throw new Error("This is not an encrypted NODE trail.");
  const raw = fromB64url(key);
  if (raw.length !== 32) throw new Error("The link's key is incomplete. Ask the sender to copy the whole link again.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", raw, buf.subarray(3, 15));
  decipher.setAuthTag(buf.subarray(buf.length - 16));
  let plain;
  try {
    plain = Buffer.concat([decipher.update(buf.subarray(15, buf.length - 16)), decipher.final()]);
  } catch {
    throw new Error("This trail could not be decrypted. The link may be incomplete: ask the sender to copy the whole link again.");
  }
  return zlib.gunzipSync(plain, { maxOutputLength: 20 * 1024 * 1024 }).toString("utf8");
}

const linkFor = (id, key, base = LINK_BASE) => `${base}/t/${id}#k=${key}`;

// { id, key, api } from a share link, a noderesearch://open?link=… address, or null.
// Links on noderesearch.app or the share server itself are accepted.
function parseLink(text, { api = API_BASE } = {}) {
  let s = String(text || "").trim();
  try {
    if (/^noderesearch:/i.test(s)) s = new URL(s).searchParams.get("link") || "";
    const u = new URL(s);
    const hosts = new Set([new URL(LINK_BASE).host, new URL(api).host, "www.noderesearch.app"]);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(u.host))) return null;
    if (!hosts.has(u.host) && !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(u.host)) return null;
    const id = (u.pathname.match(/^\/t\/([A-Za-z0-9]{16})$/) || [])[1];
    const key = (u.hash.match(/[#&]k=([A-Za-z0-9_-]{43})/) || [])[1];
    if (!id) return null;
    return { id, key: key || "", api: /^(127\.0\.0\.1|localhost)/.test(u.host) ? `${u.protocol}//${u.host}` : api };
  } catch {
    return null;
  }
}

module.exports = { seal, unseal, linkFor, parseLink, MAX_BYTES, LINK_BASE, API_BASE };
