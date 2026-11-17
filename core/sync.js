// Sync between paired devices (B50): trails, both ways. No Electron or DOM
// imports; the phone app uses it too. The relay and encryption are elsewhere
// (worker/, core/sync-crypto.js); this file decides what changed and merges.
//
// A trail is split into items: its name and settings ("trail"), each card
// ("c:<id>"), group ("g:<id>"), line ("l:<id>") and each part of what the
// suggestions sidebar keeps ("r:<field>"). Events are sent once each, by id.
//
// collect() compares every item with what was last synced and stamps the ones
// that changed with the time and this device. apply() takes another device's
// changes: an item is replaced only by a later change (latest edit wins; same
// time: the higher device id). New cards, links, notes and visits from both
// sides are all kept, because they are different items or events.
//
// Deleting a trail is synced too (with its time), and so is Undo. A trail
// brought back sends everything again, in case the other device had already
// removed its files.
//
// Not synced: the canvas position and zoom (view.json), which trail is open,
// the trail file's path on this computer, and any file: saved copies,
// screenshots, audio and Library items stay on the device that made them.

const { isSensitiveUrl } = require("./urls");

const VERSION = 1;
// Trail fields that sync. Not: lastAt (worked out from events), file (a path
// on this computer).
const TRAIL_FIELDS = ["name", "mono", "createdAt", "readonly", "from", "note", "startHere", "keepCopies"];
const MAX_BATCH = 400 * 1024; // characters of JSON per batch, before encryption

// Same JSON whatever the key order, so equal items hash the same.
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
// Two FNV-1a hashes side by side: enough to notice a change.
function hash(v) {
  const s = stable(v);
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return a.toString(36) + b.toString(36);
}
// a is later than b: by time, then by device id.
const later = (a, b) => !b || a.at > b.at || (a.at === b.at && String(a.by) > String(b.by));

// A card or other item as it may travel: no inline file data. (Cards hold
// file names, not files; this is a guard.)
function travel(v) {
  if (!v || typeof v !== "object") return v;
  const out = Array.isArray(v) ? [] : {};
  for (const [k, x] of Object.entries(v)) {
    if (typeof x === "string" && /^data:/i.test(x) && x.length > 512) continue;
    if (k === "here" || k === "changed") continue; // B87: worked out on each device
    out[k] = x && typeof x === "object" ? travel(x) : x;
  }
  return out;
}

// The items of a trail, as { key: value }.
function itemsOf(data) {
  const out = {};
  const t = {};
  for (const f of TRAIL_FIELDS) if (data.trail[f] !== undefined) t[f] = data.trail[f];
  out.trail = t;
  for (const c of data.cards || []) out[`c:${c.id}`] = travel(c);
  for (const g of data.groups || []) out[`g:${g.id}`] = travel(g);
  for (const l of data.lines || []) out[`l:${l.id}`] = travel(l);
  for (const [k, v] of Object.entries(data.research || {})) out[`r:${k}`] = travel(v);
  return out;
}
// Puts one item into a trail's data (value null: takes it out).
function putItem(data, key, value) {
  if (key === "trail") {
    for (const f of TRAIL_FIELDS) {
      if (value && value[f] !== undefined) data.trail[f] = value[f];
      else if (value) delete data.trail[f];
    }
    return;
  }
  const kind = key.slice(0, 2);
  const id = key.slice(2);
  if (kind === "r:") {
    data.research = data.research || {};
    if (value === null) delete data.research[id];
    else data.research[id] = value;
    return;
  }
  const list = { "c:": "cards", "g:": "groups", "l:": "lines" }[kind];
  if (!list) return;
  data[list] = data[list] || [];
  const at = data[list].findIndex((x) => x.id === id);
  if (value === null) {
    if (at >= 0) data[list].splice(at, 1);
  } else if (at >= 0) data[list][at] = { ...value, id };
  else data[list].push({ ...value, id });
}
const safeEvent = (e) => e && typeof e.id === "string" && typeof e.at === "number" && typeof e.type === "string" && !(e.data?.url && isSensitiveUrl(e.data.url));

