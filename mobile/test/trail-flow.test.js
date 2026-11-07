// Phone trail screens: the model under them, in plain Node.
// Run: node mobile/test/trail-flow.test.js (or `npm test` in mobile/).
const assert = require("assert");
const core = require("../../core");
const { TrailStore, migrateSessions, sessionStorageOver } = require("../../core/trail");
const M = require("../src/trailModel");

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`ok ${passed} - ${name}`);
};

const T0 = Date.UTC(2026, 10, 7, 9, 0);
let clock = T0;
const now = () => clock;

// Same wiring as mobile/src/services.js.
function phone(files = {}) {
  const storage = core.memoryStorage(files);
  const trails = prefixed(storage, "trails/");
  const store = new TrailStore(trails, { device: "phone", now });
  const sessions = core.prefixedStorage(storage, "sessions/");
  if (!store.index.migratedAt && sessions.list().some((n) => n.endsWith(".json"))) migrateSessions(sessions, store, { now: clock });
  store.purge();
  store.current();
  const research = new core.ResearchStore(sessionStorageOver(store));
  return { storage, store, research };
}
function prefixed(storage, prefix) {
  return {
    read: (n) => storage.read(prefix + n),
    write: (n, t) => storage.write(prefix + n, t),
    list: () => storage.list().filter((n) => n.startsWith(prefix)).map((n) => n.slice(prefix.length)),
    remove: (n) => storage.remove(prefix + n),
  };
}

test("old phone sessions move into trails, pages read go in as phone visits", () => {
  const old = {
    id: "s1",
    name: "Sourdough starters",
    started: T0 - 3600e3,
    updated: T0 - 600e3,
    trail: [{ url: "https://en.wikipedia.org/wiki/Sourdough", title: "Sourdough", firstAt: T0 - 3000e3, lastAt: T0 - 3000e3, visits: 1, keywords: ["starter"] }],
    opened: [],
    dismissed: [],
    pins: [],
  };
  const { store, research } = phone({ "sessions/s1.json": JSON.stringify(old), "sessions/current.txt": "s1" });
  assert.ok(store.has("s1"));
  assert.strictEqual(research.current.id, store.index.current);
  research.switchTo("s1");
  clock += 60e3;
  research.visit("https://www.kingarthurbaking.com/blog/starter", "Starter guide", ["hydration"]);
  research.saveNow();
  const rows = M.timelineRows(store.snapshot("s1"), clock);
  const items = rows.flatMap((r) => r.items);
  assert.ok(items.some((i) => i.title === "Starter guide" && i.timelineOnly), "phone visit is timeline only");
  assert.ok(rows.some((r) => /Phone/.test(r.label)), "session labelled Phone");
  assert.strictEqual(store.snapshot("s1").cards.length, 0, "phone items do not go on the canvas");
});

test("share file round-trips, with note and Start here", () => {
  const { store } = phone();
  const id = store.current().trail.id;
  store.rename(id, "Curie / radium");
  const a = store.placePage(id, "https://en.wikipedia.org/wiki/Radium", { title: "Radium", x: 0, y: 0 });
  const b = store.placePage(id, "https://en.wikipedia.org/wiki/Marie_Curie", { title: "Marie Curie", from: a.url, x: 400, y: 0 });
  store.placePage(id, "https://accounts.google.com/signin", { title: "Sign in", x: 800, y: 0 });
  const sum = M.shareSummary(store.snapshot(id));
  assert.ok(sum.cards >= 2);
  assert.ok(!sum.startChoices.some((c) => /Sign in/.test(c.title)), "sign-in pages are never sent");
  const text = M.shareText(store, id, { by: "Sven", note: "Start with Curie.\nThen radium.", startHere: b.id, at: T0 });
  const back = require("../../core/trail-file").parseTrailMd(text);
  assert.strictEqual(back.trail.name, "Curie / radium");
  assert.strictEqual(back.trail.by, "Sven");
  assert.strictEqual(back.trail.note, "Start with Curie. Then radium.");
  assert.strictEqual(back.trail.startHere, b.id);
  assert.ok(!/accounts\.google/.test(text));
  assert.strictEqual(M.safeFileName("A/B: c?"), "A B c.trail.md");
  assert.ok(M.byteLength("é") === 2 && /KB|B/.test(M.sizeText(M.byteLength(text))));
});

