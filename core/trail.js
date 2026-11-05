// Trail store (B100): the data behind the trail canvas.
//
// One trail is one line of research and one tab group. It holds:
//   - trail.json: the trail's own fields, its cards, groups and lines, and the
//     data the suggestions sidebar keeps (pins, opened and hidden results,
//     reports, captures, share history). See "research" below.
//   - events.jsonl: an append-only log of what happened, one JSON object per
//     line. Cards, the timeline and Replay are built from it.
//   - view.json: where the person left the canvas (x, y, zoom, selection) and
//     the trail's open tabs. Never shared.
//   - files/: screenshots and audio. These never leave the computer.
//
// No platform imports: the storage object is passed in, as for research.js.
// Storage interface: read(name) -> string|null, write(name, text),
// list() -> names, and optionally append(name, text) and remove(name).
// Names may contain "/" (for example "t1/trail.json").

const { isSensitiveUrl, hostOf } = require("./urls");
const { placeNear } = require("./placement");

const FORMAT = 1;
const SESSION_GAP_MS = 30 * 60 * 1000; // a gap of more than 30 minutes starts a new session
const ENGAGED_MS = 20 * 1000; // the 20-second rule (doc 23); a starting guess
const EVENT_TYPES = new Set(["opened", "bounced", "captured", "asked", "reported", "noted", "placed", "removed", "linked", "unlinked", "grouped", "renamed", "resolved", "moved"]);
const CARD_KINDS = new Set(["page", "video", "capture", "report", "question", "note", "voice", "search"]);
const LINE_KINDS = new Set(["nav", "auto", "you", "suggested"]);
const LINE_LABELS = new Set(["", "supports", "contradicts", "answers", "raises"]);
// Card sizes at 100% zoom, by kind (handoff: cards 240-260 px wide).
const SIZE = {
  page: [260, 200],
  video: [260, 220],
  capture: [260, 210],
  report: [260, 240],
  question: [260, 170],
  note: [260, 150],
  voice: [260, 170],
  search: [260, 140],
};
// Pages that are not research reading (start pages, search results).
const NOT_READING = /wikipedia\.org\/wiki\/(Main_Page|Special:)|duckduckgo\.com\/(\?|html)|google\.[a-z.]+\/search|bing\.com\/search|search\.brave\.com\/search/i;

