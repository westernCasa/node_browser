// Find things in past trails by what you remember (B89): core/recall.js.
// Run: npm run test:recall
const assert = require("assert");
const { parseRecall, recallIndex, recall } = require("../core/recall");
const { TrailStore } = require("../core/trail");
const { memoryStorage } = require("../core/storage");

let n = 0;
const ok = (name) => console.log(`ok ${++n} - ${name}`);
// Friday 6 November 2026, 15:00 local time.
const NOW = new Date(2026, 10, 6, 15, 0).getTime();
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const day = (t) => new Date(t).toDateString();

// ---- reading the words ----
{
  const p = parseRecall("the video after the Discogs page last Tuesday", { now: NOW });
  assert.deepStrictEqual(p.kinds, ["video"]);
  assert.deepStrictEqual(p.order, { rel: "after", words: ["discogs"] });
  assert.strictEqual(day(p.range[0]), new Date(2026, 10, 3).toDateString(), "last Tuesday from Friday 6 Nov is 3 Nov");
  assert.deepStrictEqual(p.words, []);
  const y = parseRecall("levain hydration yesterday", { now: NOW });
  assert.deepStrictEqual(y.words, ["levain", "hydration"]);
  assert.strictEqual(day(y.range[0]), new Date(2026, 10, 5).toDateString());
  assert.strictEqual(y.range[1] - y.range[0], 86400000);
  assert.strictEqual(day(parseRecall("friday", { now: NOW }).range[0]), new Date(2026, 10, 6).toDateString(), "a weekday alone can be today");
  assert.strictEqual(day(parseRecall("last friday", { now: NOW }).range[0]), new Date(2026, 9, 30).toDateString(), "last Friday is the week before");
  const oct = parseRecall("in October", { now: NOW }).range;
  assert.strictEqual(day(oct[0]), new Date(2026, 9, 1).toDateString());
  assert.strictEqual(day(oct[1]), new Date(2026, 10, 1).toDateString());
  assert.strictEqual(new Date(parseRecall("december", { now: NOW }).range[0]).getFullYear(), 2025, "a month not reached yet is last year's");
  const lw = parseRecall("last week", { now: NOW }).range;
  assert.strictEqual(day(lw[0]), new Date(2026, 9, 26).toDateString(), "last week starts on the Monday before");
  assert.strictEqual(day(parseRecall("3 days ago", { now: NOW }).range[0]), new Date(2026, 10, 3).toDateString());
  assert.deepStrictEqual(parseRecall("before the rye flour one", { now: NOW }).order, { rel: "before", words: ["rye", "flour"] });
  assert.deepStrictEqual(parseRecall("question about starters", { now: NOW }).kinds, ["question"]);
  const tr = parseRecall("hydration in rye breads", { now: NOW, trails: [{ id: "t1", name: "Rye breads" }] });
  assert.strictEqual(tr.trail, "t1");
  assert.deepStrictEqual(tr.words, ["hydration"]);
  ok("times, order, kinds and a trail name are read from the words; the rest are keywords");
}

// ---- two trails, a week of browsing ----
let clock = at(2026, 11, 3, 10);
const store = new TrailStore(memoryStorage(), { now: () => clock });
const rye = store.current().trail.id;
store.rename(rye, "Rye breads");
const visit = (id, url, title, { card = false, dwell = 30000 } = {}) => {
  store.visit(id, url, { title });
  clock += dwell;
  if (card) store.placePage(id, url, { title, x: 0, y: 0 });
  else store.bounce(id, url, dwell);
  clock += 60000;
};
// Tuesday 3 Nov
visit(rye, "https://www.discogs.com/release/123-Rye-Sessions", "Rye Sessions – Discogs", { card: true });
visit(rye, "https://www.youtube.com/watch?v=abc", "Shaping a rye boule", { card: true });
visit(rye, "https://example.com/enzymes", "Rye and enzymes");
visit(rye, "https://example.com/hydration", "Hydration for rye", { card: true });
// Wednesday 4 Nov
clock = at(2026, 11, 4, 20);
const starters = store.create("Starters").trail.id;
visit(starters, "https://www.reddit.com/r/Sourdough/comments/1", "Why my starter smells", { card: true });
visit(starters, "https://soundcloud.com/bakers/levain-talk", "A talk about levain");
store.addCard(starters, { kind: "question", text: "Does rye flour make a starter faster?", x: 0, y: 300, placedAt: clock });
clock += 60000;
store.addCard(starters, { kind: "note", text: "Feed twice a day at 25°C", x: 300, y: 300, placedAt: clock });
// Thursday 5 Nov (yesterday)
clock = at(2026, 11, 5, 9);
visit(rye, "https://www.discogs.com/artist/9-Bakers", "The Bakers – Discogs");
visit(rye, "https://example.com/spelt", "Spelt versus rye", { card: true });
clock = NOW;

