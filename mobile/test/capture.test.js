// M18 smart capture: the model, in plain Node. Run: npm test (in mobile/).
const assert = require("assert");
const core = require("../../core");
const { TrailStore } = require("../../core/trail");
const TrailFile = require("../../core/trail-file");
const C = require("../src/capture");

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`ok ${passed} - ${name}`);
};
const AT = Date.UTC(2026, 10, 8, 14, 2);

test("DOIs are found and cleaned", () => {
  assert.strictEqual(C.cleanDoi("https://doi.org/10.1038/S41586-024-07000-X."), "10.1038/s41586-024-07000-x");
  assert.strictEqual(C.cleanDoi("doi:10.1016/j.cell.2020.01.001)"), "10.1016/j.cell.2020.01.001");
  assert.strictEqual(C.cleanDoi("see (doi 10.1000/abc(12)3)"), "10.1000/abc(12)3");
  assert.strictEqual(C.cleanDoi("https://example.org/10.5/x"), null, "a registrant needs 4+ digits");
  assert.strictEqual(C.cleanDoi("https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0012345"), "10.1371/journal.pone.0012345");
});

test("metadata beats links and text; PMIDs from meta or the address", () => {
  const ids = C.findIds({ url: "https://a.org/x", metas: [["citation_doi", "10.1234/meta"], ["citation_pmid", "31234567"]], links: ["https://doi.org/10.9999/link"], text: "10.5555/text" });
  assert.deepStrictEqual(ids, { doi: "10.1234/meta", pmid: "31234567" });
  assert.deepStrictEqual(C.findIds({ url: "https://pubmed.ncbi.nlm.nih.gov/12345678/", text: "nothing" }), { doi: null, pmid: "12345678" });
  assert.strictEqual(C.findIds({ url: "https://b.org", links: ["https://doi.org/10.9999/link"] }).doi, "10.9999/link");
  assert.deepStrictEqual(C.findIds({ url: "https://news.example.com/story", text: "no ids here" }), { doi: null, pmid: null });
});

test("a capture keeps quote, time zone, DOI; sign-in pages are refused", () => {
  const r = C.buildCapture({ url: "https://www.nature.com/articles/x", title: "Starter microbes", selection: "  Rye flour  feeds\\nthe starter ", metas: [["citation_doi", "10.1038/x1"]], links: [], text: "" }, { at: AT, shot: "file:///c/1.jpg" });
  assert.strictEqual(r.card.kind, "capture");
  assert.strictEqual(r.card.quote, "Rye flour feeds\\nthe starter");
  assert.strictEqual(r.card.doi, "10.1038/x1");
  assert.strictEqual(r.card.source, "nature.com");
  assert.ok(/^Captured from nature\.com · phone \d\d:\d\d GMT[+-]?[\d:]* · DOI 10\.1038\/x1$/.test(r.card.fromText), r.card.fromText);
  assert.strictEqual(typeof r.card.tzOffset, "number");
  assert.strictEqual(r.card.captureKind, "shot");
  assert.match(C.buildCapture({ url: "https://accounts.google.com/signin", title: "x" }).error, /never captured/);
  assert.match(C.buildCapture({ url: "about:blank" }).error, /Only web pages/);
  assert.match(C.buildCapture({ error: "boom" }).error, /Couldn't read/);
  assert.strictEqual(C.buildCapture({ url: "https://a.org", selection: "" }, { selection: "earlier pick" }).card.quote, "earlier pick");
  assert.strictEqual(C.buildCapture({ url: "https://a.org", selection: "x".repeat(900) }).card.quote.length, C.QUOTE_MAX);
});

test("saved into the trail: page card, capture card, link; Undo takes both back; it travels in the file", () => {
  const store = new TrailStore(core.memoryStorage({}), { device: "phone", now: () => AT });
  const id = store.current().trail.id;
  const { card } = C.buildCapture({ url: "https://www.nature.com/articles/x", title: "Starter microbes", selection: "Rye flour feeds the starter", metas: [["citation_doi", "10.1038/x1"]] }, { at: AT });
  const saved = C.saveCapture(store, id, card);
  assert.ok(saved.card && saved.page && saved.newPage);
  const snap = store.snapshot(id);
  assert.ok(snap.lines.some((l) => l.from === saved.page.id && l.to === saved.card.id && l.label === "captured from"));
  const items = snap.timeline.flatMap((s) => s.items);
  assert.ok(items.some((i) => i.type === "captured" && i.card === saved.card.id), "on the timeline");
  const text = TrailFile.toTrailMd(snap, { by: "Sven", at: AT });
  assert.ok(text.includes("> Rye flour feeds the starter"));
  assert.ok(text.includes("DOI 10.1038/x1"));
  const back = TrailFile.parseTrailMd(text);
  assert.ok(back.cards.some((c) => c.kind === "capture" && c.fromText.includes("DOI 10.1038/x1")));
  // A second capture on the same page reuses its card.
  const again = C.saveCapture(store, id, C.buildCapture({ url: card.url, title: "t" }, { at: AT + 1000 }).card);
  assert.strictEqual(again.newPage, false);
  C.undoCapture(store, id, saved);
  const after = store.snapshot(id);
  assert.ok(after.cards.every((c) => c.id !== saved.card.id));
  // The page card stays: the second capture still points at it.
  assert.ok(after.cards.some((c) => c.id === saved.page.id));
  C.undoCapture(store, id, again);
  assert.ok(!store.snapshot(id).cards.some((c) => c.kind === "capture"));
  // A fresh capture on a new page, undone: no cards left behind.
  const n = store.snapshot(id).cards.length;
  const s3 = C.saveCapture(store, id, C.buildCapture({ url: "https://c.org/p", title: "C" }, { at: AT + 2000 }).card);
  C.undoCapture(store, id, s3);
  assert.strictEqual(store.snapshot(id).cards.length, n);
});

test("confirmation line", () => {
  assert.strictEqual(C.capturedText({ quote: "q", doi: "10.1/x" }, "Sourdough"), "Captured to Sourdough · with the selected text · DOI found");
  assert.strictEqual(C.capturedText({}, ""), "Captured to the trail");
});

console.log(`\n${passed} passed`);
