// Canvas tools (B105, handoff spec 4; the handoff calls this 41-canvas-tools).
// Link with a label, Group with a name, Question, Note, moving cards and
// groups, shift-click to Mosaic; keys V H G L Q N; tools go back to Select.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path"), fs = require("fs"), os = require("os"), http = require("http");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "node-e2e-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(ok ? "✓" : "✗", name, detail ? `(${detail})` : "");
};
const server = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  res.end(`<title>Page ${req.url}</title><body><h1>Page ${req.url}</h1></body>`);
});

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const BASE = `http://127.0.0.1:${server.address().port}`;
  const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
  fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ firstRunDone: true }));
  fs.mkdirSync(path.join(userData, "sessions"));
  const t0 = Date.parse("2026-10-27T14:00:00Z");
  const pages = ["a", "b", "c"].map((n, i) => ({ url: `${BASE}/${n}`, title: `Page ${n}`, firstAt: t0 + i * 60000, lastAt: t0 + i * 60000 + 30000, visits: 2, keywords: [] }));
  fs.writeFileSync(path.join(userData, "sessions", "s-tools.json"), JSON.stringify({ id: "s-tools", name: "Tools", started: t0, updated: t0, pins: [], trail: pages, opened: [], dismissed: [] }));
  fs.writeFileSync(path.join(userData, "sessions", "current.txt"), "s-tools");
  const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")] });
  await app.evaluate(() => {
    const o = globalThis.fetch;
    globalThis.fetch = async (u, opt) => (/wikipedia|duckduckgo|brave\.com/.test(String(u)) ? new Response("{}", { status: 200 }) : o(u, opt));
  });
  const ui = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await ui.waitForSelector("#canvas:not([hidden]) .cv-card", { timeout: 8000 });
  await sleep(500);
  // 100% zoom, cards near the top left of the canvas.
  await ui.evaluate(() => trailCanvas.setView({ x: 40, y: 140, z: 1 }));
  await sleep(300);
  const snap = () => ui.evaluate(() => window.scout.trailGet());
  let t = await snap();
  const [A, B, C] = ["a", "b", "c"].map((n) => t.cards.find((c) => c.url === `${BASE}/${n}`));
  const centre = (id) => ui.evaluate((id) => {
    const r = document.querySelector(`#canvas .cv-card[data-id="${id}"]`).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, r: r.toJSON() };
  }, id);
  const tool = () => ui.evaluate(() => trailCanvas.tool);
  const key = async (k) => {
    await ui.evaluate(() => trailCanvas.vp.focus());
    await ui.keyboard.press(k);
    await sleep(150);
  };
  const dragTo = async (from, to, steps = 8) => {
    await ui.mouse.move(from.x, from.y);
    await ui.mouse.down();
    await ui.mouse.move(to.x, to.y, { steps });
    await ui.mouse.up();
    await sleep(700);
  };

  // Keys.
  const keys = [];
  for (const [k, name] of [["h", "hand"], ["g", "group"], ["l", "link"], ["q", "question"], ["n", "note"], ["v", "select"]]) {
    await key(k);
    keys.push((await tool()) === name);
  }
  check("keys V H G L Q N pick the tools", keys.every(Boolean), JSON.stringify(keys));
  await key("g");
  await key("Escape");
  check("Esc leaves a tool", (await tool()) === "select");

  // Link with a label.
  await key("l");
  await dragTo(await centre(A.id), await centre(B.id));
  t = await snap();
  const line = t.lines.find((l) => l.kind === "you" && l.from === A.id && l.to === B.id);
  check("Link: drag from card to card draws a line", Boolean(line));
  check("the label menu opens on the line", await ui.evaluate(() => [...document.querySelectorAll("#canvas .cv-menu .cv-menu-item")].map((b) => b.textContent).join("|")) === "Supports|Contradicts|Answers|Raises|No label|Remove link");
  check("the tool goes back to Select", (await tool()) === "select");
  await ui.click("#canvas .cv-menu .cv-menu-item:text-is('Supports')");
  await sleep(600);
  t = await snap();
  check("picking a label puts it on the line", t.lines.find((l) => l.id === line?.id)?.label === "supports");
  check("the line shows its label", (await ui.evaluate((id) => document.querySelector(`#canvas [data-line="${id}"]`)?.textContent, line?.id)) === "Supports");
  await ui.click(`#canvas [data-line="${line?.id}"]`);
  await sleep(300);
  check("clicking a drawn label opens the menu again", await ui.evaluate(() => Boolean(document.querySelector("#canvas .cv-menu"))));
  await ui.click("#canvas .cv-menu .cv-menu-item:text-is('Contradicts')");
  await sleep(600);
  check("and changes it", (await snap()).lines.find((l) => l.id === line?.id)?.label === "contradicts");

  // Group with a name.
  const a = await centre(A.id), b = await centre(B.id);
  await key("g");
  await dragTo({ x: Math.min(a.r.x, b.r.x) - 30, y: Math.min(a.r.y, b.r.y) - 30 }, { x: Math.max(a.r.x + a.r.width, b.r.x + b.r.width) + 30, y: Math.max(a.r.y + a.r.height, b.r.y + b.r.height) + 30 }, 12);
  t = await snap();
  const g = t.groups[0];
  const minX = Math.min(A.x, B.x), minY = Math.min(A.y, B.y), maxX = Math.max(A.x + A.w, B.x + B.w), maxY = Math.max(A.y + A.h, B.y + B.h);
  check("Group: drag a box; the group fits its cards (24 px sides and bottom, 48 px top)", g && g.x === minX - 24 && g.y === minY - 48 && g.x + g.w === maxX + 24 && g.y + g.h === maxY + 24, JSON.stringify(g));
  check("the name field opens", await ui.evaluate(() => document.activeElement?.classList.contains("cv-edit-name")));
  await ui.keyboard.type("Levain");
  await ui.keyboard.press("Enter");
  await sleep(600);
  t = await snap();
  check("Enter names it", t.groups[0]?.label === "Levain");
  check("the name shows above the group", (await ui.evaluate(() => document.querySelector("#canvas .cv-group-name")?.textContent)) === "Levain");
  // Rename by double-click; Esc keeps the name.
  await ui.dblclick("#canvas .cv-group-name");
  await sleep(200);
  await ui.keyboard.type("Other");
  await ui.keyboard.press("Escape");
  await sleep(400);
  check("double-click renames; Esc keeps the name it had", (await snap()).groups[0]?.label === "Levain");
  // Drag the name: the group and its cards move.
  const nm = await ui.evaluate(() => document.querySelector("#canvas .cv-group-name").getBoundingClientRect().toJSON());
  await dragTo({ x: nm.x + 10, y: nm.y + 8 }, { x: nm.x + 10, y: nm.y + 8 + 120 });
  t = await snap();
  const a2 = t.cards.find((c) => c.id === A.id);
  check("dragging the group's name moves the group with its cards", t.groups[0].y === g.y + 120 && a2.y === A.y + 120 && a2.pinned, JSON.stringify({ g: t.groups[0].y, a: a2.y }));

  // Move a card: it is pinned.
  const cc = await centre(C.id);
  await dragTo(cc, { x: cc.x + 60, y: cc.y + 300 });
  t = await snap();
  const c2 = t.cards.find((c) => c.id === C.id);
  check("dragging a card moves it and pins it", c2.y === C.y + 300 && c2.x === C.x + 60 && c2.pinned, JSON.stringify(c2 && [c2.x, c2.y]));

  // Question and Note.
  // An empty spot on the canvas, with room for a card.
  const emptySpot = () =>
    ui.evaluate(() => {
      const r = document.querySelector("#canvas .cv-vp").getBoundingClientRect();
      for (let y = r.y + 90; y < r.bottom - 300; y += 20)
        for (let x = r.x + 20; x < r.right - 300; x += 20) {
          const free = [[0, 0], [260, 0], [0, 180], [260, 180]].every(([dx, dy]) => {
            const el = document.elementFromPoint(x + dx, y + dy);
            return el && el.closest(".cv-vp") && !el.closest(".cv-card, .cv-group, .cv-top, .cv-key, .cv-corner, .cv-tools, button");
          });
          if (free) return { x, y };
        }
      return null;
    });
  let spot = await emptySpot();
  await key("q");
  await ui.mouse.click(spot.x, spot.y);
  await sleep(300);
  await ui.keyboard.type("Does hydration matter in winter?");
  await ui.keyboard.press("Enter");
  await sleep(800);
  t = await snap();
  const q = t.cards.find((c) => c.kind === "question");
  check("Question: click, type, Enter adds a question card", q?.title === "Does hydration matter in winter?");
  check("it is a thread too", (await ui.evaluate(() => window.scout.researchGet())).threadList.some((th) => th.id === q?.id));
  check("the tool goes back to Select", (await tool()) === "select");
  spot = await emptySpot();
  await key("n");
  await ui.mouse.click(spot.x, spot.y);
  await sleep(300);
  await ui.keyboard.type("Throw away");
  await ui.keyboard.press("Escape");
  await sleep(500);
  check("Esc cancels", !(await snap()).cards.some((c) => c.kind === "note"));
  spot = await emptySpot();
  await key("n");
  await ui.mouse.click(spot.x, spot.y);
  await sleep(300);
  await ui.keyboard.press("Enter");
  await sleep(500);
  check("an empty one is not kept", !(await snap()).cards.some((c) => c.kind === "note"));
  spot = await emptySpot();
  await key("n");
  await ui.mouse.click(spot.x, spot.y);
  await sleep(300);
  await ui.keyboard.type("Feed it twice a day in summer.");
  await ui.keyboard.press("Enter");
  await sleep(800);
  check("Note: click, type, Enter adds a note card", (await snap()).cards.some((c) => c.kind === "note" && c.text === "Feed it twice a day in summer."));

  // Events with their own times.
  const ev = fs.readFileSync(path.join(userData, "trails", "s-tools", "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const types = new Set(ev.map((e) => e.type));
  check("link, group, rename and move are events with their own times", ["linked", "grouped", "renamed", "moved", "asked", "noted"].every((x) => types.has(x)), [...types].join());

  // Remove link.
  await ui.click(`#canvas [data-line="${line?.id}"]`);
  await sleep(300);
  await ui.click("#canvas .cv-menu .cv-menu-item:text-is('Remove link')");
  await sleep(600);
  check("Remove link removes it", !(await snap()).lines.some((l) => l.id === line?.id));

  // Shift-click: several selected, View in Mosaic.
  await ui.click(`#canvas .cv-card[data-id="${A.id}"]`);
  await ui.click(`#canvas .cv-card[data-id="${B.id}"]`, { modifiers: ["Shift"] });
  await sleep(300);
  check("shift-click selects several: 2 selected, View in Mosaic", await ui.evaluate(() => !document.querySelector("#canvas .cv-multibar").hidden && /2 selected/.test(document.querySelector("#canvas .cv-multibar").textContent)));
  await ui.click("#canvas .cv-multibar button");
  await sleep(2500);
  const mos = await ui.evaluate(() => ({ layout, tiles: tabs.filter((x) => x.tile).map((x) => x.url) }));
  check("View in Mosaic shows those pages as tiles", mos.layout === "mosaic" && mos.tiles.length === 2 && mos.tiles.every((u) => /\/a$|\/b$/.test(u)), JSON.stringify(mos));

  await app.close();
  server.close();
  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
