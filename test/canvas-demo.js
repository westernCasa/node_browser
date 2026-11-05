// Trail canvas view maths (B101): renderer/canvas.js. Run: npm run test:canvas
const assert = require("assert");
const C = require("../renderer/canvas");

let n = 0;
const ok = (name) => console.log(`ok ${++n} - ${name}`);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

// Zoom keeps the point under the pointer still and stays within 20%–250%.
{
  const v = { x: 100, y: 50, z: 1 };
  const px = 400, py = 300;
  const wx = (px - v.x) / v.z, wy = (py - v.y) / v.z;
  const z2 = C.zoomAt(v, 2, px, py);
  near(z2.x + wx * z2.z, px, "x under pointer");
  near(z2.y + wy * z2.z, py, "y under pointer");
  assert.strictEqual(C.zoomAt(v, 10, 0, 0).z, 2.5);
  assert.strictEqual(C.zoomAt(v, 0.01, 0, 0).z, 0.2);
  ok("zoom keeps the point under the pointer and clamps to 20%-250%");
}

// Bounds include group names; Fit centres them and never zooms past 100%.
{
  const cards = [
    { x: 0, y: 0, w: 260, h: 200 },
    { x: 400, y: 300, w: 260, h: 200 },
  ];
  const groups = [{ x: -24, y: -48, w: 308, h: 272 }];
  const b = C.worldBounds(cards, groups);
  assert.deepStrictEqual(b, { x: -24, y: -76, w: 684, h: 576 });
  const v = C.fitView(b, 1200, 800);
  assert.ok(v.z <= 1);
  near(v.x + (b.x + b.w / 2) * v.z, 600, "centred across");
  near(v.y + (b.y + b.h / 2) * v.z, 400, "centred down");
  const big = C.fitView({ x: 0, y: 0, w: 100000, h: 100000 }, 1200, 800);
  assert.strictEqual(big.z, 0.2);
  assert.strictEqual(C.worldBounds([], []), null);
  ok("Fit centres every card and group name, between 20% and 100%");
}

// Lines leave each card at its edge; nav lines stop short for the arrow.
{
  const a = { x: 0, y: 0, w: 200, h: 100 };
  const b = { x: 400, y: 0, w: 200, h: 100 };
  const you = C.lineEnds(a, b, "you");
  assert.deepStrictEqual(you, { x1: 206, y1: 50, x2: 394, y2: 50 });
  assert.strictEqual(C.lineEnds(a, b, "nav").x2, 396);
  assert.strictEqual(C.lineEnds(a, { x: 50, y: 20, w: 200, h: 100 }, "you"), null);
  ok("lines start and end 6 px outside the cards; overlapping cards get none");
}

// The minimap box matches what is on screen.
{
  const b = { x: 0, y: 0, w: 2000, h: 1200 };
  const v = { x: -500, y: -200, z: 0.5 };
  const mm = C.minimap(b, v, 1000, 600);
  const tl = mm.toWorld(mm.seen.x, mm.seen.y);
  near(tl.x, 1000, "left edge in world");
  near(tl.y, 400, "top edge in world");
  near(mm.seen.w / mm.m, 2000, "width in world");
  assert.ok(mm.map(b).w <= 180 && mm.map(b).h <= 116);
  ok("the minimap shows the visible part of the world and fits 180 x 116");
}

// The dot grid lines up with world points and thins out below 50%.
{
  const g = C.gridFor({ x: 30, y: -10, z: 1 });
  assert.deepStrictEqual(g, { gap: 24, ox: 6, oy: 14 });
  assert.strictEqual(C.gridFor({ x: 0, y: 0, z: 0.4 }).gap, 24 * 0.4 * 2);
  ok("dots sit 24 px apart at 100% and on the same world points as the canvas moves");
}

console.log(`\n${n} checks passed`);