function newId() {
  return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14) + "-" + Math.random().toString(36).slice(2, 6);
}
function shortId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
// A stable id from text (FNV-1a), so the same old item always gets the same card id.
function hashId(prefix, ...parts) {
  let h = 0x811c9dc5;
  for (const ch of parts.join("\u0001")) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return prefix + h.toString(36);
}
// Two letters for the switcher: "Sourdough starters" -> "SS".
function monogram(name) {
  const words = String(name || "").replace(/[^\p{L}\p{N} ]+/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "+";
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}
const isReading = (url) => /^https?:/i.test(url || "") && !NOT_READING.test(url) && !isSensitiveUrl(url);

function blankTrail(name, at = Date.now()) {
  const id = newId();
  const nm = String(name || "").trim().slice(0, 120) || `Research ${new Date(at).toLocaleDateString()}`;
  return {
    v: FORMAT,
    trail: { id, name: nm, mono: monogram(nm), createdAt: at, lastAt: at, readonly: false, from: "", file: "", note: "", startHere: "" },
    cards: [],
    groups: [],
    lines: [],
    // What the suggestions sidebar keeps per trail. The research:* channels
    // read and write these through the session view below.
    research: { pins: [], opened: [], dismissed: [], reports: [], captures: [], shareLog: [], agent: [], sharedId: "", extra: [], tags: [] },
  };
}
const blankView = () => ({ x: 0, y: 0, z: 1, openTabs: [], mosaic: [], selected: null });

class TrailStore {
  /**
   * @param storage storage object rooted at the trails folder
   * @param options { device: "desktop" | "phone", now: () => ms }
   */
  constructor(storage, { device = "desktop", now = () => Date.now() } = {}) {
    this.storage = storage;
    this.device = device;
    this.now = now;
    this.cache = new Map(); // id -> { data, events, view }
    this.index = this.readJson("index.json") || { v: FORMAT, current: "", order: [] };
  }

  // ---- storage helpers ----
  readJson(name) {
    try {
      const t = this.storage.read(name);
      return t ? JSON.parse(t) : null;
    } catch {
      return null;
    }
  }
  writeJson(name, value) {
    this.storage.write(name, JSON.stringify(value, null, 2));
  }
  saveIndex() {
    this.writeJson("index.json", this.index);
  }
  appendLine(name, line) {
    if (typeof this.storage.append === "function") this.storage.append(name, line + "\n");
    else this.storage.write(name, (this.storage.read(name) || "") + line + "\n");
  }

  // ---- trails ----
  has(id) {
    return this.index.order.includes(id);
  }
  ids() {
    return this.index.order.slice();
  }
  load(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const data = this.readJson(`${id}/trail.json`);
    if (!data) return null;
    const events = [];
    for (const line of (this.storage.read(`${id}/events.jsonl`) || "").split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch (_) {} // a half-written last line after a crash is skipped
    }
    events.sort((a, b) => a.at - b.at);
    const view = { ...blankView(), ...(this.readJson(`${id}/view.json`) || {}) };
    const t = { data, events, view };
    this.cache.set(id, t);
    return t;
  }
  get(id = this.index.current) {
    const t = id && this.load(id);
    return t ? t.data : null;
  }
  save(id) {
    const t = this.load(id);
    if (!t) return;
    this.writeJson(`${id}/trail.json`, t.data);
  }
  saveView(id) {
    const t = this.load(id);
    if (t) this.writeJson(`${id}/view.json`, t.view);
  }

  create(name, { at = this.now(), id, current = true } = {}) {
    const data = blankTrail(name, at);
    if (id) data.trail.id = id;
    const tid = data.trail.id;
    this.cache.set(tid, { data, events: [], view: blankView() });
    this.writeJson(`${tid}/trail.json`, data);
    this.storage.write(`${tid}/events.jsonl`, "");
    this.writeJson(`${tid}/view.json`, blankView());
    if (!this.index.order.includes(tid)) this.index.order.unshift(tid);
    if (current) this.index.current = tid;
    this.saveIndex();
    return data;
  }

  // The trail NODE opens on: the last one used. A first launch gets a new one.
  current() {
    if (this.index.current && this.has(this.index.current) && this.get(this.index.current)) return this.get(this.index.current);
    const first = this.index.order.find((id) => this.get(id));
    if (first) {
      this.index.current = first;
      this.saveIndex();
      return this.get(first);
    }
    return this.create();
  }
  switchTo(id) {
    if (!this.get(id)) return null;
    this.index.current = id;
    this.index.order = [id, ...this.index.order.filter((x) => x !== id)];
    this.saveIndex();
    return this.get(id);
  }
  rename(id, name) {
    const d = this.get(id);
    const nm = String(name || "").trim().slice(0, 120);
    if (!d || !nm || nm === d.trail.name) return d;
    d.trail.name = nm;
    d.trail.mono = monogram(nm);
    this.event(id, { type: "renamed", data: { trail: nm } });
    this.save(id);
    return d;
  }
  // The switcher's list, most recently used first.
  list() {
    return this.index.order
      .map((id) => {
        const t = this.load(id);
        if (!t) return null;
        const { trail } = t.data;
        return {
          id,
          name: trail.name,
          mono: trail.mono,
          createdAt: trail.createdAt,
          lastAt: trail.lastAt,
          readonly: trail.readonly,
          cards: t.data.cards.filter((c) => !c.removed).length,
          pages: this.pageRows(id).length,
          current: id === this.index.current,
        };
      })
      .filter(Boolean);
  }

  // ---- events ----
  // Every change is recorded with its own time: Replay depends on it.
  event(id, ev) {
    const t = this.load(id);
    if (!t) return null;
    if (!EVENT_TYPES.has(ev.type)) throw new Error(`Unknown event type: ${ev.type}`);
    const e = { id: shortId("e"), at: ev.at || this.now(), device: ev.device || this.device, actor: ev.actor || "me", type: ev.type };
    for (const k of ["card", "line", "group"]) if (ev[k]) e[k] = ev[k];
    if (ev.data && Object.keys(ev.data).length) e.data = ev.data;
    t.events.push(e);
    if (t.events.length > 1 && t.events.at(-2).at > e.at) t.events.sort((a, b) => a.at - b.at);
    this.appendLine(`${id}/events.jsonl`, JSON.stringify(e));
    if (e.at > t.data.trail.lastAt) t.data.trail.lastAt = e.at;
    return e;
  }
  events(id = this.index.current) {
    return this.load(id)?.events.slice() || [];
  }

  // ---- cards, groups, lines ----
  card(id, cardId) {
    return this.get(id)?.cards.find((c) => c.id === cardId) || null;
  }
  pageCard(id, url) {
    return this.get(id)?.cards.find((c) => (c.kind === "page" || c.kind === "video") && c.url === url) || null;
  }
  // Adds a card at a position. Position comes from the caller (placement is
  // B104's core/placement.js); without one it goes below everything.
  addCard(id, card, { at = this.now(), event = "placed", data } = {}) {
    const d = this.get(id);
    if (!d) return null;
    if (!CARD_KINDS.has(card.kind)) throw new Error(`Unknown card kind: ${card.kind}`);
    if (card.url && isSensitiveUrl(card.url)) return null; // B66: never a card
    const [w, h] = SIZE[card.kind];
    const c = { id: card.id || shortId(card.kind[0]), w, h, pinned: false, ...card };
    if (typeof c.x !== "number" || typeof c.y !== "number") Object.assign(c, this.below(id, c.w));
    d.cards.push(c);
    if (event) this.event(id, { type: event, card: c.id, at, data });
    this.save(id);
    return c;
  }
  // A free spot under all cards, left-aligned. Used until B104 places cards.
  below(id, w = 260) {
    const cards = (this.get(id)?.cards || []).filter((c) => !c.removed);
    const groups = this.get(id)?.groups || [];
    const bottom = Math.max(0, ...cards.map((c) => c.y + c.h), ...groups.map((g) => g.y + g.h));
    return { x: 0, y: cards.length || groups.length ? bottom + 60 : 0, w };
  }
  updateCard(id, cardId, patch) {
    const c = this.card(id, cardId);
    if (!c) return null;
    Object.assign(c, patch);
    this.save(id);
    return c;
  }
  // The person moved a card: it is pinned and auto-layout never moves it again.
  moveCard(id, cardId, x, y, { at = this.now() } = {}) {
    const c = this.card(id, cardId);
    if (!c || this.get(id).trail.readonly) return null;
    c.x = Math.round(x);
    c.y = Math.round(y);
    c.pinned = true;
    this.event(id, { type: "moved", card: cardId, at, data: { x: c.x, y: c.y } });
    this.save(id);
    return c;
  }
  // Removing keeps the card's events and lines; putting it back restores them.
  removeCard(id, cardId, { at = this.now() } = {}) {
    const c = this.card(id, cardId);
    if (!c || c.removed) return null;
    c.removed = true;
    this.event(id, { type: "removed", card: cardId, at });
    this.save(id);
    return c;
  }
  restoreCard(id, cardId, { at = this.now(), x, y } = {}) {
    const c = this.card(id, cardId);
    if (!c || !c.removed) return null;
    delete c.removed;
    if (typeof x === "number") c.x = x;
    if (typeof y === "number") c.y = y;
    this.event(id, { type: "placed", card: cardId, at });
    this.save(id);
    return c;
  }
  // ---- pages becoming cards (B104, core/placement.js) ----
  // A page the person engaged with becomes a card near the page it was opened
  // from (from: that page's address), with an "opened from" line. A page that
  // already has a card is left alone; a removed one comes back where it was,
  // with its lines. near: the middle of the screen, in world units, used when
  // there is no source card. reason: what made it a card (dwell, scroll,
  // capture, link, ask, tab-open, put). Returns the card, or null.
  placePage(id, url, { title = "", keywords = [], from = "", near, reason = "", at = this.now(), x, y } = {}) {
    const d = this.get(id);
    if (!d || !url || isSensitiveUrl(url) || !isReading(url)) return null;
    const have = this.pageCard(id, url);
    if (have && !have.removed) return have;
    if (have) return this.restoreCard(id, have.id, { at, x, y });
    const [w, h] = SIZE.page;
    const source = from && from !== url ? this.pageCard(id, from) : null;
    let pos = typeof x === "number" && typeof y === "number" ? { x, y, moves: [] } : null;
    if (!pos) {
      const view = { cards: d.cards.filter((c) => !c.removed), groups: d.groups };
      pos = placeNear(view, source && !source.removed ? source : null, w, h, { near: near || this.below(id, w) });
      for (const m of pos.moves) {
        const o = (m.kind === "group" ? d.groups : d.cards).find((k) => k.id === m.id);
        if (!o) continue;
        if (typeof m.y === "number") o.y = m.y;
        if (typeof m.h === "number") o.h = m.h;
      }
    }
    const rows = this.pageRows(id);
    const row = rows.find((r) => r.url === url);
    const card = this.addCard(id, { kind: "page", url, title: String(title || row?.title || url).slice(0, 300), keywords: (keywords.length ? keywords : row?.keywords || []).slice(0, 6), placedAt: at, x: pos.x, y: pos.y }, { at, data: { url, reason } });
    if (card && source && !source.removed) this.link(id, source.id, card.id, { kind: "nav", at });
    return card;
  }
  // A visit that ended without the page becoming a card: kept in the timeline
  // as "timeline only" with its time on page (ms).
  bounce(id, url, dwell, { at = this.now() } = {}) {
    if (!url || !isReading(url) || !this.get(id) || this.pageCard(id, url)) return null;
    return this.event(id, { type: "bounced", at, data: { url, dwell: Math.round(dwell) } });
  }

  deleteCard(id, cardId, { at = this.now() } = {}) {
    const d = this.get(id);
    const i = d?.cards.findIndex((c) => c.id === cardId) ?? -1;
    if (i < 0) return false;
    d.cards.splice(i, 1);
    d.lines = d.lines.filter((l) => l.from !== cardId && l.to !== cardId);
    this.event(id, { type: "removed", card: cardId, at, data: { deleted: true } });
    this.save(id);
    return true;
  }
  // Lines are kept when a card is removed; the canvas hides lines whose ends
  // are not both placed.
  link(id, from, to, { kind = "you", label = "", at = this.now() } = {}) {
    const d = this.get(id);
    if (!d || !LINE_KINDS.has(kind) || from === to) return null;
    if (!this.card(id, from) || !this.card(id, to)) return null;
    const lab = LINE_LABELS.has(label) ? label : String(label || "").slice(0, 40);
    // One line per pair and kind; drawing over a grey line keeps the grey one.
    let line = d.lines.find((l) => l.from === from && l.to === to && l.kind === kind);
    if (line && line.label === lab) return line;
    if (line) {
      line.label = lab;
      this.event(id, { type: "linked", line: line.id, at, data: { label: lab } });
    } else {
      line = { id: shortId("l"), from, to, kind, label: lab };
      d.lines.push(line);
      this.event(id, { type: "linked", line: line.id, at, data: { from, to, kind, label: lab } });
    }
    this.save(id);
    return line;
  }
  unlink(id, lineId, { at = this.now() } = {}) {
    const d = this.get(id);
    const i = d?.lines.findIndex((l) => l.id === lineId) ?? -1;
    if (i < 0) return false;
    const [l] = d.lines.splice(i, 1);
    this.event(id, { type: "unlinked", line: lineId, at, data: { from: l.from, to: l.to } });
    this.save(id);
    return true;
  }
  // A card belongs to the group its centre sits in; membership is not stored.
  group(id, { x, y, w, h, label = "New group", at = this.now() } = {}) {
    const d = this.get(id);
    if (!d) return null;
    const g = { id: shortId("g"), x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), label: String(label).slice(0, 80), resolved: false, suggested: false };
    d.groups.push(g);
    this.event(id, { type: "grouped", group: g.id, at, data: { label: g.label, cards: this.cardsIn(id, g).map((c) => c.id) } });
    this.save(id);
    return g;
  }
  renameGroup(id, groupId, label, { at = this.now() } = {}) {
    const g = this.get(id)?.groups.find((x) => x.id === groupId);
    if (!g) return null;
    g.label = String(label || "").slice(0, 80) || g.label;
    this.event(id, { type: "renamed", group: groupId, at, data: { label: g.label } });
    this.save(id);
    return g;
  }
  resolveGroup(id, groupId, resolved = true, { at = this.now() } = {}) {
    const g = this.get(id)?.groups.find((x) => x.id === groupId);
    if (!g) return null;
    g.resolved = Boolean(resolved);
    this.event(id, { type: "resolved", group: groupId, at, data: { resolved: g.resolved } });
    this.save(id);
    return g;
  }
  // The person moved a group by its name: the group and its cards move
  // together, and those cards are pinned.
  moveGroup(id, groupId, x, y, { at = this.now() } = {}) {
    const d = this.get(id);
    const g = d?.groups.find((k) => k.id === groupId);
    if (!g || d.trail.readonly) return null;
    const dx = Math.round(x) - g.x, dy = Math.round(y) - g.y;
    const inside = this.cardsIn(id, g);
    g.x += dx;
    g.y += dy;
    for (const c of inside) {
      c.x += dx;
      c.y += dy;
      c.pinned = true;
    }
    this.event(id, { type: "moved", group: groupId, at, data: { x: g.x, y: g.y, cards: inside.map((c) => c.id) } });
    this.save(id);
    return g;
  }
  // A new label on a line ("" for none). Recorded as a linked event.
  labelLine(id, lineId, label, { at = this.now() } = {}) {
    const l = this.get(id)?.lines.find((k) => k.id === lineId);
    if (!l) return null;
    const lab = LINE_LABELS.has(label) ? label : String(label || "").slice(0, 40);
    if (l.label === lab) return l;
    l.label = lab;
    this.event(id, { type: "linked", line: lineId, at, data: { label: lab } });
    this.save(id);
    return l;
  }
  // A note made on the canvas, not tied to a page.
  freeNote(id, { x, y, text, by = "", at = this.now() } = {}) {
    const t = String(text || "").trim().slice(0, 2000);
    if (!t) return null;
    return this.addCard(id, { kind: "note", text: t, author: by, at, x: Math.round(x), y: Math.round(y) }, { at, event: "noted" });
  }

  cardsIn(id, g) {
    return (this.get(id)?.cards || []).filter((c) => !c.removed && c.x + c.w / 2 >= g.x && c.x + c.w / 2 <= g.x + g.w && c.y + c.h / 2 >= g.y && c.y + c.h / 2 <= g.y + g.h);
  }

  // ---- visits ----
  // A page was opened (or read again). Records an "opened" event; a page that
  // already has a card gets its title and keywords updated. Whether a page
  // becomes a card is decided by B104; until then visits are timeline items.
  visit(id, url, { title = "", keywords = [], at = this.now(), dwell, from, count = 1 } = {}) {
    if (!isReading(url) || !this.get(id)) return null;
    const data = { url, title: String(title || url).slice(0, 300) };
    if (keywords.length) data.keywords = keywords.slice(0, 6);
    if (typeof dwell === "number") data.dwell = Math.round(dwell);
    if (from) data.from = from;
    if (count !== 1) data.count = count;
    const card = this.pageCard(id, url);
    if (card) {
      if (title) card.title = data.title;
      if (keywords.length) card.keywords = data.keywords;
      this.save(id);
    }
    return this.event(id, { type: "opened", card: card?.id, at, data });
  }

  // One row per page read in the trail, oldest first: the "trail" list the
  // old sidebar shows. Built from opened events and page cards.
  pageRows(id = this.index.current) {
    const t = this.load(id);
    if (!t) return [];
    const rows = new Map();
    for (const e of t.events) {
      if (e.type !== "opened" || !e.data?.url) continue;
      let r = rows.get(e.data.url);
      if (!r) rows.set(e.data.url, (r = { url: e.data.url, title: e.data.title || e.data.url, firstAt: e.at, lastAt: e.at, visits: 0, keywords: [], dwell: null }));
      r.visits += e.data.count || 1;
      r.firstAt = Math.min(r.firstAt, e.at);
      r.lastAt = Math.max(r.lastAt, e.data.lastAt || e.at);
      if (e.data.title) r.title = e.data.title;
      if (e.data.keywords?.length) r.keywords = e.data.keywords;
      if (typeof e.data.dwell === "number") r.dwell = (r.dwell || 0) + e.data.dwell;
    }
    for (const c of t.data.cards) {
      if ((c.kind !== "page" && c.kind !== "video") || !c.url) continue;
      const r = rows.get(c.url);
      if (r) {
        r.card = c.id;
        if (c.tags?.length) r.tags = c.tags.slice();
        if (c.removed) r.removed = true;
      }
    }
    return [...rows.values()].sort((a, b) => a.firstAt - b.firstAt);
  }

  // ---- timeline ----
  // Sessions: events grouped by device, a gap of over 30 minutes starts a new
  // one. Newest session first; items newest first. Timeline-only pages are
  // opened events whose page has no card on the canvas.
  timeline(id = this.index.current) {
    const t = this.load(id);
    if (!t) return [];
    const cardsById = new Map(t.data.cards.map((c) => [c.id, c]));
    const pageCard = new Map(t.data.cards.filter((c) => c.url).map((c) => [c.url, c]));
    const shown = t.events.filter((e) => ["opened", "bounced", "captured", "asked", "reported", "noted"].includes(e.type));
    const sessions = [];
    const open = new Map(); // device -> its latest session
    for (const e of shown) {
      const device = e.device || "desktop";
      let s = open.get(device);
      if (!s || e.at - s.endAt > SESSION_GAP_MS) {
        s = { device, startAt: e.at, endAt: e.at, items: [] };
        sessions.push(s);
        open.set(device, s);
      }
      // A visit that ended without the page becoming a card: its time on page.
      if (e.type === "bounced") {
        const it = s.items.findLast((i) => i.type === "opened" && i.url === e.data?.url);
        if (it && typeof e.data?.dwell === "number") it.dwell = e.data.dwell;
        continue;
      }
      s.endAt = Math.max(s.endAt, e.at);
      const url = e.data?.url;
      const card = (e.card && cardsById.get(e.card)) || (url && pageCard.get(url)) || null;
      const item = { event: e.id, type: e.type, at: e.at, card: card && !card.removed ? card.id : null };
      if (url) item.url = url;
      item.title = (card && (card.title || card.text || card.quote)) || e.data?.title || url || e.type;
      if (e.type === "opened") {
        // An opened page shows once per session, at its latest time.
        const prev = s.items.find((i) => i.type === "opened" && i.url === url);
        if (prev) s.items.splice(s.items.indexOf(prev), 1);
        item.timelineOnly = !card || Boolean(card.removed);
        if (card?.removed) item.removedFromCanvas = true;
        item.dwell = typeof e.data?.dwell === "number" ? e.data.dwell : prev?.dwell ?? null;
        if (e.data?.migrated) item.dwellUnknown = item.dwell === null;
      }
      s.items.push(item);
    }
    for (const s of sessions) {
      s.id = hashId("s", s.device, s.startAt);
      s.items.reverse();
    }
    return sessions.reverse();
  }

  // ---- view state ----
  view(id = this.index.current) {
    return this.load(id)?.view || blankView();
  }
  setView(id, patch) {
    const t = this.load(id);
    if (!t) return null;
    for (const k of ["x", "y", "z"]) if (typeof patch[k] === "number" && Number.isFinite(patch[k])) t.view[k] = k === "z" ? Math.min(2.5, Math.max(0.2, patch[k])) : patch[k];
    if ("selected" in patch) t.view.selected = patch.selected || null;
    if (Array.isArray(patch.openTabs)) t.view.openTabs = patch.openTabs.filter((u) => /^https?:/i.test(u)).slice(0, 200);
    if (Array.isArray(patch.mosaic)) t.view.mosaic = patch.mosaic.slice(0, 12);
    this.saveView(id);
    return t.view;
  }

  // Everything the canvas needs for one trail.
  snapshot(id = this.index.current) {
    const t = this.load(id);
    if (!t) return null;
    const { trail, cards, groups, lines } = t.data;
    return { trail, cards: cards.filter((c) => !c.removed), groups, lines, timeline: this.timeline(id), view: t.view, removed: cards.filter((c) => c.removed).map((c) => c.id) };
  }

  // ---- the session view (for the research:* channels) ----
  // The old sidebar, suggestions, threads, share files and the MCP server all
  // read a "session" object (core/research.js). sessionView builds one from a
  // trail; applySession writes changes made to it back into the trail as
  // events and cards. So research:* keeps working on top of the trail store.
  sessionView(id = this.index.current) {
    const t = this.load(id);
    if (!t) return null;
    const { trail, cards, research } = t.data;
    const notesByUrl = new Map();
    // Removed cards are still part of the trail (only off the canvas), so
    // their notes and threads stay in the session view.
    for (const c of cards) if (c.kind === "note" && c.page) (notesByUrl.get(c.page) || notesByUrl.set(c.page, []).get(c.page)).push({ id: c.id, by: c.author || "", at: c.at || 0, text: c.text || "" });
    const rows = this.pageRows(id).map((r) => {
      const row = { url: r.url, title: r.title, firstAt: r.firstAt, lastAt: r.lastAt, visits: r.visits, keywords: r.keywords.slice() };
      if (r.tags?.length) row.tags = r.tags;
      const notes = notesByUrl.get(r.url);
      if (notes?.length) row.notes = notes;
      return row;
    });
    const threadList = cards
      .filter((c) => c.kind === "question" && !c.search)
      .map((c) => ({ id: c.id, title: c.title, status: c.status === "resolved" ? "resolved" : "open", conclusion: c.conclusion || "", tags: (c.tags || []).slice(), pages: (c.pages || []).slice(), by: c.by || "", at: c.at || 0, replies: JSON.parse(JSON.stringify(c.replies || [])) }));
    const s = {
      id: trail.id,
      name: trail.name,
      started: trail.createdAt,
      updated: trail.lastAt,
      pins: research.pins.slice(),
      trail: rows,
      opened: research.opened.slice(),
      dismissed: research.dismissed.slice(),
      threadList,
    };
    for (const k of ["reports", "captures", "shareLog", "agent", "extra", "tags"]) if (research[k]?.length) s[k] = JSON.parse(JSON.stringify(research[k]));
    if (research.sharedId) s.sharedId = research.sharedId;
    return s;
  }

  applySession(session) {
    if (!session?.id) return null;
    let id = session.id;
    if (!this.get(id)) this.create(session.name, { at: session.started || this.now(), id, current: false });
    const d = this.get(id);
    const now = this.now();
    if (session.name && session.name !== d.trail.name) {
      d.trail.name = String(session.name).slice(0, 120);
      d.trail.mono = monogram(d.trail.name);
    }
    if (session.started && session.started < d.trail.createdAt) d.trail.createdAt = session.started;
    const r = d.research;
    r.pins = (session.pins || []).map(String).slice(0, 12);
    r.opened = (session.opened || []).filter((o) => !isSensitiveUrl(o.url)).slice(-500);
    r.dismissed = (session.dismissed || []).slice(-1000);
    r.shareLog = session.shareLog || [];
    r.agent = session.agent || [];
    r.extra = session.extra || [];
    r.tags = session.tags || [];
    r.sharedId = session.sharedId || "";

    // Pages: new visits become opened events; titles, keywords and tags go on
    // the page's card when it has one.
    const rows = new Map(this.pageRows(id).map((x) => [x.url, x]));
    for (const row of session.trail || []) {
      if (!isReading(row.url)) continue;
      const known = rows.get(row.url);
      const have = known?.visits || 0;
      if ((row.visits || 1) > have) this.visit(id, row.url, { title: row.title, keywords: row.keywords || [], at: Math.max(row.lastAt || now, known?.lastAt || 0), count: (row.visits || 1) - have });
      const card = this.pageCard(id, row.url);
      if (card) {
        if (row.title) card.title = row.title;
        if (row.keywords?.length) card.keywords = row.keywords.slice(0, 6);
        card.tags = (row.tags || []).slice();
      }
      // Page notes are note cards linked to their page (decided 2026-11-05).
      const noteIds = new Set((row.notes || []).map((n) => n.id));
      for (const n of row.notes || []) if (!this.card(id, n.id)) this.noteCard(id, row.url, n);
      for (const c of d.cards.filter((c) => c.kind === "note" && c.page === row.url && !noteIds.has(c.id))) this.deleteCard(id, c.id, { at: now });
    }

    // Threads are question cards; the card id is the thread id.
    const threadIds = new Set();
    for (const th of session.threadList || []) {
      threadIds.add(th.id);
      this.questionCard(id, th, { at: now });
    }
    for (const c of d.cards.filter((c) => c.kind === "question" && !c.search && !threadIds.has(c.id))) this.deleteCard(id, c.id, { at: now });

    // Reports and captures: kept as the sidebar has them, and as cards.
    r.reports = (session.reports || []).slice();
    for (const rep of r.reports) this.reportCard(id, rep);
    r.captures = (session.captures || []).filter((c) => !isSensitiveUrl(c.url)).slice(-500);
    for (const cap of r.captures) this.captureCard(id, cap);
    if (session.updated && session.updated > d.trail.lastAt) d.trail.lastAt = session.updated;
    this.save(id);
    return d;
  }

  noteCard(id, url, n, { place } = {}) {
    const page = this.pageCard(id, url);
    const pos = place || (page ? { x: page.x + page.w + 40, y: page.y } : {});
    const c = this.addCard(id, { id: n.id || shortId("n"), kind: "note", text: String(n.text || "").slice(0, 2000), author: n.by || "", at: n.at || this.now(), page: url, ...pos }, { at: n.at || this.now(), event: "noted", data: { url } });
    if (c && page) this.link(id, c.id, page.id, { kind: "auto", label: "", at: n.at || this.now() });
    return c;
  }
  questionCard(id, th, { at = this.now(), place } = {}) {
    let c = this.card(id, th.id);
    const fields = { title: String(th.title || "Question").slice(0, 200), status: th.status === "resolved" ? "resolved" : "open", conclusion: th.conclusion || "", tags: (th.tags || []).slice(), pages: (th.pages || []).slice(), by: th.by || "", at: th.at || at, replies: JSON.parse(JSON.stringify(th.replies || [])) };
    if (!c) {
      c = this.addCard(id, { id: th.id, kind: "question", ...fields, ...(place || {}) }, { at: th.at || at, event: "asked", data: { title: fields.title } });
    } else {
      const was = c.status;
      Object.assign(c, fields);
      if (was !== c.status) this.event(id, { type: "resolved", card: c.id, at, data: { status: c.status, conclusion: c.conclusion } });
    }
    // Pages linked to the thread: drawn lines from the page to the question.
    for (const url of fields.pages) {
      const p = this.pageCard(id, url);
      if (p && c) this.link(id, p.id, c.id, { kind: "you", at: th.at || at });
    }
    return c;
  }
  reportCard(id, rep, { place } = {}) {
    const cid = hashId("r", rep.file || "", String(rep.at || ""));
    if (this.card(id, cid)) return this.card(id, cid);
    return this.addCard(id, { id: cid, kind: "report", title: String(rep.question || "Report").slice(0, 300), excerpt: "", sources: (rep.sources || []).slice(0, 12), file: rep.file || "", at: rep.at || this.now(), ...(place || {}) }, { at: rep.at || this.now(), event: "reported" });
  }
  captureCard(id, cap, { place } = {}) {
    if (isSensitiveUrl(cap.url)) return null;
    const cid = hashId("c", cap.libraryId || "", String(cap.at || ""), cap.name || "");
    if (this.card(id, cid)) return this.card(id, cid);
    const c = this.addCard(id, { id: cid, kind: "capture", quote: "", source: cap.url ? hostOf(cap.url) : "", url: cap.url || "", title: cap.title || cap.name || "", time: cap.at || this.now(), device: this.device, shot: cap.kind === "shot" ? cap.name : "", libraryId: cap.libraryId || "", captureKind: cap.kind || "shot", ...(place || {}) }, { at: cap.at || this.now(), event: "captured", data: { url: cap.url || "" } });
    const page = cap.url && this.pageCard(id, cap.url);
    if (c && page) this.link(id, page.id, c.id, { kind: "auto", label: "captured from", at: cap.at || this.now() });
    return c;
  }
}

