// Research sessions (B17).
// A session holds what one line of research has touched: pinned keywords, the
// trail of pages read (with their top keywords), suggestions opened and
// suggestions dismissed. Each session is saved as "<id>.json" through a
// storage object (see storage.js): files on desktop, app storage on mobile.

const TRAIL_MAX = 500;
// Start pages and search-result pages are not research reading.
const NOT_READING = /wikipedia\.org\/wiki\/(Main_Page|Special:)|duckduckgo\.com\/(\?|html)|google\.[a-z.]+\/search|bing\.com\/search|search\.brave\.com\/search/i;

function newId() {
  return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14) + "-" + Math.random().toString(36).slice(2, 6);
}

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

class ResearchStore {
  /** @param storage {{ read(name): string|null, write(name, text), list(): string[] }} */
  constructor(storage) {
    this.storage = storage;
    this.timer = null;
    this.current = this.loadCurrent() || this.create();
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
        out.push({ id: s.id, name: s.name, started: s.started, updated: s.updated, pages: s.trail.length, current: s.id === this.current.id });
      } catch (_) {}
    }
    return out.sort((a, b) => b.updated - a.updated);
  }

  switchTo(id) {
    const s = JSON.parse(this.storage.read(this.file(id)));
    this.saveNow();
    this.current = s;
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
    if (!/^https?:/i.test(url || "") || NOT_READING.test(url)) return;
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
    if (!item?.url) return;
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
    if (s.agent?.length) {
      lines.push("", "## Agent activity", "");
      for (const a of s.agent) lines.push(`- ${fmt(a.at)} · ${a.tool}${a.ok ? "" : " (refused)"}${a.detail ? ` · ${a.detail}` : ""}`);
    }
    return lines.join("\n") + "\n";
  }
}

module.exports = { ResearchStore };
