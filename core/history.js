// Visit history (B19): one entry per URL with title, visit count and last
// visit. Saved as "history.json" through a storage object (see storage.js).

const HISTORY_MAX = 3000;

class HistoryStore {
  constructor(storage, { max = HISTORY_MAX, saveDelay = 1500 } = {}) {
    this.storage = storage;
    this.max = max;
    this.saveDelay = saveDelay;
    this.timer = null;
    try {
      this.rows = JSON.parse(storage.read("history.json") || "[]");
    } catch {
      this.rows = [];
    }
  }

  saveSoon() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), this.saveDelay);
  }

  saveNow() {
    clearTimeout(this.timer);
    try {
      this.storage.write("history.json", JSON.stringify(this.rows));
    } catch (_) {}
  }

  record(url, title) {
    if (!/^https?:/i.test(url || "")) return;
    const i = this.rows.findIndex((r) => r.url === url);
    const row = i >= 0 ? this.rows.splice(i, 1)[0] : { url, title: "", visits: 0 };
    row.visits += 1;
    row.lastVisit = Date.now();
    if (title) row.title = title;
    this.rows.unshift(row);
    if (this.rows.length > this.max) this.rows.length = this.max;
    this.saveSoon();
  }

  updateTitle(url, title) {
    const row = this.rows.find((r) => r.url === url);
    if (row && title && row.title !== title) {
      row.title = title;
      this.saveSoon();
    }
  }

  // Address-bar suggestions: host/URL prefix matches first, then title matches,
  // ranked by visit count and recency.
  search(q, limit = 8) {
    const query = String(q || "").trim().toLowerCase();
    if (!query) return this.rows.slice(0, limit);
    const bare = (u) => u.replace(/^https?:\/\/(www\.)?/i, "").toLowerCase();
    const scored = [];
    for (const r of this.rows) {
      const u = bare(r.url);
      const t = (r.title || "").toLowerCase();
      let score = 0;
      if (u.startsWith(query)) score = 100;
      else if (u.includes(query)) score = 40;
      else if (t.includes(query)) score = 30;
      else continue;
      score += Math.min(30, r.visits * 3) + Math.max(0, 20 - (Date.now() - r.lastVisit) / 86400000);
      scored.push({ r, score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.r);
  }

  remove(url) {
    this.rows = this.rows.filter((r) => r.url !== url);
    this.saveSoon();
  }

  clear() {
    this.rows = [];
    this.saveSoon();
  }
}

module.exports = { HistoryStore };
