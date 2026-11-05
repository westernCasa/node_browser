// Where a new card goes on the trail canvas (B104, handoff spec 3).
// No Electron or DOM imports.
//
// placeNear(view, source, w, h) puts a card of size w × h near its source
// card (the page it was opened from):
//   - Inside the source's group: the free spot nearest the source.
//   - Group full: the group grows at the bottom and the card goes there; every
//     group and card below the group moves down by the same amount, so nothing
//     overlaps. Pinned cards (moved by the person) never move.
//   - Source not in a group: the nearest free spot around the source.
//   - No source: the free spot nearest `near` (the middle of the screen), or
//     under everything.
// It returns { x, y, moves } and changes nothing: moves lists the groups and
// cards to change, as { kind: "group" | "card", id, y, h? }.
//
// view: { cards: [{ id, x, y, w, h, pinned, removed }], groups: [{ id, x, y, w, h, suggested }] }

const GAP = 16; // between cards
const SIDE = 24; // group padding: sides and bottom
const TOP = 48; // group padding: top (the name sits above the group)
const NAME = 28; // space a group's name takes above it
const STEP = 20; // search grid

const live = (cards) => (cards || []).filter((c) => !c.removed);
const centre = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const centreIn = (c, g) => {
  const p = centre(c);
  return p.x >= g.x && p.x <= g.x + g.w && p.y >= g.y && p.y <= g.y + g.h;
};
const hits = (a, b, m = 0) => !(a.x + a.w + m <= b.x || b.x + b.w + m <= a.x || a.y + a.h + m <= b.y || b.y + b.h + m <= a.y);
const dist2 = (a, p) => {
  const c = centre(a);
  return (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
};

// The group a card belongs to: the first (not suggested) group its centre is in.
function groupOf(card, groups) {
  return (groups || []).find((g) => !g.suggested && centreIn(card, g)) || null;
}

// A group with its name: what a card outside the group must keep clear of.
const groupBox = (g) => ({ x: g.x, y: g.y - NAME, w: g.w, h: g.h + NAME });

function freeInside(group, w, h, cards, near) {
  let best = null;
  let bd = Infinity;
  for (let y = group.y + TOP; y + h <= group.y + group.h - SIDE; y += STEP) {
    for (let x = group.x + SIDE; x + w <= group.x + group.w - SIDE; x += STEP) {
      const r = { x, y, w, h };
      if (cards.some((c) => hits(r, c, GAP))) continue;
      const d = dist2(r, near);
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
  }
  return best;
}

// The nearest free spot to point p, outside every group, by rings of STEP.
function freeOutside(w, h, cards, groups, p) {
  const blocked = (r) => cards.some((c) => hits(r, c, GAP)) || groups.some((g) => hits(r, groupBox(g), SIDE));
  const at = (x, y) => ({ x: Math.round(x - w / 2), y: Math.round(y - h / 2), w, h });
  if (!blocked(at(p.x, p.y))) return at(p.x, p.y);
  for (let ring = 1; ring < 400; ring++) {
    let best = null;
    let bd = Infinity;
    const d = ring * STEP;
    for (let i = -ring; i <= ring; i++) {
      for (const [dx, dy] of [
        [i * STEP, -d],
        [i * STEP, d],
        [-d, i * STEP],
        [d, i * STEP],
      ]) {
        const r = at(p.x + dx, p.y + dy);
        if (blocked(r)) continue;
        const dd = dx * dx + dy * dy;
        if (dd < bd) {
          bd = dd;
          best = r;
        }
      }
    }
    if (best) return best;
  }
  // Very crowded: under everything.
  const bottom = Math.max(0, ...cards.map((c) => c.y + c.h), ...groups.map((g) => g.y + g.h));
  return { x: Math.round(p.x - w / 2), y: bottom + 60, w, h };
}

// Spots around a card first (right, below, left, above, then the corners),
// as the prototype does; then the nearest free spot.
function freeAround(src, w, h, cards, groups) {
  const g = 40;
  const tries = [
    [src.x + src.w + g, src.y],
    [src.x, src.y + src.h + g],
    [src.x - w - g, src.y],
    [src.x, src.y - h - g],
    [src.x + src.w + g, src.y + src.h + g],
    [src.x + src.w + g, src.y - h - g],
    [src.x - w - g, src.y + src.h + g],
    [src.x - w - g, src.y - h - g],
  ];
  for (const [x, y] of tries) {
    const r = { x, y, w, h };
    if (!cards.some((c) => hits(r, c, GAP)) && !groups.some((gr) => hits(r, groupBox(gr), SIDE))) return r;
  }
  return freeOutside(w, h, cards, groups, centre(src));
}

function placeNear(view, source, w, h, { near } = {}) {
  const cards = live(view.cards);
  const groups = view.groups || [];
  if (!source) {
    const p = near || { x: 0, y: 0 };
    const r = freeOutside(w, h, cards, groups, p);
    return { x: r.x, y: r.y, moves: [] };
  }
  const group = groupOf(source, groups);
  if (!group) {
    const r = freeAround(source, w, h, cards, groups);
    return { x: r.x, y: r.y, moves: [] };
  }
  const spot = freeInside(group, w, h, cards, centre(source));
  if (spot) return { x: spot.x, y: spot.y, moves: [] };

  // The group is full: it grows at the bottom.
  const inside = cards.filter((c) => centreIn(c, group));
  const bottom = Math.max(group.y + TOP - GAP, ...inside.map((c) => c.y + c.h));
  const x = Math.min(Math.max(source.x, group.x + SIDE), group.x + group.w - w - SIDE);
  const y = bottom + GAP + 24;
  const oldBottom = group.y + group.h;
  const delta = Math.max(0, y + h + SIDE - oldBottom);
  const moves = [];
  if (delta > 0) {
    moves.push({ kind: "group", id: group.id, y: group.y, h: group.h + delta });
    // Everything that starts below the group moves down together, so the
    // space between them stays the same.
    for (const g of groups) if (g !== group && g.y - NAME >= oldBottom) moves.push({ kind: "group", id: g.id, y: g.y + delta });
    for (const c of cards) if (!c.pinned && c.y >= oldBottom && !centreIn(c, group)) moves.push({ kind: "card", id: c.id, y: c.y + delta });
  }
  return { x, y, moves };
}

// Applies moves from placeNear to a copy of the view (for tests and callers
// that keep their own copy).
function applyMoves(view, moves) {
  const byId = (list, id) => list.find((o) => o.id === id);
  const cards = (view.cards || []).map((c) => ({ ...c }));
  const groups = (view.groups || []).map((g) => ({ ...g }));
  for (const m of moves) {
    const o = byId(m.kind === "group" ? groups : cards, m.id);
    if (!o) continue;
    if (typeof m.y === "number") o.y = m.y;
    if (typeof m.h === "number") o.h = m.h;
  }
  return { ...view, cards, groups };
}

module.exports = { placeNear, applyMoves, groupOf, centreIn, hits, GAP, SIDE, TOP };
