// Trail provenance (B83): core/provenance.js, the fields in the trail store,
// Replay captions and the trail file. Run: npm run test:provenance
const assert = require("assert");
const P = require("../core/provenance");
const { TrailStore } = require("../core/trail");
const { memoryStorage } = require("../core/storage");
const { replaySteps, stepCaption } = require("../core/replay");
const TF = require("../core/trail-file");

let n = 0;
const ok = (name) => console.log(`ok ${++n} - ${name}`);
let clock = Date.parse("2026-11-06T14:00:00Z");
const now = () => clock;
const tick = (ms) => (clock += ms);

// ---- search pages and links ----
assert.strictEqual(P.searchQuery("https://search.brave.com/search?q=levain+temperature"), "levain temperature");
assert.strictEqual(P.searchQuery("https://www.google.com/search?q=rye%20flour&hl=en"), "rye flour");
assert.strictEqual(P.searchQuery("https://duckduckgo.com/?q=spelt"), "spelt");
assert.strictEqual(P.searchQuery("https://www.bing.com/search?q=einkorn"), "einkorn");
assert.strictEqual(P.searchQuery("https://example.com/search?q=not-an-engine"), "");
assert.strictEqual(P.searchQuery("https://www.google.com/maps?q=x"), "");
assert.deepStrictEqual(P.fromPage("https://search.brave.com/search?q=levain"), { how: "search", query: "levain" });
assert.deepStrictEqual(P.fromPage("https://www.reddit.com/r/Sourdough/comments/1"), { how: "link", host: "reddit.com" });
assert.strictEqual(P.fromPage(""), null);
ok("a page opened from search results is a search with its query; from any other page, a link");

// ---- text, both ways ----
const cases = [
  [{ how: "link", host: "reddit.com" }, false, "link from reddit.com"],
  [{ how: "search", query: "levain" }, false, "search “levain”"],
  [{ how: "typed" }, false, "typed address"],
  [{ how: "suggested", query: "rye flour" }, false, "suggested by NODE for “rye flour”"],
  [{ how: "suggested" }, false, "suggested by NODE"],
  [{ how: "agent" }, false, "found by agent"],
  [{ how: "next", host: "youtube.com" }, true, "auto-played next on youtube.com · played by NODE"],
  [null, true, "played by NODE"],
];
for (const [via, played, text] of cases) {
  assert.strictEqual(P.viaText(via, played), text);
  assert.deepStrictEqual(P.parseViaText(text), { via, played });
}
assert.strictEqual(P.viaText({ how: "made-up" }, false), "");
assert.deepStrictEqual(P.clean({ how: "typed", query: "x", host: "y", extra: 1 }), { how: "typed" }, "only known fields are kept");
assert.ok(P.CHOSEN_BY_NODE.has("suggested") && P.CHOSEN_BY_NODE.has("agent") && P.CHOSEN_BY_NODE.has("next") && !P.CHOSEN_BY_NODE.has("search"));
ok("each way of reaching a page has a text that reads back the same");

// ---- in the trail store ----
const store = new TrailStore(memoryStorage(), { now });
const id = store.current().trail.id;
const A = "https://example.com/starters", B = "https://example.com/rye", C = "https://www.youtube.com/watch?v=2", D = "https://example.com/quick", E = "https://example.com/agent";
store.visit(id, A, { title: "Why starters fail" });
tick(20000);
const a = store.placePage(id, A, { title: "Why starters fail", via: { how: "search", query: "levain" }, x: 0, y: 0 });
tick(60000);
store.visit(id, B, { title: "Rye and enzymes" });
tick(20000);
const b = store.placePage(id, B, { title: "Rye and enzymes", from: A, via: { how: "suggested", query: "rye flour" }, x: 300, y: 0 });
tick(60000);
store.visit(id, C, { title: "Shaping a boule" });
tick(20000);
const c = store.placePage(id, C, { title: "Shaping a boule", via: { how: "next", host: "youtube.com" }, x: 600, y: 0 });
tick(60000);
store.visit(id, D, { title: "A quick look" });
tick(4000);
store.bounce(id, D, 4000, { via: { how: "typed" }, played: true });
tick(60000);
store.visit(id, E, { title: "Hydration table" });
tick(20000);
const e = store.placePage(id, E, { title: "Hydration table", via: { how: "agent" }, x: 900, y: 0 });
assert.deepStrictEqual(store.card(id, a.id).via, { how: "search", query: "levain" });
assert.deepStrictEqual(store.card(id, b.id).via, { how: "suggested", query: "rye flour" });
assert.ok(store.events(id).some((x) => x.type === "placed" && x.card === b.id && x.data.via?.how === "suggested"), "the placed event says how");
assert.strictEqual(store.markPlayed(id, A).played, true);
assert.strictEqual(store.markPlayed(id, A), null, "marked once");
const tl = store.timeline(id).flatMap((s) => s.items);
const quick = tl.find((i) => i.url === D);
assert.ok(quick.timelineOnly && quick.via.how === "typed" && quick.played, JSON.stringify(quick));
assert.strictEqual(store.placePage(id, "https://example.com/x", { via: { how: "bad" }, x: 0, y: 900 }).via, undefined, "an unknown way is not stored");
ok("cards keep how their page was reached; a page that stayed in the timeline keeps it in its bounced event; NODE's autoplay marks a card");