class SyncEngine {
  /**
   * @param store    a TrailStore
   * @param storage  where the sync state is kept (desktop: userData/sync/)
   * @param options  { device: this device's sync id, now }
   */
  constructor(store, storage, { device, now = () => Date.now() } = {}) {
    if (!device) throw new Error("SyncEngine needs a device id");
    this.store = store;
    this.storage = storage;
    this.device = device;
    this.now = now;
    let s = null;
    try {
      s = JSON.parse(storage.read("state.json") || "null");
    } catch (_) {}
    this.state = s && s.v === VERSION ? s : { v: VERSION, trails: {} };
    // Changes stamped but not yet accepted by the relay. Kept on disk, so a
    // change is never lost if NODE quits before it is sent.
    this.state.outbox = this.state.outbox || { changes: [], events: [], life: [] };
  }
  saveState() {
    this.storage.write("state.json", JSON.stringify(this.state));
  }
  trailState(tid) {
    return (this.state.trails[tid] = this.state.trails[tid] || { items: {}, events: [], life: null });
  }
  // Forget what was synced, so the next collect() sends everything again
  // (after pairing a new device, or when another device asks).
  // Items keep their times, so an old copy sent again never beats a newer
  // edit made elsewhere.
  resetAll() {
    for (const ts of Object.values(this.state.trails)) {
      ts.resend = true;
      ts.events = [];
    }
    this.state.outbox = { changes: [], events: [], life: [] };
    this.saveState();
  }

  // ---- this device's changes ----
  // Returns { changes, events, life }: items that changed since the last
  // collect (value null: taken out), events not sent yet, and trails deleted
  // or brought back. Stamps them with now and this device.
  collect() {
    const at = this.now();
    const by = this.device;
    const out = { changes: [], events: [], life: [] };
    const store = this.store;
    const deleted = new Map((store.index.deleted || []).map((d) => [d.id, d.at]));
    const known = new Set([...store.index.order, ...deleted.keys(), ...Object.keys(this.state.trails)]);
    for (const tid of known) {
      const ts = this.trailState(tid);
      const gone = deleted.has(tid) || !store.has(tid);
      const wasGone = Boolean(ts.life?.deleted);
      if (gone && !store.has(tid) && !deleted.has(tid) && !ts.life) {
        delete this.state.trails[tid]; // never synced, and no longer here
        continue;
      }
      if (gone !== wasGone && (ts.life || gone)) {
        const when = gone ? deleted.get(tid) || at : at;
        ts.life = { deleted: gone, at: when, by };
        out.life.push({ t: tid, deleted: gone, at: when, by });
        if (!gone) {
          // Brought back: send it all again.
          ts.items = {};
          ts.events = [];
        }
      }
      if (gone) {
        if (ts.resend && ts.life) out.life.push({ t: tid, ...ts.life });
        delete ts.resend;
        continue;
      }
      const t = store.load(tid);
      if (!t) continue;
      const items = itemsOf(t.data);
      // When each item was last changed, from the events that name it (a
      // move, a rename, a link). An item with no newer event is stamped now.
      const edited = new Map();
      for (const e of t.events) {
        const key = e.card ? `c:${e.card}` : e.group ? `g:${e.group}` : e.line ? `l:${e.line}` : e.type === "renamed" ? "trail" : "";
        if (key && e.device === store.device && !(edited.get(key) >= e.at)) edited.set(key, e.at);
      }
      const resend = ts.resend;
      delete ts.resend;
      if (resend && ts.life) out.life.push({ t: tid, ...ts.life });
      for (const [key, value] of Object.entries(items)) {
        const h = hash(value);
        if (ts.items[key]?.h === h) {
          // Sent again with the time it was last changed.
          if (resend) out.changes.push({ t: tid, k: key, v: value, at: ts.items[key].at, by: ts.items[key].by });
          continue;
        }
        const ev = edited.get(key);
        const when = ev && ev > (ts.items[key]?.at || 0) && ev <= at ? ev : at;
        ts.items[key] = { h, at: when, by };
        out.changes.push({ t: tid, k: key, v: value, at: when, by });
      }
      for (const key of Object.keys(ts.items)) {
        if (key in items || ts.items[key].h === "-") continue;
        ts.items[key] = { h: "-", at, by };
        out.changes.push({ t: tid, k: key, v: null, at, by });
      }
      const sent = new Set(ts.events);
      for (const e of t.events) {
        if (sent.has(e.id) || !safeEvent(e)) continue;
        ts.events.push(e.id);
        out.events.push({ t: tid, e });
      }
    }
    if (out.changes.length || out.events.length || out.life.length) {
      this.state.outbox = mergeOut(this.state.outbox, out);
      this.saveState();
    }
    return out;
  }

