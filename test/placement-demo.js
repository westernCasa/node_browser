// Card placement (B104): core/placement.js. Run: npm run test:placement
const assert = require("assert");
const { placeNear, applyMoves, groupOf, hits, centreIn } = require("../core/placement");

let n = 0;
const ok = (name) => console.log(`ok ${++n} - ${name}`);
const card = (id, x, y, extra = {}) => ({ id, kind: "page", x, y, w: 260, h: 200, ...extra });

// Inside the source's group, nearest the source.
{
  const g = { id: "g1", x: 0, y: 0, w: 900, h: 300, label: "LEVAIN" };
  const src = card("a", 24, 48);
  const far = card("b", 600, 48);
  const view = { cards: [src, far], groups: [g] };
  const p = placeNear(view, src, 260, 200);
  const placed = { x: p.x, y: p.y, w: 260, h: 200 };
  assert.strictEqual(groupOf(placed, [g])?.id, "g1", "the new card is in the source's group");
  assert.ok(!hits(placed, src, 1) && !hits(placed, far, 1), "no overlap");
  assert.ok(Math.abs(p.x - src.x) < Math.abs(p.x - far.x), "nearer the source than the other card");
  assert.deepStrictEqual(p.moves, []);
  ok("a new card lands in free space inside the source's group, nearest the source");
}

// Group full: it grows, and what is below moves down; pinned cards stay.
{
  const g = { id: "g1", x: 0, y: 0, w: 308, h: 272 };
  const src = card("a", 24, 48);
  const below = { id: "g2", x: 0, y: 400, w: 600, h: 300 };
  const inBelow = card("c", 24, 448);
  const pinned = card("p", 700, 500, { pinned: true });
  const loose = card("d", 340, 320);
  const view = { cards: [src, inBelow, pinned, loose], groups: [g, below] };
  const p = placeNear(view, src, 260, 200);
  const after = applyMoves(view, p.moves);
  const grown = after.groups.find((x) => x.id === "g1");
  const placed = { x: p.x, y: p.y, w: 260, h: 200 };
  assert.ok(grown.h > g.h && centreIn(placed, grown), "the group grew and holds the new card");
  assert.ok(after.groups.find((x) => x.id === "g2").y > below.y, "the group below moved down");
  assert.strictEqual(after.cards.find((x) => x.id === "c").y - inBelow.y, after.groups.find((x) => x.id === "g2").y - below.y, "its card moved with it");
  assert.strictEqual(after.cards.find((x) => x.id === "p").y, pinned.y, "a pinned card never moves");
  assert.ok(!hits(placed, src, 1), "no overlap with the source");
  ok("a full group grows and pushes the groups and cards below it down; pinned cards stay");
}

// Not in a group: next to the source. No source: near the point given.
{
  const src = card("a", 0, 0);
  const p = placeNear({ cards: [src], groups: [] }, src, 260, 200);
  assert.deepStrictEqual([p.x, p.y], [300, 0], "right of the source first");
  const q = placeNear({ cards: [src], groups: [] }, null, 260, 200, { near: { x: 1000, y: 1000 } });
  assert.deepStrictEqual([q.x + 130, q.y + 100], [1000, 1000], "centred on the point when it is free");
  const r = placeNear({ cards: [src], groups: [] }, null, 260, 200, { near: { x: 130, y: 100 } });
  assert.ok(!hits({ x: r.x, y: r.y, w: 260, h: 200 }, src, 1), "moved off a taken spot");
  ok("outside a group: beside the source; with no source: near the middle of the screen");
}

// 50 random adds: no overlaps.
{
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let view = {
    cards: [card("c0", 24, 48), card("c1", 1000, 48)],
    groups: [{ id: "g1", x: 0, y: 0, w: 600, h: 272 }, { id: "g2", x: 0, y: 500, w: 600, h: 272 }],
  };
  view.cards.push(card("c2", 24, 548));
  for (let i = 3; i < 53; i++) {
    const src = view.cards[Math.floor(rnd() * view.cards.length)];
    const h = 140 + Math.floor(rnd() * 5) * 20;
    const p = placeNear(view, src, 260, h);
    view = applyMoves(view, p.moves);
    view.cards.push({ id: `c${i}`, kind: "page", x: p.x, y: p.y, w: 260, h });
  }
  const cs = view.cards;
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) assert.ok(!hits(cs[i], cs[j]), `cards ${cs[i].id} and ${cs[j].id} overlap`);
  // A card is either inside a group or clear of it.
  for (const c of cs) for (const g of view.groups) assert.ok(centreIn(c, g) || !hits(c, g), `card ${c.id} straddles group ${g.id}`);
  // Groups do not overlap each other.
  assert.ok(!hits(view.groups[0], view.groups[1]), "groups overlap");
  ok("no overlaps after 50 random adds (cards, groups, and cards half in a group)");
}

console.log(`\n${n} checks passed`);
