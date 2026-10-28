// Research sessions (B17).
// A session holds what one line of research has touched: pinned keywords, the
// trail of pages read (with their top keywords), suggestions opened and
// suggestions dismissed. Each session is saved as "<id>.json" through a
// storage object (see storage.js): files on desktop, app storage on mobile.

const TRAIL_MAX = 500;
// Start pages and search-result pages are not research reading.
const { isSensitiveUrl } = require("./urls");

const NOT_READING = /wikipedia\.org\/wiki\/(Main_Page|Special:)|duckduckgo\.com\/(\?|html)|google\.[a-z.]+\/search|bing\.com\/search|search\.brave\.com\/search/i;

function newId() {
  return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14) + "-" + Math.random().toString(36).slice(2, 6);
}

function shortId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
const clean = (t, max) => String(t || "").replace(/\r\n/g, "\n").trim().slice(0, max);
const cleanTags = (tags) => [...new Set((tags || []).map((t) => String(t).trim().replace(/^#/, "").slice(0, 40)).filter(Boolean))].slice(0, 8);

function blank(name) {
  const now = Date.now();
  return {
    id: newId(),
    name: name || `Research ${new Date(now).toLocaleDateString()}`,
    started: now,
    updated: now,
    pins: [],
    trail: [], // { url, title, firstAt, lastAt, visits, keywords: [] }
    opened: [], // { url, title, query, at }
    dismissed: [], // urls
  };
}

// Sessions saved before 0.9.1 may hold sign-in, account, payment or banking
// pages: take them out when the session is opened. Returns true if any went.
function prune(session) {
  if (!session) return false;
  let removed = 0;
  for (const key of ["trail", "opened"]) {
    const list = session[key] || [];
    const kept = list.filter((r) => !isSensitiveUrl(r.url));
    removed += list.length - kept.length;
    session[key] = kept;
  }
  if (Array.isArray(session.captures)) {
    const kept = session.captures.filter((c) => !isSensitiveUrl(c.url));
    removed += session.captures.length - kept.length;
    session.captures = kept;
  }
  return removed > 0;
}

class ResearchStore {
  /** @param storage {{ read(name): string|null, write(name, text), list(): string[] }} */
  constructor(storage) {
    this.storage = storage;
    this.timer = null;
    this.current = this.loadCurrent() || this.create();
    if (prune(this.current)) this.saveNow();
  }

  file(id) {
    return `${id}.json`;
  }

  loadCurrent() {
    try {
      const id = (this.storage.read("current.txt") || "").trim();
      return id ? JSON.parse(this.storage.read(this.file(id))) : null;
    } catch {
      return null;
    }
  }

  saveNow() {
    clearTimeout(this.timer);
    this.current.updated = Date.now();
    this.storage.write(this.file(this.current.id), JSON.stringify(this.current, null, 2));
    this.storage.write("current.txt", this.current.id);
  }

  saveSoon() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      try {
        this.saveNow();
      } catch (_) {}
    }, 800);
  }

  create(name) {
    if (this.current) this.saveNow();
    this.current = blank(name);
    this.saveNow();
    return this.current;
  }

  list() {
    const out = [];
    for (const f of this.storage.list()) {
      if (!f.endsWith(".json")) continue;
      try {
        const s = JSON.parse(this.storage.read(f));
        out.push({ id: s.id, name: s.name, started: s.started, updated: s.updated, pages: s.trail.length, captures: (s.captures || []).length, threadCount: (s.threadList || []).length, current: s.id === this.current.id });
      } catch (_) {}
    }
    return out.sort((a, b) => b.updated - a.updated);
  }

  switchTo(id) {
    const s = JSON.parse(this.storage.read(this.file(id)));
    this.saveNow();
    this.current = s;
    prune(s);
    this.saveNow();
    return s;
  }

  rename(name) {
    this.current.name = String(name || "").trim().slice(0, 120) || this.current.name;
    this.saveSoon();
  }

  setPins(pins) {
    this.current.pins = (pins || []).map(String).slice(0, 12);
    this.saveSoon();
  }

  // Record that a page was read, with its top keywords.
  visit(url, title, keywords = []) {
    // Sign-in, account, payment and banking pages never enter the trail (B66).
    if (!/^https?:/i.test(url || "") || NOT_READING.test(url) || isSensitiveUrl(url)) return;
    const t = this.current.trail;
    let row = t.find((r) => r.url === url);
    if (!row) {
      row = { url, title: title || url, firstAt: Date.now(), lastAt: Date.now(), visits: 0, keywords: [] };
      t.push(row);
      if (t.length > TRAIL_MAX) t.shift();
    }
    row.visits += 1;
    row.lastAt = Date.now();
    if (title) row.title = title;
    if (keywords.length) row.keywords = keywords.slice(0, 6);
    this.saveSoon();
  }

  opened(item) {
    if (!item?.url || isSensitiveUrl(item.url)) return;
    this.current.opened.push({ url: item.url, title: item.title || item.url, query: item.query || "", at: Date.now() });
    this.saveSoon();
  }

  dismiss(url) {
    if (url && !this.current.dismissed.includes(url)) this.current.dismissed.push(url);
    this.saveSoon();
  }

  undismissAll() {
    this.current.dismissed = [];
    this.saveSoon();
  }

  // Keywords that recur across the pages of this session, most frequent first.
  threads(limit = 10, session = this.current) {
    const count = new Map();
    for (const row of session.trail) {
      for (const k of row.keywords) {
        const key = k.toLowerCase();
        const c = count.get(key) || { term: k, pages: 0 };
        c.pages += 1;
        count.set(key, c);
      }
    }
    return [...count.values()].filter((c) => c.pages > 1).sort((a, b) => b.pages - a.pages).slice(0, limit);
  }

  snapshot() {
    return { ...this.current, threads: this.threads() };
  }

  // ---- Threads people write (B82) ----
  // A thread is a question or topic in the trail, with replies that can be
  // answered, like a Reddit thread. Kept in session.threadList (session.threads
  // is the keyword list sent to the renderer, so the name is different).
  // { id, title, status: open|resolved, conclusion, tags, pages, by, at, replies: [{ id, by, at, text, replies }] }
  threadList(session = this.current) {
    return (session.threadList = session.threadList || []);
  }

  findThread(id) {
    return this.threadList().find((t) => t.id === id) || null;
  }

  // The reply with this id anywhere in the thread, or null.
  findReply(thread, id) {
    const walk = (list) => {
      for (const r of list || []) {
        if (r.id === id) return r;
        const hit = walk(r.replies);
        if (hit) return hit;
      }
      return null;
    };
    return walk(thread?.replies);
  }

  addThread({ title, by = "", text = "", tags = [], pages = [] } = {}) {
    const name = clean(title, 200);
    if (!name) return null;
    const thread = { id: shortId("t"), title: name, status: "open", conclusion: "", tags: cleanTags(tags), pages: pages.filter((u) => /^https?:/i.test(u || "") && !isSensitiveUrl(u)).slice(0, 20), by: clean(by, 60), at: Date.now(), replies: [] };
    this.threadList().push(thread);
    if (clean(text, 4000)) thread.replies.push({ id: shortId("r"), by: thread.by, at: thread.at, text: clean(text, 4000), replies: [] });
    this.saveSoon();
    return thread;
  }

  // A reply to the thread (parentId empty) or to one of its replies.
  reply(threadId, { parentId = "", by = "", text = "" } = {}) {
    const thread = this.findThread(threadId);
    const body = clean(text, 4000);
    if (!thread || !body) return null;
    const parent = parentId ? this.findReply(thread, parentId) : thread;
    if (!parent) return null;
    const r = { id: shortId("r"), by: clean(by, 60), at: Date.now(), text: body, replies: [] };
    (parent.replies = parent.replies || []).push(r);
    this.saveSoon();
    return r;
  }

  resolveThread(id, conclusion = "") {
    const t = this.findThread(id);
    if (!t) return null;
    t.status = "resolved";
    if (clean(conclusion, 2000)) t.conclusion = clean(conclusion, 2000);
    this.saveSoon();
    return t;
  }

  reopenThread(id) {
    const t = this.findThread(id);
    if (!t) return null;
    t.status = "open";
    this.saveSoon();
    return t;
  }

  editThread(id, { title, tags, pages } = {}) {
    const t = this.findThread(id);
    if (!t) return null;
    if (title !== undefined && clean(title, 200)) t.title = clean(title, 200);
    if (tags !== undefined) t.tags = cleanTags(tags);
    if (pages !== undefined) t.pages = pages.filter((u) => /^https?:/i.test(u || "") && !isSensitiveUrl(u)).slice(0, 20);
    this.saveSoon();
    return t;
  }

  removeThread(id) {
    const list = this.threadList();
    const i = list.findIndex((t) => t.id === id);
    if (i < 0) return false;
    list.splice(i, 1);
    this.saveSoon();
    return true;
  }

  // Recurring keywords that have no thread yet: suggestions to start one.
  threadSuggestions(limit = 3) {
    const have = new Set(this.threadList().flatMap((t) => [t.title.toLowerCase(), ...t.tags.map((x) => x.toLowerCase())]));
    return this.threads(10).filter((k) => !have.has(k.term.toLowerCase())).slice(0, limit);
  }

  // ---- Page notes (B82) ----
  addNote(url, { by = "", text = "" } = {}) {
    const row = this.current.trail.find((r) => r.url === url);
    const body = clean(text, 2000);
    if (!row || !body) return null;
    const note = { id: shortId("n"), by: clean(by, 60), at: Date.now(), text: body };
    (row.notes = row.notes || []).push(note);
    this.saveSoon();
    return note;
  }

  removeNote(url, id) {
    const row = this.current.trail.find((r) => r.url === url);
    const i = (row?.notes || []).findIndex((n) => n.id === id);
    if (i < 0) return false;
    row.notes.splice(i, 1);
    this.saveSoon();
    return true;
  }

  // A saved session by id (the current one if it matches), or null.
  read(id) {
    if (!id || id === this.current.id) return this.current;
    try {
      return JSON.parse(this.storage.read(this.file(id)));
    } catch (_) {
      return null;
    }
  }

  // Calls made by AI agents through NODE's MCP server, kept with the session.
  agentActivity(entry) {
    const log = (this.current.agent = this.current.agent || []);
    log.push({ at: entry.at || Date.now(), tool: String(entry.tool || ""), ok: entry.ok !== false, detail: String(entry.detail || "").slice(0, 300) });
    if (log.length > 200) log.splice(0, log.length - 200);
    this.saveSoon();
  }

  // A screenshot, saved page or saved media file taken during this session.
  // The file lives in the Library; the session keeps a link to it.
  capture({ libraryId, kind, name, url, title }) {
    // The file stays in the Library; a sign-in or payment page is not linked into the session.
    if (isSensitiveUrl(url)) return;
    const list = (this.current.captures = this.current.captures || []);
    list.push({ at: Date.now(), libraryId: String(libraryId || ""), kind: String(kind || "shot"), name: String(name || ""), url: String(url || ""), title: String(title || "").slice(0, 300) });
    if (list.length > 500) list.splice(0, list.length - 500);
    // A page captured counts as read, even if NODE had not recorded it yet.
    if (/^https?:/i.test(url || "") && !this.current.trail.some((r) => r.url === url)) this.visit(url, title);
    this.saveSoon();
  }

  // A report written by the built-in research agent.
  addReport({ question, file, sources }) {
    const list = (this.current.reports = this.current.reports || []);
    list.push({ at: Date.now(), question: String(question || "").slice(0, 500), file: String(file || ""), sources: (sources || []).slice(0, 12) });
    this.saveSoon();
  }

  markdown(id) {
    const s = this.read(id) || this.current;
    const fmt = (ms) => new Date(ms).toLocaleString();
    const md = (t) => String(t || "").replace(/([\[\]])/g, "\\$1");
    const lines = [`# ${s.name}`, "", `Started ${fmt(s.started)}. ${s.trail.length} pages read, ${s.opened.length} suggestions opened.`, ""];
    if (s.pins.length) lines.push("## Pinned keywords", "", ...s.pins.map((p) => `- ${p}`), "");
    const threads = this.threads(10, s);
    if (threads.length) lines.push("## Recurring keywords", "", ...threads.map((t) => `- ${t.term} (${t.pages} pages)`), "");
    lines.push("## Pages read", "");
    s.trail.forEach((r, i) => {
      lines.push(`${i + 1}. [${md(r.title)}](${r.url})${r.keywords.length ? ` — ${r.keywords.join(", ")}` : ""}`);
    });
    if (s.opened.length) {
      lines.push("", "## Suggestions opened", "");
      for (const o of s.opened) lines.push(`- [${md(o.title)}](${o.url})${o.query ? ` — from "${o.query}"` : ""}`);
    }
    if (s.captures?.length) {
      const label = { shot: "Screenshot", save: "Saved page", media: "Saved media" };
      lines.push("", "## Captures", "");
      for (const c of s.captures) lines.push(`- ${fmt(c.at)} · ${label[c.kind] || c.kind}: ${c.name}${c.url ? ` — from [${md(c.title || c.url)}](${c.url})` : ""}`);
    }
    if (s.reports?.length) {
      lines.push("", "## Research agent reports", "");
      for (const r of s.reports) lines.push(`- ${fmt(r.at)} · ${r.question}${r.file ? ` (Library: ${r.file})` : ""}`);
    }
    if (s.agent?.length) {
      lines.push("", "## Agent activity", "");
      for (const a of s.agent) lines.push(`- ${fmt(a.at)} · ${a.tool}${a.ok ? "" : " (refused)"}${a.detail ? ` · ${a.detail}` : ""}`);
    }
    return lines.join("\n") + "\n";
  }
}

module.exports = { ResearchStore };
