// Bookmarks: saved pages with title and the time they were added. Saved as
// "bookmarks.json" through a storage object (see storage.js), newest first.
// Shared by desktop and mobile.

class BookmarkStore {
  constructor(storage) {
    this.storage = storage;
    try {
      this.rows = JSON.parse(storage.read("bookmarks.json") || "[]");
    } catch {
      this.rows = [];
    }
  }

  save() {
    try {
      this.storage.write("bookmarks.json", JSON.stringify(this.rows));
    } catch (_) {}
  }

  has(url) {
    return this.rows.some((r) => r.url === url);
  }

  add(url, title = "") {
    if (!/^https?:/i.test(url || "")) return false;
    if (this.has(url)) return true;
    this.rows.unshift({ url, title: title || url, addedAt: Date.now() });
    this.save();
    return true;
  }

  remove(url) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.url !== url);
    if (this.rows.length !== before) this.save();
  }

  /** Adds the page if it is not bookmarked, removes it if it is. Returns the new state. */
  toggle(url, title) {
    if (this.has(url)) {
      this.remove(url);
      return false;
    }
    return this.add(url, title);
  }

  // Title and address matches, newest first; everything when the query is empty.
  search(q = "", limit = 200) {
    const query = String(q || "").trim().toLowerCase();
    const rows = query
      ? this.rows.filter((r) => r.url.toLowerCase().includes(query) || (r.title || "").toLowerCase().includes(query))
      : this.rows;
    return rows.slice(0, limit);
  }
}

module.exports = { BookmarkStore };
