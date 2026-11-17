// Sync pairing and encryption (B50). No Electron, DOM or Node-only imports:
// the phone app uses it too. Uses @noble (audited, pure JavaScript) and the
// platform's crypto.getRandomValues.
//
// Pairing: one device makes a 32-byte secret and shows it as a QR code
// ("NODE-SYNC1:<base64url>"); the other scans it. From the secret, each device
// derives (HKDF-SHA256, a different label each):
//   - group: the id the relay files batches under (16 bytes, hex)
//   - auth:  the token the relay asks for (32 bytes, hex). The relay keeps
//            only its SHA-256, so it can check requests but not make them.
//   - key:   the encryption key (32 bytes). Never sent anywhere.
// The relay never sees the secret or the key, so it cannot read a batch.
//
// A sealed batch: "NS1" | 24-byte nonce | XChaCha20-Poly1305(JSON).

const { xchacha20poly1305 } = require("@noble/ciphers/chacha");
const { hkdf } = require("@noble/hashes/hkdf");
const { sha256 } = require("@noble/hashes/sha256");
const { randomBytes, bytesToHex } = require("@noble/hashes/utils");

const PREFIX = "NODE-SYNC1:";
const MAGIC = [0x4e, 0x53, 0x31]; // "NS1"
// UTF-8 without TextEncoder or TextDecoder, which not every phone runtime has.
function utf8(str) {
  const out = [];
  for (const ch of String(str)) {
    let c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}
function fromUtf8(b) {
  let s = "";
  for (let i = 0; i < b.length; ) {
    const x = b[i];
    let c;
    if (x < 0x80) c = b[i++];
    else if (x < 0xe0) c = ((x & 31) << 6) | (b[i + 1] & 63), (i += 2);
    else if (x < 0xf0) c = ((x & 15) << 12) | ((b[i + 1] & 63) << 6) | (b[i + 2] & 63), (i += 3);
    else c = ((x & 7) << 18) | ((b[i + 1] & 63) << 12) | ((b[i + 2] & 63) << 6) | (b[i + 3] & 63), (i += 4);
    s += String.fromCodePoint(c);
  }
  return s;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function b64url(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : "") + (i + 2 < bytes.length ? B64[n & 63] : "");
  }
  return out;
}
function fromB64url(s) {
  const clean = String(s).replace(/=+$/, "");
  if (!/^[A-Za-z0-9_-]*$/.test(clean)) return null;
  const out = [];
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    buf = (buf << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 255);
    }
  }
  return new Uint8Array(out);
}

// A new pairing secret, as the text the QR code holds.
function newPairingCode() {
  return PREFIX + b64url(randomBytes(32));
}
// The secret from a scanned or pasted code, or null.
function parsePairingCode(text) {
  const m = String(text || "").trim().match(/^NODE-SYNC1:([A-Za-z0-9_-]{43})$/);
  if (!m) return null;
  const secret = fromB64url(m[1]);
  return secret && secret.length === 32 ? secret : null;
}
// group, auth and key from a pairing code (or its secret bytes).
function keysFrom(code) {
  const secret = typeof code === "string" ? parsePairingCode(code) : code;
  if (!secret) throw new Error("This is not a NODE sync code.");
  const derive = (label, n) => hkdf(sha256, secret, undefined, utf8(label), n);
  return { group: bytesToHex(derive("node-sync-group", 16)), auth: bytesToHex(derive("node-sync-auth", 32)), key: derive("node-sync-key", 32) };
}
// What the relay stores to check the auth token.
const authHash = (auth) => bytesToHex(sha256(utf8(auth)));

function seal(obj, key) {
  const nonce = randomBytes(24);
  const body = xchacha20poly1305(key, nonce).encrypt(utf8(JSON.stringify(obj)));
  const out = new Uint8Array(3 + 24 + body.length);
  out.set(MAGIC, 0);
  out.set(nonce, 3);
  out.set(body, 27);
  return out;
}
function open(bytes, key) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 27 + 16 || b[0] !== MAGIC[0] || b[1] !== MAGIC[1] || b[2] !== MAGIC[2]) throw new Error("Not a NODE sync batch.");
  let plain;
  try {
    plain = xchacha20poly1305(key, b.subarray(3, 27)).decrypt(b.subarray(27));
  } catch {
    throw new Error("A sync batch could not be decrypted (wrong key or changed on the way).");
  }
  return JSON.parse(fromUtf8(plain));
}
// A random device id (not derived from anything about the device).
const newDeviceId = () => bytesToHex(randomBytes(8));

module.exports = { utf8, fromUtf8, newPairingCode, parsePairingCode, keysFrom, authHash, seal, open, newDeviceId, b64url, fromB64url, PREFIX };
