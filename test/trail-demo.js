// Trail store (B100): core/trail.js. Run: npm run test:trail
const assert = require("assert");
const { TrailStore, migrateSessions, sessionStorageOver, ENGAGED_MS } = require("../core/trail");
const { ResearchStore } = require("../core/research");
const { memoryStorage } = require("../core/storage");

let n = 0;
const ok = (name) => console.log(`ok ${++n} - ${name}`);
let clock = Date.parse("2026-11-05T14:00:00Z");
const now = () => clock;
const tick = (ms) => (clock += ms);

// ---- event log, cards, timeline ----
{
  const files = memoryStorage();
  const store = new TrailStore(files, { now });
  const t = store.current();
  assert.ok(t.trail.id && store.ids().length === 1, "a first launch gets a new trail");
  const id = t.trail.id;
  store.visit(id, "https://example.com/a", { title: "A", keywords: ["alpha"] });
  tick(10_000);
  store.visit(id, "https://example.com/b", { title: "B", dwell: 6000 });
  tick(5_000);
  store.visit(id, "https://accounts.google.com/signin", { title: "Sign in" });
  store.visit(id, "https://search.brave.com/search?q=x", { title: "Search" });
  const lines = files.read(`${id}/events.jsonl`).trim().split("\n");
  assert.strictEqual(lines.length, 2, "sign-in pages and search results are not recorded");
  ok("visits are opened events in events.jsonl; sign-in and search pages are left out");

  const a = store.addCard(id, { kind: "page", url: "https://example.com/a", title: "A", x: 0, y: 0 });
  assert.ok(a && store.snapshot(id).cards.length === 1);
  assert.strictEqual(store.addCard(id, { kind: "page", url: "https://example.com/login/password", title: "x", x: 0, y: 0 }), null, "sign-in pages never become cards");
  const tl = store.timeline(id);
  assert.strictEqual(tl.length, 1);
  const items = tl[0].items;
  assert.deepStrictEqual(items.map((i) => i.title), ["B", "A"], "newest first");
  assert.strictEqual(items.find((i) => i.title === "B").timelineOnly, true);
  assert.strictEqual(items.find((i) => i.title === "B").dwell, 6000);
  assert.strictEqual(items.find((i) => i.title === "A").timelineOnly, false);
  ok("a page with a card is on the canvas; a page without one is timeline-only, with its time on page");

  tick(31 * 60_000);
  store.visit(id, "https://example.com/c", { title: "C" });
  store.event(id, { type: "opened", device: "phone", data: { url: "https://example.com/p", title: "From phone" } });
  const tl2 = store.timeline(id);
  assert.strictEqual(tl2.length, 3, "a gap over 30 minutes and another device start new sessions");
  assert.deepStrictEqual(tl2.map((s) => s.device).sort(), ["desktop", "desktop", "phone"]);
  ok("sessions: grouped by device, split at gaps over 30 minutes");

  // Lines survive removing a card and come back when it is put back.
  const b = store.addCard(id, { kind: "page", url: "https://example.com/b", title: "B", x: 400, y: 0 });
  const line = store.link(id, a.id, b.id, { kind: "you", label: "supports" });
  store.removeCard(id, b.id);
  assert.ok(!store.snapshot(id).cards.some((c) => c.id === b.id), "removed card is off the canvas");
  assert.ok(store.get(id).lines.some((l) => l.id === line.id), "its line is kept");
  assert.ok(store.timeline(id).some((s) => s.items.some((i) => i.title === "B" && i.removedFromCanvas)));
  store.restoreCard(id, b.id);
  assert.ok(store.snapshot(id).cards.some((c) => c.id === b.id) && store.snapshot(id).lines.some((l) => l.id === line.id));
  ok("removing a card keeps its events and lines; putting it back restores them");

  store.moveCard(id, a.id, 120, 80);
  assert.strictEqual(store.card(id, a.id).pinned, true, "a moved card is pinned");
  ok("a card the person moved is pinned");

  // Link, group, rename and resolve are events with their own times.
  const before = store.events(id).length;
  tick(1000);
  const tLink = clock;
  store.link(id, b.id, a.id, { kind: "you" });
  tick(1000);
  const g = store.group(id, { x: -20, y: -50, w: 900, h: 400, label: "Temperature" });
  tick(1000);
  store.renameGroup(id, g.id, "Warmth");
  tick(1000);
  store.resolveGroup(id, g.id, true);
  const ev = store.events(id).slice(before);
  assert.deepStrictEqual(ev.map((e) => e.type), ["linked", "grouped", "renamed", "resolved"]);
  assert.strictEqual(ev[0].at, tLink);
  assert.ok(ev[1].at > ev[0].at && ev[2].at > ev[1].at && ev[3].at > ev[2].at, "each has its own time");
  assert.deepStrictEqual(ev[1].data.cards.sort(), [a.id, b.id].sort(), "the group event names the cards inside it");
  ok("link, group, rename and resolve are recorded as events with their own times");

  // Everything reloads from disk.
  const again = new TrailStore(files, { now });
  assert.strictEqual(again.current().trail.id, id);
  assert.strictEqual(again.events(id).length, store.events(id).length);
  assert.strictEqual(again.snapshot(id).cards.length, store.snapshot(id).cards.length);
  again.setView(id, { x: -300, y: 40, z: 0.6, selected: a.id, openTabs: ["https://example.com/a", "file:///x"] });
  const third = new TrailStore(files, { now });
  assert.deepStrictEqual(third.view(id), { x: -300, y: 40, z: 0.6, openTabs: ["https://example.com/a"], mosaic: [], selected: a.id });
  third.setView(id, { z: 9 });
  assert.strictEqual(third.view(id).z, 2.5, "zoom is kept between 20% and 250%");
  ok("trail, events and view reload from storage; view keeps position, zoom, selection and open tabs");

  // A half-written last line (a crash) does not lose the rest.
  files.write(`${id}/events.jsonl`, files.read(`${id}/events.jsonl`) + '{"id":"broken","at":');
  assert.strictEqual(new TrailStore(files, { now }).events(id).length, store.events(id).length);
  ok("a broken last line in events.jsonl is skipped");
}

