// Shared trails into research sessions (B82 step 5, docs/19-trail-sharing.md).
// A trail file is read with core/trail-file.js. These functions turn it into a
// new research session, or put a merged trail back into an existing session,
// keeping what only the session has (visits, suggestions opened, captures).
const { pageKey, hashId } = require("./trail-file");
const { isSensitiveUrl } = require("./urls");

const okUrl = (u) => /^https?:/i.test(u || "") && !isSensitiveUrl(u);
const cloneReplies = (list) => (list || []).map((r) => ({ id: r.id, by: r.by || "", at: r.at || 0, text: String(r.text || ""), replies: cloneReplies(r.replies) }));
const cleanThread = (t) => ({
  id: t.id || hashId("thread", t.title),
  title: String(t.title || "Thread"),
  status: t.status === "resolved" ? "resolved" : "open",
  conclusion: String(t.conclusion || ""),
  tags: [...(t.tags || [])],
  pages: (t.pages || []).filter(okUrl),
  by: t.by || "",
  at: t.at || 0,
  replies: cloneReplies(t.replies),
});
const pageRow = (p) => ({
  id: p.id,
  url: p.url,
  title: p.title || p.url,
  firstAt: p.firstAt || 0,
  lastAt: p.lastAt || p.firstAt || 0,
  visits: 0,
  keywords: [...(p.keywords || [])].slice(0, 8),
  tags: [...(p.tags || [])],
  notes: (p.notes || []).map((n) => ({ id: n.id, by: n.by || "", at: n.at || 0, text: String(n.text || "") })),
});

// One line in the trail's history: "3 pages and 1 thread from Alex".
function historyEntry(kind, trail, counts, at = Date.now()) {
  return { at, kind, from: trail.exportedBy || "", exportedAt: trail.exportedAt || 0, ...counts };
}

// A new session (the fields a research session has) from a shared trail.
// Returns { session, reports } where reports still need saving as files.
function sessionFromTrail(trail, { id, now = Date.now() } = {}) {
  const pages = (trail.pages || []).filter((p) => okUrl(p.url)).map(pageRow);
  const threads = (trail.threads || []).map(cleanThread);
  const session = {
    id,
    name: String(trail.name || "Shared trail").slice(0, 120),
    started: now,
    updated: now,
    pins: [...(trail.pins || [])].slice(0, 12),
    tags: [...(trail.tags || [])],
    trail: pages,
    opened: [],
    dismissed: [],
    threadList: threads,
    sharedId: trail.id || "",
    extra: [...(trail.extra || [])],
    shareLog: [historyEntry("opened", trail, { pages: pages.length, threads: threads.length })],
  };
  return { session, reports: [...(trail.reports || [])] };
}

// Puts a merged trail (TrailFile.merge(base, incoming)) back into the session
// the base came from. Changes the session in place. Returns the reports that
// are new (to be saved as files and linked), and what was added.
function applyMerged(session, merged, incoming, { now = Date.now(), baseReportIds = [] } = {}) {
  const rows = new Map((session.trail || []).map((r) => [pageKey(r.url), r]));
  let newPages = 0;
  for (const p of merged.pages || []) {
    if (!okUrl(p.url)) continue;
    const mine = rows.get(pageKey(p.url));
    if (!mine) {
      const row = pageRow(p);
      session.trail.push(row);
      rows.set(pageKey(p.url), row);
      newPages++;
      continue;
    }
    if (p.firstAt) mine.firstAt = mine.firstAt ? Math.min(mine.firstAt, p.firstAt) : p.firstAt;
    mine.lastAt = Math.max(mine.lastAt || 0, p.lastAt || 0);
    if ((!mine.title || mine.title === mine.url) && p.title) mine.title = p.title;
    mine.keywords = [...(p.keywords || mine.keywords || [])].slice(0, 8);
    mine.tags = [...(p.tags || [])];
    mine.notes = (p.notes || []).map((n) => ({ id: n.id, by: n.by || "", at: n.at || 0, text: String(n.text || "") }));
    if (!mine.id && p.id) mine.id = p.id;
  }
  // Thread page links point at the session's own address for a page it has.
  const ownUrl = (u) => rows.get(pageKey(u))?.url || u;
  const before = new Set((session.threadList || []).map((t) => t.id));
  session.threadList = (merged.threads || []).map((t) => {
    const c = cleanThread(t);
    c.pages = [...new Set(c.pages.map(ownUrl))];
    return c;
  });
  session.pins = [...(merged.pins || [])].slice(0, 12);
  session.tags = [...(merged.tags || [])];
  session.extra = [...(merged.extra || [])];
  const have = new Set(baseReportIds);
  const reports = (merged.reports || []).filter((r) => !have.has(r.id));
  const counts = { pages: newPages, threads: session.threadList.filter((t) => !before.has(t.id)).length, reports: reports.length };
  (session.shareLog = session.shareLog || []).push(historyEntry("merged", incoming, counts, now));
  session.updated = now;
  return { reports, counts };
}

module.exports = { sessionFromTrail, applyMerged };