// ---- Replay ----
const snap = store.snapshot(id);
const steps = replaySteps(snap, store.events(id));
const byId = new Map(snap.cards.map((k) => [k.id, k]));
const lines = snap.lines;
const seen = new Set();
const caps = steps.map((st) => {
  const t = stepCaption(st, { byId, lines, seen });
  if (st.card) seen.add(st.card);
  return t;
});
assert.ok(caps.includes("You opened “Why starters fail” on example.com, from a search for “levain”. NODE started its video or audio."), caps.join("\n"));
assert.ok(caps.includes("NODE suggested “Rye and enzymes” on example.com for “rye flour”, and you opened it."), caps.join("\n"));
assert.ok(caps.includes("youtube.com played “Shaping a boule” next by itself."), caps.join("\n"));
assert.ok(caps.includes("You visited “A quick look” for 4 s (typed address · played by NODE). It stayed in the timeline only."), caps.join("\n"));
assert.ok(caps.includes("The research agent found “Hydration table” on example.com."), caps.join("\n"));
ok("Replay says how each page was reached and who chose it");

// ---- trail file ----
const md = TF.toTrailMd(snap, { by: "Sven", at: clock });
assert.ok(md.includes("Reached: search “levain” · played by NODE"));
assert.ok(md.includes("Reached: suggested by NODE for “rye flour”"));
assert.ok(md.includes("Reached: auto-played next on youtube.com"));
assert.ok(md.includes("Reached: found by agent"));
assert.ok(/A quick look \(timeline only · typed address · played by NODE\)/.test(md), md);
const back = TF.parseTrailMd(md);
const cardBack = (url) => back.cards.find((k) => k.url === url);
assert.deepStrictEqual(cardBack(A).via, { how: "search", query: "levain" });
assert.strictEqual(cardBack(A).played, true);
assert.deepStrictEqual(cardBack(B).via, { how: "suggested", query: "rye flour" });
assert.ok(!/Reached:/.test(cardBack(B).excerpt || ""), "the line is not read as the excerpt");
const quickBack = back.timeline.flatMap((s) => s.items).find((i) => i.title === "A quick look");
assert.ok(quickBack.timelineOnly && quickBack.via.how === "typed" && quickBack.played);
assert.strictEqual(TF.toTrailMd(back, { by: "Sven", at: back.trail.at }), md, "the file reads back the same");
// Opened by someone else: their cards and timeline keep it, and Replay says it.
const reader = new TrailStore(memoryStorage(), { now });
const opened = reader.importFile(back);
const rs = reader.snapshot(opened.trail.id);
assert.deepStrictEqual(rs.cards.find((k) => k.url === B).via, { how: "suggested", query: "rye flour" });
const rtl = rs.timeline.flatMap((s) => s.items).find((i) => i.title === "A quick look");
assert.ok(rtl && rtl.via?.how === "typed", JSON.stringify(rtl));
ok("a trail file says how each page was reached, reads back the same, and the reader's trail keeps it");

// Older files without the line still open.
const plain = md.replace(/^Reached: .*\n/gm, "").replace(/ \(timeline only · [^)]*\)/g, " (timeline only)");
const old = TF.parseTrailMd(plain);
assert.ok(old.cards.every((k) => !k.via));
ok("files without provenance open as before");

console.log(`\n${n} checks passed`);
