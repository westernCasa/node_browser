// Mosaic layouts: every layout fills the area with no overlaps.
const assert = require("assert");
const { LAYOUTS, layoutRects, isLayout } = require("../src/mosaicLayout");

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`ok ${passed} - ${name}`);
};
const close = (a, b) => Math.abs(a - b) < 1e-9;
const area = (rs) => rs.reduce((s, r) => s + r.width * r.height, 0);
const overlap = (a, b) => a.left < b.left + b.width - 1e-9 && b.left < a.left + a.width - 1e-9 && a.top < b.top + b.height - 1e-9 && b.top < a.top + a.height - 1e-9;

test("every layout covers the whole area once, for 1-9 tiles, any active tile", () => {
  for (const { id } of LAYOUTS)
    for (let n = 1; n <= 9; n++)
      for (const wide of [false, true])
        for (let active = 0; active < n; active++) {
          const rs = layoutRects(id, n, { active, wide });
          assert.strictEqual(rs.length, n);
          assert.ok(close(area(rs), 100 * 100), `${id} n=${n} area ${area(rs)}`);
          for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) assert.ok(!overlap(rs[i], rs[j]), `${id} n=${n} tiles ${i},${j} overlap`);
        }
});

test("Auto keeps the old layout: stacked up to 3, 2 by 2 for 4, square grid when wide", () => {
  assert.deepStrictEqual(layoutRects("auto", 3).map((r) => r.width), [100, 100, 100]);
  assert.deepStrictEqual(layoutRects("auto", 4).map((r) => [r.width, r.height]), [[50, 50], [50, 50], [50, 50], [50, 50]]);
  assert.strictEqual(layoutRects("auto", 9, { wide: true })[0].width, 100 / 3);
  assert.deepStrictEqual(layoutRects("nonsense", 2), layoutRects("auto", 2));
});

test("Focus puts the active tile large on top", () => {
  const rs = layoutRects("focus", 4, { active: 2 });
  assert.deepStrictEqual(rs[2], { left: 0, top: 0, width: 100, height: 66 });
  assert.ok([0, 1, 3].every((i) => rs[i].top === 66));
});

test("Grid with 3 tiles: the last tile spans the bottom row", () => {
  assert.deepStrictEqual(layoutRects("grid", 3)[2], { left: 0, top: 50, width: 100, height: 50 });
  assert.ok(isLayout("side") && !isLayout("x"));
});

console.log(`\n${passed} passed`);