  // ---- another device's changes ----
  // batch: { changes, events, life } from collect() on another device.
  // Returns what happened, for the window: { trails: ids changed, added: new
  // trails, deleted: [{ id, name }], restored: ids }.
  apply(batch = {}) {
    // Stamp this device's own edits first, so a later local edit is not
    // replaced by an earlier remote one. They go out with the next push.
    this.collect();
    const store = this.store;
    const res = { trails: new Set(), added: [], deleted: [], restored: [] };
    const deletedHere = () => new Set((store.index.deleted || []).map((d) => d.id));

    for (const l of batch.life || []) {
      const ts = this.trailState(l.t);
      if (ts.life && !later(l, ts.life)) continue;
      ts.life = { deleted: Boolean(l.deleted), at: l.at, by: l.by };
      if (l.deleted && store.has(l.t)) {
        const name = store.get(l.t)?.trail.name || "";
        store.remove(l.t, { at: l.at });
        res.deleted.push({ id: l.t, name });
      } else if (!l.deleted && deletedHere().has(l.t)) {
        store.restore(l.t, { current: false });
        res.restored.push(l.t);
      }
    }
    const touched = new Set();
    const ensure = (tid) => {
      if (store.has(tid)) return true;
      if (deletedHere().has(tid) || this.state.trails[tid]?.life?.deleted) return false;
      store.create("", { id: tid, current: false });
      res.added.push(tid);
      return true;
    };
    for (const c of batch.changes || []) {
      if (!c || typeof c.t !== "string" || typeof c.k !== "string" || typeof c.at !== "number") continue;
      if (c.v && c.v.url && isSensitiveUrl(c.v.url)) continue; // B66: never, even if sent
      const ts = this.trailState(c.t);
      const mine = ts.items[c.k];
      if (mine && !later(c, mine)) continue;
      if (!ensure(c.t)) continue;
      const t = store.load(c.t);
      putItem(t.data, c.k, c.v);
      ts.items[c.k] = { h: c.v === null ? "-" : hash(c.v), at: c.at, by: c.by };
      touched.add(c.t);
    }
    for (const { t: tid, e } of batch.events || []) {
      if (!safeEvent(e) || !ensure(tid)) continue;
      const ts = this.trailState(tid);
      if (store.addEvent(tid, e)) touched.add(tid);
      if (!ts.events.includes(e.id)) ts.events.push(e.id);
    }
    for (const tid of touched) {
      const t = store.load(tid);
      if (!t) continue;
      const last = Math.max(t.data.trail.lastAt || 0, ...t.events.map((e) => e.at));
      if (last > 0) t.data.trail.lastAt = last;
      store.save(tid);
      res.trails.add(tid);
    }
    this.saveState();
    return { ...res, trails: [...res.trails] };
  }

  // Everything waiting to be sent (after a fresh collect()), as batches of
  // about MAX_BATCH characters. The outbox is kept until sent() is called.
  outgoing({ resync = false } = {}) {
    this.collect();
    return split(this.state.outbox, { from: this.device, resync });
  }
  // The relay accepted everything outgoing() returned.
  sent() {
    this.state.outbox = { changes: [], events: [], life: [] };
    this.saveState();
  }
  pending() {
    const o = this.state.outbox;
    return o.changes.length + o.events.length + o.life.length;
  }
}
// Adds b to the outbox a. An item changed twice keeps only its latest value.
function mergeOut(a, b) {
  const changes = new Map();
  for (const c of [...a.changes, ...b.changes]) changes.set(`${c.t} ${c.k}`, c);
  const life = new Map();
  for (const l of [...a.life, ...b.life]) life.set(l.t, l);
  return { changes: [...changes.values()], events: [...a.events, ...b.events], life: [...life.values()] };
}
// Batches: life first, then items, then events; each under MAX_BATCH.
function split(all, head) {
  const batches = [];
  let cur = null;
  let size = 0;
  const open = () => {
    cur = { v: VERSION, ...head, changes: [], events: [], life: [] };
    size = 200;
    batches.push(cur);
  };
  const add = (list, item) => {
    const n = JSON.stringify(item).length + 1;
    if (!cur || (size + n > MAX_BATCH && size > 200)) open();
    cur[list].push(item);
    size += n;
  };
  for (const l of all.life) add("life", l);
  for (const c of all.changes) add("changes", c);
  for (const e of all.events) add("events", e);
  if (!batches.length && head.resync) open();
  return batches;
}

module.exports = { SyncEngine, hash, stable, itemsOf, putItem, later, VERSION, MAX_BATCH };
