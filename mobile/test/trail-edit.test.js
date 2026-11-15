// Phone trails: pages becoming cards, and the canvas tools with Undo.
// Run: npm test (in mobile/).
const assert = require("assert");
const core = require("../../core");
const { TrailStore, sessionStorageOver } = require("../../core/trail");
const { createEngagement } = require("../src/engagement");
const { createEditor } = require("../src/trailEdit");

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`ok ${passed} - ${name}`);
};
let clock = Date.UTC(2026, 10, 15, 15, 0);
const now = () => clock;

function phone() {
  const store = new TrailStore(core.memoryStorage({}), { device: "phone", now });
  store.current();
  const research = new core.ResearchStore(sessionStorageOver(store));
  const made = [];
  const eng = createEngagement({ store, trailOf: () => research.current.id, onCard: (c) => made.push(c), now });
  const ed = createEditor({ store, research, by: () => "Sven" });
  return { store, research, eng, ed, made, id: () => research.current.id };
}
const cards = (p) => p.store.snapshot(p.id()).cards;

test("20 s on screen makes a card; a quick visit stays timeline only", () => {
  const p = phone();
  p.eng.started("t1", "https://en.wikipedia.org/wiki/Sourdough", { title: "Sourdough" });
  for (let i = 0; i < 19; i++) p.eng.tick(["t1"]);
  assert.strictEqual(cards(p).length, 0);
  p.eng.tick(["t1"]);
  assert.strictEqual(cards(p).length, 1);
  assert.strictEqual(p.made.length, 1);
  // Opened from the first page, read for 5 s, then left: timeline only.
  p.eng.started("t1", "https://example.org/starter", { title: "Starter" });
  for (let i = 0; i < 5; i++) p.eng.tick(["t1"]);
  p.eng.started("t1", "https://example.org/next");
  assert.strictEqual(cards(p).length, 1);
  assert.ok(p.store.events(p.id()).some((e) => e.type === "bounced" && e.data.url === "https://example.org/starter" && e.data.dwell === 5000));
});

test("hidden tabs don't count; scrolling makes a card at once, near its source, with an opened-from line", () => {
  const p = phone();
  p.eng.started("a", "https://en.wikipedia.org/wiki/Radium");
  p.eng.engage("a", "scroll");
  p.eng.started("a", "https://en.wikipedia.org/wiki/Marie_Curie");
  for (let i = 0; i < 30; i++) p.eng.tick([]); // tab not on screen
  assert.strictEqual(cards(p).length, 1);
  p.eng.engage("a", "scroll");
  const snap = p.store.snapshot(p.id());
  assert.strictEqual(snap.cards.length, 2);
  assert.ok(snap.lines.some((l) => l.kind === "nav"), "opened-from line");
  // Engaging twice does nothing more; sign-in pages never become cards.
  assert.strictEqual(p.eng.engage("a", "scroll"), null);
  p.eng.started("b", "https://accounts.google.com/signin");
  p.eng.engage("b", "scroll");
  assert.strictEqual(p.store.snapshot(p.id()).cards.length, 2);
});

test("works in any trail, including one continued from desktop", () => {
  const p = phone();
  const t = p.store.create("From desktop", { current: false });
  p.research.switchTo(t.trail.id);
  p.eng.started("x", "https://example.org/a");
  p.eng.engage("x", "scroll");
  assert.strictEqual(p.store.snapshot(t.trail.id).cards.length, 1);
});