// ---- migration from sessions/ ----
const session = (id, extra) => ({
  id,
  name: "Sourdough starters",
  started: Date.parse("2026-10-27T14:00:00Z"),
  updated: Date.parse("2026-10-28T09:41:00Z"),
  pins: ["hydration"],
  trail: [
    { url: "https://kingarthurbaking.com/cold-kitchen", title: "Keeping a starter in a cold kitchen", firstAt: Date.parse("2026-10-27T14:10:00Z"), lastAt: Date.parse("2026-10-27T14:12:00Z"), visits: 1, keywords: ["temperature"] },
    { url: "https://en.wikipedia.org/wiki/Sourdough", title: "Sourdough", firstAt: Date.parse("2026-10-27T14:05:00Z"), lastAt: Date.parse("2026-10-27T14:05:00Z"), visits: 1, keywords: [] },
    { url: "https://reddit.com/r/Sourdough/rye", title: "Rye vs wheat", firstAt: Date.parse("2026-10-27T14:40:00Z"), lastAt: Date.parse("2026-10-27T14:40:05Z"), visits: 3, keywords: ["rye"] },
    { url: "https://theperfectloaf.com/levain", title: "Levain basics", firstAt: Date.parse("2026-10-27T14:20:00Z"), lastAt: Date.parse("2026-10-27T14:20:00Z"), visits: 1, keywords: [], notes: [{ id: "n1", by: "Sven", at: Date.parse("2026-10-27T14:21:00Z"), text: "Read later" }] },
    { url: "https://ncbi.nlm.nih.gov/ecology", title: "Microbial ecology", firstAt: Date.parse("2026-10-28T09:30:00Z"), lastAt: Date.parse("2026-10-28T09:30:00Z"), visits: 1, keywords: [] },
    { url: "https://youtube.com/watch?v=hydr", title: "Hydration explained", firstAt: Date.parse("2026-10-28T09:15:00Z"), lastAt: Date.parse("2026-10-28T09:15:00Z"), visits: 1, keywords: [] },
    { url: "https://accounts.google.com/signin", title: "Sign in", firstAt: 1, lastAt: 1, visits: 1, keywords: [] },
  ],
  opened: [{ url: "https://example.org/x", title: "X", query: "q", at: 5 }],
  dismissed: ["https://example.org/y"],
  threadList: [{ id: "q1", title: "Does 100% hydration matter?", status: "open", conclusion: "", tags: ["hydration"], pages: ["https://ncbi.nlm.nih.gov/ecology"], by: "Sven", at: Date.parse("2026-10-28T09:31:00Z"), replies: [{ id: "r1", by: "Sven", at: Date.parse("2026-10-28T09:32:00Z"), text: "Not sure yet", replies: [] }] }],
  reports: [{ at: Date.parse("2026-10-27T14:18:00Z"), question: "What temperature range do starters need?", file: "report-1.md", sources: ["https://a.example"] }],
  captures: [{ at: Date.parse("2026-10-27T14:11:00Z"), libraryId: "L1", kind: "shot", name: "shot-1.png", url: "https://kingarthurbaking.com/cold-kitchen", title: "Cold kitchen" }],
  ...extra,
});
{
  const old = memoryStorage({ "s1.json": JSON.stringify(session("s1")), "s2.json": JSON.stringify({ ...session("s2"), name: "Other", updated: 5, threadList: [], reports: [], captures: [] }), "current.txt": "s1", "broken.json": "{" });
  const files = memoryStorage();
  const store = new TrailStore(files, { now });
  const res = migrateSessions(old, store, { openTabsByTrail: { s1: ["https://youtube.com/watch?v=hydr"] }, now: now() });
  assert.strictEqual(res.trails, 2);
  assert.deepStrictEqual(res.skipped, ["broken.json"]);
  assert.strictEqual(store.current().trail.id, "s1", "NODE opens on the session that was current");
  const snap = store.snapshot("s1");
  const urls = snap.cards.filter((c) => c.kind === "page").map((c) => c.url).sort();
  assert.deepStrictEqual(urls, ["https://kingarthurbaking.com/cold-kitchen", "https://ncbi.nlm.nih.gov/ecology", "https://reddit.com/r/Sourdough/rye", "https://theperfectloaf.com/levain", "https://youtube.com/watch?v=hydr"]);
  ok("migration: pages with 20 s or more, two reads, a note, a thread link or an open tab become cards");
  const only = store.timeline("s1").flatMap((s) => s.items).filter((i) => i.timelineOnly);
  assert.deepStrictEqual(only.map((i) => i.title), ["Sourdough"]);
  assert.strictEqual(only[0].dwellUnknown, true, "marked as having no recorded time on page");
  assert.ok(!JSON.stringify(store.get("s1")).includes("accounts.google.com") && !files.read("s1/events.jsonl").includes("accounts.google.com"), "sign-in pages are dropped");
  ok("migration: other pages stay timeline-only with no recorded time; sign-in pages are dropped");
  const kinds = snap.cards.map((c) => c.kind).sort();
  assert.deepStrictEqual(kinds, ["capture", "note", "page", "page", "page", "page", "page", "question", "report"]);
  const q = snap.cards.find((c) => c.kind === "question");
  assert.strictEqual(q.replies[0].text, "Not sure yet");
  const eco = snap.cards.find((c) => c.url === "https://ncbi.nlm.nih.gov/ecology");
  assert.ok(snap.lines.some((l) => l.from === eco.id && l.to === q.id && l.kind === "you"), "thread page link becomes a drawn line");
  const note = snap.cards.find((c) => c.kind === "note");
  assert.ok(snap.lines.some((l) => l.from === note.id && l.kind === "auto"), "note is linked to its page");
  ok("migration: threads, notes, reports and captures become cards, with their lines");
  const overlaps = snap.cards.some((a, i) => snap.cards.some((b, j) => i < j && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));
  assert.ok(!overlaps, "no cards overlap");
  assert.deepStrictEqual(store.get("s1").research.pins, ["hydration"]);
  assert.strictEqual(store.pageRows("s1").find((r) => r.url.includes("rye")).visits, 3);
  ok("migration: no overlaps; pins, visit counts and results kept");
  // Running it again changes nothing; the old files are still there.
  const before = files.read("s1/events.jsonl");
  migrateSessions(old, store, { now: now() });
  assert.strictEqual(files.read("s1/events.jsonl"), before);
  assert.ok(old.read("s1.json"), "sessions/ is left in place");
  ok("migration runs once and leaves sessions/ untouched");

  // ---- research:* over the trail store ----
  const research = new ResearchStore(sessionStorageOver(store));
  assert.strictEqual(research.current.id, "s1");
  assert.strictEqual(research.current.threadList[0].id, "q1");
  assert.deepStrictEqual(research.current.trail.find((r) => r.url.includes("levain")).notes.map((x) => x.text), ["Read later"]);
  research.visit("https://example.com/new", "New page", ["new"]);
  research.addThread({ title: "New question", by: "Sven" });
  research.addNote("https://example.com/new", { by: "Sven", text: "A note" });
  research.saveNow();
  const t2 = new TrailStore(files, { now });
  assert.ok(t2.pageRows("s1").some((r) => r.url === "https://example.com/new" && r.title === "New page"));
  assert.ok(t2.snapshot("s1").cards.some((c) => c.kind === "question" && c.title === "New question"));
  assert.ok(t2.snapshot("s1").cards.some((c) => c.kind === "note" && c.text === "A note"));
  ok("research:* writes land in the trail store: visits, threads, notes");
  const removedThread = research.current.threadList.find((x) => x.title === "New question").id;
  research.removeThread(removedThread);
  research.saveNow();
  assert.ok(!new TrailStore(files, { now }).card("s1", removedThread));
  research.create("Second trail");
  assert.strictEqual(new TrailStore(files, { now }).index.current, research.current.id);
  research.switchTo("s1");
  assert.strictEqual(new TrailStore(files, { now }).index.current, "s1");
  assert.ok(research.list().length === 3 && research.list().some((x) => x.name === "Second trail"));
  ok("research:* new, switch, list and delete go through the trail store");
  const evBefore = store.events("s1").length;
  research.saveNow();
  research.saveNow();
  assert.strictEqual(store.events("s1").length, evBefore, "saving without changes adds no events");
  ok("saving the same session twice adds no events");
}

// ---- 200 cards stay fast ----
{
  const store = new TrailStore(memoryStorage(), { now });
  const id = store.current().trail.id;
  const t0 = Date.now();
  for (let i = 0; i < 200; i++) {
    store.visit(id, `https://example.com/p${i}`, { title: `Page ${i}` });
    store.addCard(id, { kind: "page", url: `https://example.com/p${i}`, title: `Page ${i}`, x: (i % 20) * 300, y: Math.floor(i / 20) * 260 });
  }
  const t1 = Date.now();
  for (let i = 0; i < 20; i++) store.snapshot(id);
  const per = (Date.now() - t1) / 20;
  assert.ok(per < 50, `snapshot of 200 cards took ${per} ms`);
  ok(`200 cards: built in ${t1 - t0} ms; snapshot ${per.toFixed(1)} ms`);
}
console.log(`\n${n} checks passed (ENGAGED_MS ${ENGAGED_MS})`);
