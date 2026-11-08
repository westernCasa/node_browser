// Media moments (B88): moment cards in the trail store, the trail file,
// Replay and search. Run: npm run test:moment
const assert = require("assert");
const { TrailStore } = require("../core/trail");
const { memoryStorage } = require("../core/storage");
const { replaySteps, stepCaption } = require("../core/replay");
const { recallIndex, recall } = require("../core/recall");
const TF = require("../core/trail-file");
const { momentScript, loopScript } = require("../core/page-scripts");

let n = 0;
const ok = (name) => console.log(`ok ${++n} - ${name}`);
let clock = new Date(2026, 10, 7, 20, 0).getTime();
const now = () => clock;
const store = new TrailStore(memoryStorage(), { now });
const id = store.current().trail.id;
const V = "https://www.youtube.com/watch?v=mix1";

store.visit(id, V, { title: "Boiler Room mix" });
clock += 20000;
const page = store.placePage(id, V, { title: "Boiler Room mix", x: 0, y: 0 });
clock += 60000;
const m = store.momentCard(id, { url: V, title: "Boiler Room mix", a: 2472.4, b: 2550, transcript: "  this one is   unreleased\n" });
{
  assert.strictEqual(m.kind, "moment");
  assert.deepStrictEqual([m.a, m.b, m.w, m.h], [2472.4, 2550, 280, 190]);
  assert.strictEqual(m.transcript, "this one is unreleased");
  const snap = store.snapshot(id);
  const line = snap.lines.find((l) => l.from === page.id && l.to === m.id);
  assert.ok(line && line.kind === "auto" && line.label === "moment from", "a grey line from the page");
  assert.ok(Math.abs(m.x - page.x) < 700 && Math.abs(m.y - page.y) < 700, "next to the page's card");
  assert.ok(store.events(id).some((e) => e.type === "captured" && e.card === m.id && e.data.moment), "saving is an event");
  assert.strictEqual(store.momentCard(id, { url: V, a: 2472.6, b: 2550.3 }).id, m.id, "the same moment twice is one card");
  assert.strictEqual(store.momentCard(id, { url: V, a: 10, b: 5 }), null, "the end must be after the start");
  assert.strictEqual(store.momentCard(id, { url: "https://accounts.google.com/signin", a: 1, b: 5 }), null, "never sign-in pages (B66)");
  ok("a moment is a card next to its page, with a grey line and an event");
}
{
  clock += 1000;
  assert.strictEqual(store.momentTimes(id, m.id, 2470, 2560).b, 2560);
  assert.ok(store.events(id).some((e) => e.type === "edited" && e.card === m.id && e.data.a === 2470));
  assert.strictEqual(store.momentTimes(id, m.id, 30, 20), null);
  assert.strictEqual(store.momentTimes(id, page.id, 1, 2), null, "only moments have times");
  ok("its start and end can be changed, and that is an event");
}
{
  const snap = store.snapshot(id);
  const md = TF.toTrailMd(snap, { by: "Sven", at: clock });
  assert.ok(md.includes(`### [Boiler Room mix](${V}) · moment 41:10–42:40`), md);
  assert.ok(md.includes("> this one is unreleased"));
  const back = TF.parseTrailMd(md);
  const c = back.cards.find((k) => k.kind === "moment");
  assert.deepStrictEqual([c.a, c.b, c.url, c.transcript], [2470, 2560, V, "this one is unreleased"]);
  assert.strictEqual(TF.toTrailMd(back, { by: "Sven", at: back.trail.at }), md, "the file reads back the same");
  const reader = new TrailStore(memoryStorage(), { now });
  const opened = reader.importFile(back);
  assert.ok(reader.snapshot(opened.trail.id).cards.some((k) => k.kind === "moment" && k.a === 2470));
  ok("a trail file carries the moment: times in the heading, captions as a quote");
}
{
  const snap = store.snapshot(id);
  const byId = new Map(snap.cards.map((c) => [c.id, c]));
  const caps = replaySteps(snap, store.events(id)).map((st) => stepCaption(st, { byId, lines: snap.lines, seen: new Set() }));
  assert.ok(caps.includes("You saved a moment of “Boiler Room mix”, 41:10 to 42:40."), caps.join("\n"));
  ok("Replay says when a moment was saved");
}
{
  const r = recall(recallIndex(store), "unreleased moment", { now: clock, trails: store.list() });
  assert.strictEqual(r[0]?.card, m.id, JSON.stringify(r));
  ok("search past trails finds a moment by its captions");
}
{
  const ro = new TrailStore(memoryStorage(), { now });
  const f = ro.importFile(TF.parseTrailMd(TF.toTrailMd(store.snapshot(id), { by: "Sven", at: clock }))).trail.id;
  ro.visit(f, V, { title: "x" });
  assert.strictEqual(ro.momentCard(f, { url: V, a: 1, b: 9 }), null);
  const c = ro.snapshot(f).cards.find((k) => k.kind === "moment");
  assert.strictEqual(ro.momentTimes(f, c.id, 1, 9), null);
  ok("an opened file (read only) gets no new moments or times");
}
{
  for (const op of ["start", "end", "last", "loop", "state", "cancel"]) new Function(momentScript(op, 30));
  new Function(loopScript("range", 60, { a: 1, b: 4 }));
  ok("the page scripts parse");
}
console.log(`\n${n} checks passed`);
