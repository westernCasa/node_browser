// Zoom ladder (B107): core/ladder.js. Run: npm run test:ladder
const assert = require("assert");
const { step, Gesture, galleryChoice, pinchScale } = require("../core/ladder");

let n = 0;
const ok = (name) => console.log(`ok ${++n} - ${name}`);

assert.deepStrictEqual(["page", "mosaic", "gallery", "canvas"].map((l) => step(l, "out")), ["mosaic", "gallery", "canvas", null]);
assert.deepStrictEqual(["page", "mosaic", "gallery", "canvas"].map((l) => step(l, "in")), [null, "page", "mosaic", null]);
ok("pinch out climbs page → Mosaic → Gallery → canvas; pinch in goes back down; the canvas zooms itself");

{
  const g = new Gesture();
  let t = 0;
  const fired = [];
  // One long gesture zooming out: many small events, one step.
  for (let i = 0; i < 40; i++) fired.push(g.feed(0.97, (t += 16)));
  assert.deepStrictEqual(fired.filter(Boolean), ["out"]);
  // A pause shorter than 400 ms: still the same gesture.
  t += 300;
  assert.strictEqual(g.feed(0.5, t), null);
  // After 400 ms without events: a new gesture can fire again.
  t += 401;
  const again = [];
  for (let i = 0; i < 20; i++) again.push(g.feed(1.04, (t += 16)));
  assert.deepStrictEqual(again.filter(Boolean), ["in"]);
  ok("one level per gesture; a gesture ends after 400 ms without wheel events");
}

{
  // page → Mosaic → Gallery → canvas, one gesture each, and back down.
  let level = "page";
  const g = new Gesture();
  let t = 0;
  const pinch = (scale) => {
    t += 500;
    for (let i = 0; i < 20; i++) {
      const d = g.feed(scale, (t += 16));
      if (d) level = step(level, d) || level;
    }
  };
  const seen = [level];
  for (let i = 0; i < 4; i++) {
    pinch(0.95);
    seen.push(level);
  }
  assert.deepStrictEqual(seen, ["page", "mosaic", "gallery", "canvas", "canvas"]);
  level = "gallery";
  pinch(1.05);
  assert.strictEqual(level, "mosaic");
  pinch(1.05);
  assert.strictEqual(level, "page");
  ok("a pinch sequence walks the ladder one level at a time");
}

assert.deepStrictEqual(galleryChoice({ tiles: ["3", "5"], shown: ["1", "2", "3", "5"] }), ["3", "5"]);
assert.deepStrictEqual(galleryChoice({ tiles: [], shown: ["1", "2"] }), ["1", "2"]);
ok("the Gallery preselects the Mosaic set: its chosen tiles, or the tabs it shows");

assert.strictEqual(pinchScale({ ctrlKey: false, deltaY: 3 }), null);
assert.strictEqual(pinchScale({ ctrlKey: true, deltaY: 100 }), null);
assert.ok(pinchScale({ ctrlKey: true, deltaY: 3.5 }) < 1 && pinchScale({ ctrlKey: true, deltaY: -3.5 }) > 1);
ok("a trackpad pinch is told apart from Ctrl + mouse wheel");

console.log(`\n${n} checks passed`);
