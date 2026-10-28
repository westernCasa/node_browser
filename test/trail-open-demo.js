// Shared trails into research sessions (B82 step 5).
//   node test/trail-open-demo.js
const assert = require("assert");
const T = require("../core/trail-file");
const { sessionFromTrail, applyMerged } = require("../core/trail-apply");
const { ResearchStore } = require("../core/research");
const ok = (name) => console.log("ok  ", name);
const at = (s) => Date.parse(s);

// Alex's trail, as a file.
const alexTrail = {
  id: "trail-x", name: "Sourdough", pins: ["hydration"], tags: [],
  threads: [{ id: "t1", title: "Why do starters fail in winter?", status: "resolved", conclusion: "Keep it warm.", tags: ["temperature"], pages: ["https://example.com/starters"], by: "Alex", at: at("2026-10-27T14:00:00Z"),
    replies: [{ id: "r1", by: "Alex", at: at("2026-10-27T14:02:00Z"), text: "Below 24 °C it sleeps.", replies: [] }] }],
  pages: [
    { id: "p1", url: "https://example.com/starters", title: "Starters", firstAt: at("2026-10-27T13:00:00Z"), lastAt: at("2026-10-27T13:30:00Z"), keywords: ["starter"], tags: [], notes: [{ id: "n1", by: "Alex", at: at("2026-10-27T13:10:00Z"), text: "Read section 3." }] },
    { id: "p2", url: "https://accounts.google.com/signin", title: "Sign in", firstAt: 0, lastAt: 0, keywords: [], tags: [], notes: [] },
  ],
  reports: [{ id: "rep1", title: "Summary", by: "NODE research agent", at: at("2026-10-27T15:00:00Z"), text: "## Findings\n\nWarmth matters." }],
};
const file = T.toMarkdown(alexTrail, { by: "Alex", at: at("2026-10-28T10:00:00Z") });
const incoming = T.fromMarkdown(file);

// Open as a new trail.
const { session, reports } = sessionFromTrail(incoming, { id: "new1", now: at("2026-10-28T11:00:00Z") });
assert.strictEqual(session.name, "Sourdough");
assert.deepStrictEqual(session.trail.map((r) => r.url), ["https://example.com/starters"]);
assert.strictEqual(session.trail[0].notes[0].text, "Read section 3.");
assert.strictEqual(session.threadList[0].replies[0].by, "Alex");
assert.strictEqual(session.threadList[0].status, "resolved");
assert.strictEqual(reports.length, 1);
assert.ok(session.shareLog[0].from === "Alex" && session.shareLog[0].pages === 1 && session.shareLog[0].threads === 1);
ok("open as a new trail: pages, notes, threads and reports; sign-in pages stay out; who it came from");

// The new session works in the research store.
const files = {};
const storage = { read: (n) => (n in files ? files[n] : null), write: (n, t) => (files[n] = t), list: () => Object.keys(files) };
const store = new ResearchStore(storage);
const first = store.current.id;
store.adopt(session);
assert.ok(store.current.id === "new1" && store.list().length === 2 && Array.isArray(store.current.captures || []));
store.reply("t1", { parentId: "r1", by: "Sven", text: "Mine too." });
ok("the opened trail becomes the current one and takes replies");

// Merge into one of Sven's trails, which shares a page (with a tracking code) and has its own thread.
store.switchTo(first);
store.visit("https://www.example.com/starters/?utm_source=x", "My copy of starters", ["levain"]);
store.visit("https://example.com/mine", "Mine", []);
store.current.opened.push({ url: "https://example.com/mine", title: "Mine", at: 1 });
const own = store.addThread({ title: "Best flour?", by: "Sven", pages: ["https://www.example.com/starters/?utm_source=x"] });
const s = store.current;
const base = T.fromSession(s, { by: "Sven", reports: [] });
const plan = T.mergePlan(base, incoming);
assert.ok(plan.newPages === 0 && plan.combinedPages === 1 && plan.newThreads === 1 && plan.newReports === 1, JSON.stringify(plan));
const merged = T.merge(base, incoming, {});
const result = applyMerged(s, merged, incoming, { baseReportIds: [] });
store.write(s);
assert.strictEqual(s.trail.length, 2, "the shared page is matched to Sven's own copy, not added twice");
const mine = s.trail.find((r) => r.url === "https://www.example.com/starters/?utm_source=x");
assert.ok(mine && mine.title === "My copy of starters" && mine.notes[0].text === "Read section 3." && mine.keywords.includes("levain") && mine.keywords.includes("starter") && mine.visits === 1);
assert.ok(s.opened.length === 1, "what only the session has is kept");
assert.strictEqual(s.threadList.length, 2);
assert.deepStrictEqual(s.threadList.find((t) => t.id === own.id).pages, ["https://www.example.com/starters/?utm_source=x"]);
assert.deepStrictEqual(s.threadList.find((t) => t.id === "t1").pages, ["https://www.example.com/starters/?utm_source=x"], "their thread links Sven's own copy of the page");
assert.ok(result.counts.threads === 1 && result.counts.pages === 0 && result.reports.length === 1);
assert.ok(s.shareLog.at(-1).kind === "merged" && s.shareLog.at(-1).from === "Alex");
ok("merge into a trail: same page matched, notes and keywords joined, own data kept, history noted");

// Merging the same file again adds nothing.
const base2 = T.fromSession(s, { by: "Sven", reports: [{ id: "rep1", title: "Summary", at: 1, text: "" }] });
const plan2 = T.mergePlan(base2, incoming);
assert.ok(plan2.newPages + plan2.newThreads + plan2.newReplies + plan2.newNotes + plan2.newReports === 0, JSON.stringify(plan2));
const again = applyMerged(s, T.merge(base2, incoming, {}), incoming, { baseReportIds: ["rep1"] });
assert.ok(s.trail.length === 2 && s.threadList.length === 2 && again.reports.length === 0 && s.trail[0].notes.length + s.trail[1].notes.length === 1);
ok("merging the same file twice adds nothing the second time");