// ---- migration from research sessions (sessions/*.json) ----
// Each page visited becomes an opened event. Sessions never recorded time on
// page, so a page becomes a card when the recorded signals show engagement:
//   - 20 s or more between the first and last time NODE read the page
//     (NODE reads a page again only after scrolling, selecting or coming back)
//   - read twice or more
//   - it has a note, or a thread links it
//   - its tab is still open in that trail
// Other pages stay timeline-only, marked as having no recorded time on page.
// Threads become question cards, reports report cards, notes note cards,
// captures capture cards. The session files are left in place.
function engaged(row, { linked, openUrls }) {
  return (row.lastAt || 0) - (row.firstAt || 0) >= ENGAGED_MS || (row.visits || 0) >= 2 || Boolean(row.notes?.length) || linked.has(row.url) || openUrls.has(row.url);
}

// Lays migrated cards out in rows of four, oldest first, questions first.
function gridSpot(n, w, h, top) {
  const COLS = 4, GAP_X = 40, GAP_Y = 40, CELL_W = 260;
  return { x: (n % COLS) * (CELL_W + GAP_X), y: top, w, h };
}

function migrateSessions(sessionStorage, store, { openTabsByTrail = {}, now = Date.now() } = {}) {
  const names = sessionStorage.list().filter((n) => n.endsWith(".json"));
  const result = { trails: 0, cards: 0, timelineOnly: 0, skipped: [] };
  const sessions = [];
  for (const name of names) {
    try {
      const s = JSON.parse(sessionStorage.read(name));
      if (s && s.id && Array.isArray(s.trail)) sessions.push(s);
    } catch (_) {
      result.skipped.push(name);
    }
  }
  sessions.sort((a, b) => (a.updated || 0) - (b.updated || 0));
  const currentId = (sessionStorage.read("current.txt") || "").trim();
  for (const s of sessions) {
    if (store.has(s.id)) continue; // already migrated
    store.create(s.name, { at: s.started || now, id: s.id, current: false });
    const id = s.id;
    const d = store.get(id);
    const r = d.research;
    r.pins = (s.pins || []).slice(0, 12);
    r.opened = (s.opened || []).filter((o) => !isSensitiveUrl(o.url));
    r.dismissed = (s.dismissed || []).slice();
    r.shareLog = s.shareLog || [];
    r.agent = s.agent || [];
    r.extra = s.extra || [];
    r.tags = s.tags || [];
    r.sharedId = s.sharedId || "";
    const linked = new Set((s.threadList || []).flatMap((t) => t.pages || []));
    const openUrls = new Set(openTabsByTrail[id] || []);

    // Layout, top to bottom: questions, then pages (with their notes beside
    // them), then reports and captures. Rows of four, 40 px apart.
    let y = 0;
    let rowH = 0;
    let col = 0;
    const next = (w, h) => {
      if (col === 4) {
        y += rowH + 40;
        rowH = 0;
        col = 0;
      }
      const spot = gridSpot(col, w, h, y);
      col += 1;
      rowH = Math.max(rowH, h);
      return spot;
    };
    const newRow = () => {
      if (col) {
        y += rowH + 80;
        rowH = 0;
        col = 0;
      }
    };
    for (const th of (s.threadList || []).slice().sort((a, b) => (a.at || 0) - (b.at || 0))) {
      const [w, h] = SIZE.question;
      store.questionCard(id, { ...th, pages: [] }, { at: th.at || s.started || now, place: next(w, h) });
      result.cards += 1;
    }
    newRow();
    for (const row of (s.trail || []).slice().sort((a, b) => (a.firstAt || 0) - (b.firstAt || 0))) {
      if (!isReading(row.url)) continue;
      const first = row.firstAt || s.started || now;
      // One opened event per page, with the visit count and the last read time.
      const data = { url: row.url, title: row.title || row.url, migrated: true };
      if (row.keywords?.length) data.keywords = row.keywords.slice(0, 6);
      if ((row.visits || 1) !== 1) data.count = row.visits;
      if (row.lastAt && row.lastAt !== first) data.lastAt = row.lastAt;
      if (engaged(row, { linked, openUrls })) {
        const [w, h] = SIZE.page;
        const card = store.addCard(id, { kind: "page", url: row.url, site: hostOf(row.url), title: row.title || row.url, excerpt: "", keywords: (row.keywords || []).slice(0, 6), tags: (row.tags || []).slice(), ...next(w, h) }, { at: first, event: null });
        store.event(id, { type: "opened", card: card.id, at: first, data });
        store.event(id, { type: "placed", card: card.id, at: first, data: { migrated: true } });
        result.cards += 1;
        for (const n of row.notes || []) {
          const [nw, nh] = SIZE.note;
          store.noteCard(id, row.url, n, { place: next(nw, nh) });
          result.cards += 1;
        }
      } else {
        store.event(id, { type: "opened", at: first, data });
        result.timelineOnly += 1;
      }
    }
    newRow();
    // Thread page links now that the page cards exist.
    for (const th of s.threadList || []) store.questionCard(id, th, { at: th.at || now });
    for (const rep of s.reports || []) {
      const [w, h] = SIZE.report;
      store.reportCard(id, rep, { place: next(w, h) });
      result.cards += 1;
    }
    r.reports = (s.reports || []).slice();
    const caps = (s.captures || []).filter((c) => !isSensitiveUrl(c.url));
    for (const cap of caps) {
      const [w, h] = SIZE.capture;
      if (store.captureCard(id, cap, { place: next(w, h) })) result.cards += 1;
    }
    r.captures = caps;
    d.trail.lastAt = Math.max(d.trail.lastAt, s.updated || 0);
    store.save(id);
    result.trails += 1;
  }
  // Most recently used first; NODE opens on the session that was current.
  const byUse = store.ids().sort((a, b) => (store.get(b)?.trail.lastAt || 0) - (store.get(a)?.trail.lastAt || 0));
  store.index.order = byUse;
  if (currentId && store.has(currentId)) store.index.current = currentId;
  else if (!store.index.current && byUse.length) store.index.current = byUse[0];
  store.index.migratedAt = now;
  store.saveIndex();
  return result;
}

// A storage object for ResearchStore (core/research.js) that reads and writes
// sessions through the trail store: "<id>.json" is a trail's session view,
// "current.txt" is the trail NODE is on. This keeps every research:* channel
// working on the new storage.
function sessionStorageOver(store) {
  return {
    read(name) {
      if (name === "current.txt") return store.index.current || null;
      const m = /^(.+)\.json$/.exec(name);
      const s = m && store.sessionView(m[1]);
      return s ? JSON.stringify(s) : null;
    },
    write(name, text) {
      if (name === "current.txt") {
        const id = String(text || "").trim();
        if (id && store.has(id) && store.index.current !== id) store.switchTo(id);
        return;
      }
      const m = /^(.+)\.json$/.exec(name);
      if (!m) return;
      try {
        store.applySession(JSON.parse(text));
      } catch (_) {}
    },
    list() {
      return store.ids().map((id) => `${id}.json`).concat(store.index.current ? ["current.txt"] : []);
    },
  };
}

module.exports = { TrailStore, migrateSessions, sessionStorageOver, monogram, hashId, SIZE, ENGAGED_MS, SESSION_GAP_MS, EVENT_TYPES, CARD_KINDS, LINE_KINDS };
