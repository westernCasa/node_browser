// Talking to the sync relay (B50) and one round of sync. No Electron or DOM
// imports: the desktop and the phone both use it, each with its own fetch.
//
// One round (syncOnce):
//   1. Join the group (first time, and after a restart). A device that just
//      joined, or was away so long that it missed batches, sends everything it
//      has and asks the others to do the same.
//   2. Read the other devices' batches, open them with the key and apply them
//      (core/sync.js), then tell the relay how far it got, so batches every
//      device has are deleted.
//   3. Send this device's changes.
// Every batch also carries this device's name and kind ("Sven's MacBook",
// desktop), encrypted, so the devices can list each other. The relay only
// sees random ids.

const Crypto = require("./sync-crypto");

class SyncError extends Error {
  constructor(message, { status = 0, unpaired = false } = {}) {
    super(message);
    this.status = status;
    this.unpaired = unpaired;
  }
}

class RelayClient {
  // text: send and fetch batches as base64url text (phones), not binary.
  constructor({ api, group, auth, device, fetch: f = globalThis.fetch, timeoutMs = 20000, text = false }) {
    this.text = text;
    this.base = `${String(api).replace(/\/$/, "")}/api/sync/${group}`;
    this.auth = auth;
    this.device = device;
    this.fetch = f;
    this.timeoutMs = timeoutMs;
  }
  async call(path, { method = "GET", json, bytes } = {}) {
    const headers = { authorization: `Bearer ${this.auth}` };
    let body;
    if (json) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(json);
    } else if (bytes && this.text) {
      headers["content-type"] = "application/x-node-sync-b64url";
      body = Crypto.b64url(bytes);
    } else if (bytes) {
      headers["content-type"] = "application/octet-stream";
      body = bytes;
    }
    const sep = path.includes("?") ? "&" : "?";
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctl && setTimeout(() => ctl.abort(), this.timeoutMs);
    let res;
    try {
      res = await this.fetch(`${this.base}/${path}${sep}device=${this.device}`, { method, headers, body, signal: ctl?.signal });
    } catch (e) {
      throw new SyncError("Can't reach the sync server.", { status: 0 });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (res.status === 403 || res.status === 401) {
      let msg = "Pair this device again.";
      try {
        msg = (await res.json()).error || msg;
      } catch (_) {}
      throw new SyncError(msg, { status: res.status, unpaired: true });
    }
    if (!res.ok && res.status !== 204) throw new SyncError(res.status === 429 ? "The sync server is busy. NODE will try again shortly." : `The sync server answered ${res.status}.`, { status: res.status });
    return res;
  }
  async join() {
    return (await this.call("join", { method: "POST", json: { device: this.device } })).json();
  }
  async list(after = "") {
    return (await this.call(`batches${after ? `?after=${encodeURIComponent(after)}` : ""}`)).json();
  }
  async get(name) {
    if (this.text) return Crypto.fromB64url(await (await this.call(`batches/${name}?as=b64url`)).text());
    return new Uint8Array(await (await this.call(`batches/${name}`)).arrayBuffer());
  }
  async post(bytes) {
    return (await this.call("batches", { method: "POST", bytes })).json();
  }
  async ack(upTo) {
    return (await this.call("ack", { method: "POST", json: { upTo } })).json();
  }
  async devices() {
    return (await this.call("devices")).json();
  }
  async leave(id = this.device) {
    await this.call(`devices/${id}`, { method: "DELETE" });
  }
}

// state: { cursor, joined, peers: { id: { name, kind, at } } }, kept by the
// caller (desktop: userData/sync/relay.json).
async function syncOnce({ engine, client, key, state, me = {}, now = () => Date.now() }) {
  const out = { received: 0, sent: 0, trails: new Set(), added: [], deleted: [], restored: [], peers: false };
  const head = { name: String(me.name || "").slice(0, 80), kind: me.kind || "desktop" };
  const send = async (batches) => {
    for (const b of batches) {
      await client.post(Crypto.seal({ ...b, ...head }, key));
      out.sent++;
    }
  };
  // 1. Join.
  if (!state.joined) {
    const j = await client.join();
    state.joined = now();
    if (j.joined || j.missed) {
      engine.resetAll();
      await send(engine.outgoing({ resync: true }));
      engine.sent();
    }
  }
  // 2. Read.
  for (let page = 0; page < 20; page++) {
    const l = await client.list(state.cursor || "");
    for (const name of l.batches || []) {
      let batch;
      try {
        batch = Crypto.open(await client.get(name), key);
      } catch (e) {
        if (e instanceof SyncError) throw e;
        continue; // not readable with this key: skipped
      }
      if (!batch || typeof batch !== "object") continue;
      if (batch.from && batch.from !== engine.device) {
        const peers = (state.peers = state.peers || {});
        const p = { name: String(batch.name || "").slice(0, 80), kind: batch.kind === "phone" ? "phone" : "desktop", at: now() };
        if (!peers[batch.from] || peers[batch.from].name !== p.name || peers[batch.from].kind !== p.kind) out.peers = true;
        peers[batch.from] = p;
      }
      if (batch.resync) engine.resetAll(); // another device needs everything
      const r = engine.apply(batch);
      out.received++;
      r.trails.forEach((t) => out.trails.add(t));
      out.added.push(...r.added);
      out.deleted.push(...r.deleted);
      out.restored.push(...r.restored);
    }
    if (l.last && l.last > (state.cursor || "")) {
      await client.ack(l.last);
      state.cursor = l.last;
    }
    if (!l.more) break;
  }
  // 3. Send.
  const batches = engine.outgoing();
  await send(batches);
  if (batches.length) engine.sent();
  return { ...out, trails: [...out.trails] };
}

module.exports = { RelayClient, SyncError, syncOnce };