const entries = recallIndex(store);
const trails = store.list();
const find = (q, o = {}) => recall(entries, q, { now: NOW, trails, ...o });
const titles = (r) => r.map((x) => x.title);

{
  assert.ok(entries.length >= 10);
  assert.ok(entries.some((e) => e.kind === "question") && entries.some((e) => e.kind === "note"));
  assert.ok(entries.find((e) => e.title === "Rye and enzymes").timelineOnly);
  ok("the index holds every trail's pages, cards and timeline-only visits");
}
{
  const r = find("the video after the Discogs page");
  assert.strictEqual(r[0].title, "Shaping a rye boule", titles(r).join());
  assert.strictEqual(r[0].trail, rye);
  assert.ok(/^after “Rye Sessions – Discogs” · Tue 3 Nov · Rye breads$/.test(r[0].why), r[0].why);
  const r2 = find("after the discogs page");
  assert.deepStrictEqual(titles(r2).slice(0, 2).sort(), ["Shaping a rye boule", "Spelt versus rye"], "the pages right after each Discogs page come first");
  assert.ok(titles(r2).indexOf("Rye and enzymes") > 1, "then the ones after those");
  ok("“the video after the Discogs page” finds the video that came next");
}
{
  const r = find("before hydration");
  assert.strictEqual(r[0].title, "Rye and enzymes", titles(r).join());
  assert.ok(r[0].timelineOnly, "a page that stayed in the timeline can be found");
  ok("“before …” finds what came just before");
}
{
  const r = find("rye yesterday");
  assert.deepStrictEqual(titles(r), ["Spelt versus rye"]);
  assert.strictEqual(find("discogs last tuesday")[0].title, "Rye Sessions – Discogs");
  assert.ok(find("discogs last tuesday").every((x) => x.title !== "The Bakers – Discogs"));
  ok("a time keeps only what was seen then");
}
{
  const r = find("rye flour question");
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].kind, "question");
  assert.strictEqual(r[0].trailName, "Starters");
  assert.strictEqual(find("25°C")[0].kind, "note");
  assert.strictEqual(find("levain podcast")[0].title, "A talk about levain");
  ok("questions, notes and kinds (podcast → audio) can be found");
}
{
  const r = find("rye in starters");
  assert.ok(r.length && r.every((x) => x.trail === starters), titles(r).join());
  ok("“in <trail name>” keeps to that trail");
}
{
  const r = find("rye");
  assert.ok(r[0].title.toLowerCase().includes("rye"), "a title match comes first");
  assert.strictEqual(new Set(r.map((x) => `${x.trail} ${x.url || x.card}`)).size, r.length, "each page once");
  assert.deepStrictEqual(find("the"), []);
  assert.deepStrictEqual(find(""), []);
  assert.deepStrictEqual(find("nothing-like-this"), []);
  ok("plain words work; words that say nothing find nothing");
}
{
  // 40 trails of 150 pages each stays quick.
  let big = at(2026, 9, 1);
  const s = new TrailStore(memoryStorage(), { now: () => big });
  for (let t = 0; t < 40; t++) {
    const id = t ? s.create(`Trail ${t}`).trail.id : s.current().trail.id;
    for (let i = 0; i < 150; i++) {
      const url = `https://example.com/t${t}/p${i}`;
      s.visit(id, url, { title: `Page ${i} about topic ${t}` });
      big += 30000;
      if (i % 5 === 0) s.placePage(id, url, { title: `Page ${i} about topic ${t}`, x: i * 10, y: 0 });
      else s.bounce(id, url, 30000);
      big += 60000;
    }
  }
  const t0 = Date.now();
  const idx = recallIndex(s);
  const r = recall(idx, "after page 12 topic 7", { now: big, trails: s.list() });
  const ms = Date.now() - t0;
  assert.ok(idx.length === 6000 && r.length > 0, `${idx.length} ${r.length}`);
  assert.ok(ms < 1500, `${ms} ms`);
  ok(`6,000 pages in 40 trails: index and search in ${ms} ms`);
}
console.log(`\n${n} checks passed`);