test("opening a file: read only, Replay steps, same file opens the same trail, Save as new", () => {
  const fs = require("fs");
  const path = require("path");
  const sample = path.join(__dirname, "fixtures", "sourdough-starters.trail.md");
  const text = fs.readFileSync(sample, "utf8");
  const { store, research } = phone();
  const before = store.index.current;
  const r = M.openTrailText(store, text, { file: "sourdough-starters.trail.md" });
  assert.ok(r.id, r.error);
  assert.strictEqual(store.index.current, before, "opening does not change the recording trail");
  const d = store.get(r.id);
  assert.strictEqual(d.trail.readonly, true);
  assert.ok(d.trail.from);
  const again = M.openTrailText(store, text, {});
  assert.strictEqual(again.id, r.id);
  const { steps, shownAt } = M.replayFor(store, r.id);
  assert.ok(steps.length > 0);
  assert.ok(steps.every((s) => typeof s.caption === "string" && s.caption.length));
  assert.ok(shownAt(0).cards.size <= shownAt(steps.length - 1).cards.size);
  // Pages read while a file is shown never write into it.
  research.visit("https://example.org/x", "X", []);
  research.saveNow();
  assert.ok(!store.events(r.id).some((e) => e.data?.url === "https://example.org/x"));
  const copy = M.saveAsNew(store, r.id);
  const cd = store.get(copy);
  assert.strictEqual(cd.trail.readonly, false);
  assert.strictEqual(cd.trail.name, `${d.trail.name} · ${d.trail.from}`);
  assert.strictEqual(M.saveAsNew(store, copy), null, "only opened files are saved as new");
});

test("bad files say what is wrong", () => {
  const { store } = phone();
  assert.match(M.openTrailText(store, "hello").error, /not a NODE trail file/);
  assert.match(M.openTrailText(store, "---\nnode-trail: 9\nname: x\n---\n").error, /newer NODE/);
  assert.match(M.openTrailText(store, "x", { size: 6 * 1024 * 1024 }).error, /too large/);
});

test("canvas view: fit, zoom about a point, centre", () => {
  const box = { x: -100, y: 50, w: 1200, h: 800 };
  const v = M.fitView(box, 400, 700);
  assert.ok(v.z > 0 && v.z <= 1);
  // The box's centre lands on the screen's centre.
  assert.ok(Math.abs((box.x + box.w / 2) * v.z + v.x - 200) < 1e-6);
  const z = M.zoomAt(v, 2, 100, 100);
  assert.ok(Math.abs(((100 - v.x) / v.z) * z.z + z.x - 100) < 1e-6, "point under the fingers stays put");
  assert.strictEqual(M.zoomAt({ x: 0, y: 0, z: 2 }, 10, 0, 0).z, 2.5);
  const c = M.centreOn({ x: 0, y: 0, z: 0.5 }, 1000, 1000, 400, 700);
  assert.strictEqual(c.x, 200 - 500);
  assert.deepStrictEqual(M.worldBounds({ cards: [], groups: [] }), { x: 0, y: 0, w: 600, h: 400 });
});

test("labels", () => {
  assert.strictEqual(M.ago(T0 - 30e3, T0), "just now");
  assert.strictEqual(M.ago(T0 - 5 * 60e3, T0), "5 min ago");
  assert.strictEqual(M.ago(T0 - 30 * 3600e3, T0), "yesterday");
  assert.strictEqual(M.cardFace({ kind: "capture", quote: "Feed it twice a day", url: "https://a.org/x" }).kicker, "capture · a.org");
});

console.log(`\n${passed} passed`);
