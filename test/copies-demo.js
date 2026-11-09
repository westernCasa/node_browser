// Saved copies (B87): copies on page cards, the trail setting, and the
// trail file. The files themselves are main.js's (see e2e 53).
// Run: npm run test:copies
const assert = require("assert");
const { TrailStore } = require("../core/trail");
const { memoryStorage } = require("../core/storage");
const TF = require("../core/trail-file");

let n = 0;
const ok = (name) => console.log(`ok ${++n} - ${name}`);
let clock = new Date(2026, 10, 8, 10, 5).getTime();
const now = () => clock;
const store = new TrailStore(memoryStorage(), { now });
const id = store.current().trail.id;
const A = "https://example.com/levain", B = "https://example.com/rye";
const H1 = "a".repeat(64), H2 = "b".repeat(64);
store.visit(id, A, { title: "Levain" });
clock += 20000;
const card = store.placePage(id, A, { title: "Levain", x: 0, y: 0 });
{
  const c1 = store.addCopy(id, A, { sha256: H1, bytes: 120000 });
  assert.deepStrictEqual(c1, { at: clock, sha256: H1, bytes: 120000 });
  assert.strictEqual(store.addCopy(id, A, { sha256: H1, bytes: 120000 }), c1, "the same page again is the same copy");
  clock += 3600000;
  store.addCopy(id, A, { sha256: H2, bytes: 130000 });
  assert.strictEqual(store.card(id, card.id).copies.length, 2, "a changed page is a second copy");
  assert.strictEqual(store.events(id).filter((e) => e.type === "copied").length, 2, "each copy is an event");
  assert.strictEqual(store.addCopy(id, B, { sha256: H1 }), null, "only pages with a card");
  assert.strictEqual(store.addCopy(id, A, { sha256: "nothex" }), null);
  store.visit(id, "https://accounts.google.com/signin", { title: "Sign in" });
  assert.strictEqual(store.addCopy(id, "https://accounts.google.com/signin", { sha256: H1 }), null, "never sign-in pages (B66)");
  assert.deepStrictEqual([...store.copyHashes()].sort(), [H1, H2]);
  assert.ok(!store.timeline(id).flatMap((s) => s.items).some((i) => i.type === "copied"), "copies don't add timeline rows");
  ok("a page card keeps its copies, newest last, each once, each an event");
}
{
  assert.strictEqual(store.list()[0].keepCopies, false);
  assert.strictEqual(store.setKeepCopies(id, true), true);
  assert.strictEqual(new TrailStore(store.storage, { now }).list()[0].keepCopies, true, "the setting is saved with the trail");
  ok("the trail setting “Keep copies” is per trail and saved");
}
{
  const snap = store.snapshot(id);
  const md = TF.toTrailMd(snap, { by: "Sven", at: clock });
  assert.ok(md.includes(`Copy: 8 Nov 2026 10:05 · SHA-256 ${H1}\n`), md);
  assert.ok(md.includes(`Copy: 8 Nov 2026 11:05 · SHA-256 ${H2}\n`));
  assert.ok(!md.includes("[saved copy]"), "without the choice, copies are only listed");
  const back = TF.parseTrailMd(md);
  const c = back.cards.find((k) => k.url === A);
  assert.deepStrictEqual(c.copies, [{ atText: "8 Nov 2026 10:05", sha256: H1 }, { atText: "8 Nov 2026 11:05", sha256: H2 }]);
  assert.ok(!/Copy:/.test(c.excerpt || ""), "copy lines are not read as the excerpt");
  assert.strictEqual(TF.toTrailMd(back, { by: "Sven", at: back.trail.at }), md, "the file reads back the same");
  const md2 = TF.toTrailMd(snap, { by: "Sven", at: clock, copies: { folder: "Levain trail copies", include: [H2] } });
  assert.ok(md2.includes(`Copy: 8 Nov 2026 11:05 · SHA-256 ${H2} · [saved copy](Levain%20trail%20copies/${H2}.mhtml)`), md2);
  assert.ok(md2.includes(`Copy: 8 Nov 2026 10:05 · SHA-256 ${H1}\n`), "copies not sent stay listed only");
  const back2 = TF.parseTrailMd(md2);
  assert.strictEqual(back2.cards.find((k) => k.url === A).copies[1].file, `Levain trail copies/${H2}.mhtml`);
  const reader = new TrailStore(memoryStorage(), { now });
  const opened = reader.importFile(back2);
  assert.strictEqual(reader.snapshot(opened.trail.id).cards.find((k) => k.url === A).copies.length, 2, "the reader's trail lists them");
  ok("trail files list copies with time and SHA-256; sent copies link to the folder beside the file");
}
{
  const ro = new TrailStore(memoryStorage(), { now });
  const f = ro.importFile(TF.parseTrailMd(TF.toTrailMd(store.snapshot(id), { by: "Sven", at: clock }))).trail.id;
  assert.strictEqual(ro.addCopy(f, A, { sha256: "c".repeat(64) }), null);
  assert.strictEqual(ro.setKeepCopies(f, true), null);
  ok("an opened file (read only) gets no new copies or setting");
}
console.log(`\n${n} checks passed`);