test("move, link with label, group, rename, resolve: each with Undo", () => {
  const p = phone();
  p.eng.started("a", "https://example.org/1");
  const c1 = p.eng.engage("a", "scroll");
  p.eng.started("b", "https://example.org/2");
  const c2 = p.eng.engage("b", "scroll");
  const x0 = c1.x;

  const mv = p.ed.moveCard(c1.id, 900, 40);
  assert.strictEqual(p.store.card(p.id(), c1.id).x, 900);
  assert.ok(p.store.card(p.id(), c1.id).pinned);
  mv.undo();
  assert.strictEqual(p.store.card(p.id(), c1.id).x, x0);
  assert.ok(!p.store.card(p.id(), c1.id).pinned);

  const ln = p.ed.link(c1.id, c2.id, "supports");
  assert.strictEqual(ln.result.label, "supports");
  const lab = p.ed.labelLine(ln.result.id, "contradicts");
  assert.strictEqual(p.store.get(p.id()).lines.find((l) => l.id === ln.result.id).label, "contradicts");
  lab.undo();
  assert.strictEqual(p.store.get(p.id()).lines.find((l) => l.id === ln.result.id).label, "supports");
  ln.undo();
  assert.ok(!p.store.get(p.id()).lines.some((l) => l.id === ln.result.id));
  assert.strictEqual(p.ed.link(c1.id, c1.id), null, "no link to itself");

  const g = p.ed.group([c1.id, c2.id], "Starters");
  assert.strictEqual(g.result.label, "Starters");
  assert.strictEqual(p.store.cardsIn(p.id(), g.result).length, 2);
  p.ed.renameGroup(g.result.id, "Rye starters").undo();
  assert.strictEqual(p.store.get(p.id()).groups[0].label, "Starters");
  const rs = p.ed.resolveGroup(g.result.id, true);
  assert.ok(p.store.get(p.id()).groups[0].resolved);
  rs.undo();
  assert.ok(!p.store.get(p.id()).groups[0].resolved);
  const before = p.store.card(p.id(), c1.id).x;
  const gm = p.ed.moveGroup(g.result.id, g.result.x + 100, g.result.y);
  assert.strictEqual(p.store.card(p.id(), c1.id).x, before + 100, "cards move with their group");
  gm.undo();
  assert.strictEqual(p.store.card(p.id(), c1.id).x, before);
  g.undo();
  assert.strictEqual(p.store.get(p.id()).groups.length, 0);
});

test("notes and questions: add, edit, reply, resolve, remove, Undo; questions survive a save", () => {
  const p = phone();
  const n = p.ed.note(100, 100, "Feed twice a day");
  assert.strictEqual(n.result.kind, "note");
  p.ed.editNote(n.result.id, "Feed once a day").undo();
  assert.strictEqual(p.store.card(p.id(), n.result.id).text, "Feed twice a day");
  const q = p.ed.question(400, 100, "Does rye matter?");
  assert.strictEqual(q.result.kind, "question");
  // The question is a thread: a later save keeps it.
  p.research.visit("https://example.org/z", "Z", []);
  p.research.saveNow();
  assert.ok(p.store.card(p.id(), q.result.id) && !p.store.card(p.id(), q.result.id).removed);
  assert.ok(p.research.findThread(q.result.id));
  p.ed.reply(q.result.id, "Yes, faster rise");
  assert.strictEqual(p.store.card(p.id(), q.result.id).replies.length, 1);
  const rv = p.ed.resolveQuestion(q.result.id, true, "Rye is faster");
  assert.strictEqual(p.store.card(p.id(), q.result.id).status, "resolved");
  rv.undo();
  assert.strictEqual(p.store.card(p.id(), q.result.id).status, "open");
  const rm = p.ed.remove(n.result.id);
  assert.ok(p.store.card(p.id(), n.result.id).removed);
  rm.undo();
  assert.ok(!p.store.card(p.id(), n.result.id).removed);
  n.undo();
  assert.ok(!p.store.card(p.id(), n.result.id));
  q.undo();
  p.research.saveNow();
  assert.ok(!p.store.snapshot(p.id()).cards.some((c) => c.kind === "question"));
});

test("timeline-only page put on the canvas; opened files can't be edited", () => {
  const p = phone();
  p.eng.started("a", "https://example.org/quick");
  p.eng.tick(["a"]);
  p.eng.started("a", "https://example.org/other");
  const put = p.ed.place("https://example.org/quick");
  assert.ok(put && cards(p).some((c) => c.url === "https://example.org/quick"));
  put.undo();
  assert.ok(!cards(p).some((c) => c.url === "https://example.org/quick"));
  const ro = p.store.create("Opened", { current: false });
  p.store.get(ro.trail.id).trail.readonly = true;
  p.research.switchTo(ro.trail.id);
  assert.strictEqual(p.ed.editable(), false);
  assert.strictEqual(p.ed.note(0, 0, "x"), null);
});

console.log(`\n${passed} passed`);
