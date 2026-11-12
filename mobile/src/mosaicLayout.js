// Mosaic layouts on the phone: where each tile goes. No React Native imports
// (tested in Node: mobile/test/mosaic-layout.test.js).
//
// Rects are percentages of the Mosaic area: { left, top, width, height }.

const LAYOUTS = [
  { id: "auto", label: "Auto", help: "Stacked for 2–3 tabs, 2 by 2 for 4. Tablets and landscape: a grid of every tab" },
  { id: "stack", label: "Stack", help: "One column, tiles on top of each other" },
  { id: "side", label: "Side by side", help: "One row, tiles next to each other. Best with the phone turned sideways" },
  { id: "grid", label: "Grid", help: "Two columns" },
  { id: "focus", label: "Focus", help: "The active tab large on top, the others in a row below" },
];
const IDS = LAYOUTS.map((l) => l.id);
const isLayout = (id) => IDS.includes(id);

// Rows and columns for an even grid of n tiles.
function gridRects(n, cols) {
  const rows = Math.ceil(n / cols) || 1;
  return Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / cols);
    // The last row spreads its tiles across the full width.
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const col = i - row * cols;
    return { left: (col * 100) / inRow, top: (row * 100) / rows, width: 100 / inRow, height: 100 / rows };
  });
}

// n tiles, the active tile's index, wide = tablet or landscape.
function layoutRects(layout, n, { active = 0, wide = false } = {}) {
  if (n <= 0) return [];
  if (n === 1) return [{ left: 0, top: 0, width: 100, height: 100 }];
  switch (isLayout(layout) ? layout : "auto") {
    case "stack":
      return gridRects(n, 1);
    case "side":
      return gridRects(n, n);
    case "grid":
      return gridRects(n, 2);
    case "focus": {
      const others = n - 1;
      const BIG = 66;
      let k = 0;
      return Array.from({ length: n }, (_, i) => {
        if (i === active) return { left: 0, top: 0, width: 100, height: BIG };
        const r = { left: (k * 100) / others, top: BIG, width: 100 / others, height: 100 - BIG };
        k++;
        return r;
      });
    }
    default:
      // The layout NODE has always used.
      return wide ? gridRects(n, Math.ceil(Math.sqrt(n))) : gridRects(n, n <= 3 ? 1 : 2);
  }
}

module.exports = { LAYOUTS, layoutRects, isLayout };
