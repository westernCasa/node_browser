// The zoom ladder and the Gallery (B107, handoff spec 8; the handoff calls
// this 43-mosaic-gallery). Pinch in (fingers together) climbs page → Mosaic →
// Gallery → canvas, one level per gesture; pinch out goes back down. The
// Gallery: the trail's tabs 4 across, starts with the Mosaic's tabs chosen,
// View in Mosaic, double-click opens a page, ✕ closes a tab. The Mosaic tool
// with nothing chosen opens the Gallery; a group's "Mosaic · n" button; the
// 4-playing limit still holds; the sidebar slides out over pages and back.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path"), fs = require("fs"), os = require("os");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "node-e2e-"));
const BASE = "http://127.0.0.1:8765";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(ok ? "✓" : "✗", name, detail ? `(${detail})` : "");
};
const inPage = (app, match, code) =>
  app.evaluate(({ webContents }, [m, c]) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes(m));
    return wc ? wc.executeJavaScript(c, true) : "no page";
  }, [match, code]);
// A trackpad pinch: ctrl + wheel in small steps. "in" = fingers together (zoom out).
const pinchPage = (app, match, dir, steps = 14) =>
  inPage(app, match, `(async () => { for (let i = 0; i < ${steps}; i++) { window.dispatchEvent(new WheelEvent("wheel", { ctrlKey: true, deltaY: ${dir === "in" ? 3.5 : -3.5}, cancelable: true })); await new Promise((r) => setTimeout(r, 16)); } return true; })()`);
const pinchGallery = (ui, dir, steps = 14) =>
  ui.evaluate(async ([d, n]) => {
    const el = document.getElementById("overview");
    for (let i = 0; i < n; i++) {
      el.dispatchEvent(new WheelEvent("wheel", { ctrlKey: true, deltaY: d === "in" ? 3.5 : -3.5, cancelable: true, bubbles: true }));
      await new Promise((r) => setTimeout(r, 16));
    }
  }, [dir, steps]);
const level = (ui) => ui.evaluate(() => (!document.getElementById("canvas").hidden ? "canvas" : ovOpen ? "gallery" : layout === "mosaic" ? "mosaic" : "page"));
const menu = (app, label) =>
  app.evaluate(({ Menu, BrowserWindow }, l) => {
    const find = (items) => { for (const it of items) { if (it.label === l) return it; if (it.submenu) { const f = find(it.submenu.items); if (f) return f; } } return null; };
    find(Menu.getApplicationMenu().items).click(undefined, BrowserWindow.getAllWindows()[0]);
  }, label);
const pageViews = (app) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter((v) => v.webContents && !/chrome-overlay\.html/.test(v.webContents.getURL())).map((v) => v.getBounds()).filter((b) => b.width > 0));

(async () => {
  const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
  fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ firstRunDone: true }));
  const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")] });
  await app.evaluate(() => {
    const o = globalThis.fetch;
    globalThis.fetch = async (u, opt) => (/wikipedia|duckduckgo|brave\.com/.test(String(u)) ? new Response("{}", { status: 200 }) : o(u, opt));
  });
  const ui = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await sleep(1500);
  for (let n = 1; n <= 5; n++) {
    await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/other.html?n=${n}`);
    await sleep(500);
  }
  await ui.evaluate(() => window.scout.activateTab(tabs[0].id));
  await sleep(1500);

  // The Mosaic tool with nothing chosen opens the Gallery.
  await ui.click("#layout-btn");
  await sleep(900);
  check("the Mosaic tool with nothing chosen opens the Gallery", (await level(ui)) === "gallery" && (await ui.textContent("#ov-title")) === "Gallery");
  check("the Gallery shows the trail's tabs, 4 across", await ui.evaluate(() => {
    const cards = [...document.querySelectorAll("#ov-grid .ov-card")];
    return cards.length === 5 && cards.filter((c) => c.offsetTop === cards[0].offsetTop).length === 4;
  }));
  await ui.click("#ov-grid .ov-card:nth-child(2)");
  await ui.click("#ov-grid .ov-card:nth-child(3)");
  check("click chooses: \"2 chosen\", View in Mosaic", (await ui.textContent("#ov-count")) === "2 chosen" && (await ui.textContent("#ov-done")) === "View in Mosaic");
  await ui.click("#ov-done");
  await sleep(1200);
  check("View in Mosaic shows the chosen tabs as tiles", (await level(ui)) === "mosaic" && (await pageViews(app)).length === 2);
  check("Mosaic fills the window; the sidebar is out of the way", Math.min(...(await pageViews(app)).map((b) => b.x)) < 20);

  // The ladder by pinch: Mosaic → Gallery (Mosaic's tabs chosen) → canvas.
  await pinchPage(app, "n=2", "in");
  await sleep(1000);
  check("pinch in in Mosaic opens the Gallery", (await level(ui)) === "gallery");
  check("the Gallery starts with the Mosaic's tabs chosen", (await ui.textContent("#ov-count")) === "2 chosen");
  await sleep(500);
  await pinchGallery(ui, "in");
  await sleep(1200);
  check("pinch in in the Gallery goes on to the canvas", (await level(ui)) === "canvas");
  // And back down: ⌘2 for the first page; pinch in on the page → Mosaic.
  await menu(app, "Tab 2");
  await sleep(800);
  check("⌘2 leaves the canvas for the first page tab (not a tile, so on its own)", (await level(ui)) === "page");
  await pinchPage(app, "n=1", "in");
  await sleep(1000);
  check("pinch in on a page at 100% goes to Mosaic", (await level(ui)) === "mosaic");
  // One level per gesture: a long pinch does not skip Gallery.
  await pinchPage(app, "n=2", "in", 60);
  await sleep(1000);
  check("one level per gesture: a long pinch stops at the Gallery", (await level(ui)) === "gallery");
  await sleep(500);
  await pinchGallery(ui, "out");
  await sleep(1200);
  check("pinch out in the Gallery goes back to Mosaic", (await level(ui)) === "mosaic");
  await sleep(500);
  await pinchPage(app, "n=2", "out");
  await sleep(1000);
  check("pinch out on a tile goes back to that page", (await level(ui)) === "page" && /n=2/.test(await ui.evaluate(() => tabs.find((t) => t.id === activeId)?.url)));
  // Keys: ⇧⌘M toggles Mosaic.
  await menu(app, "Toggle Mosaic");
  await sleep(900);
  check("⇧⌘M: Mosaic", (await level(ui)) === "mosaic");
  await menu(app, "Toggle Mosaic");
  await sleep(900);
  check("⇧⌘M again: the page", (await level(ui)) === "page");

  // Gallery: double-click opens a page; ✕ closes a tab.
  await menu(app, "Choose Tabs for Mosaic…");
  await sleep(900);
  await ui.dblclick("#ov-grid .ov-card:nth-child(4)");
  await sleep(1200);
  check("double-click in the Gallery opens that page", (await level(ui)) === "page" && /n=4/.test(await ui.evaluate(() => tabs.find((t) => t.id === activeId)?.url)));
  await menu(app, "Choose Tabs for Mosaic…");
  await sleep(900);
  const before = await ui.evaluate(() => tabs.length);
  await ui.hover("#ov-grid .ov-card:nth-child(5)");
  await ui.click("#ov-grid .ov-card:nth-child(5) .ov-x");
  await sleep(800);
  check("✕ in the Gallery closes the tab", (await ui.evaluate(() => tabs.length)) === before - 1 && (await ui.$$eval("#ov-grid .ov-card", (c) => c.length)) === before - 1);
  await ui.keyboard.press("Escape");
  await sleep(600);

  // The 4-playing limit still holds in Mosaic.
  for (let n = 1; n <= 5; n++) {
    await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/media.html?v=${n}`);
    await sleep(700);
  }
  await sleep(2500);
  const playing = await app.evaluate(({ webContents }) => Promise.all(webContents.getAllWebContents().filter((w) => /media\.html/.test(w.getURL())).map((w) => w.executeJavaScript(`[...document.querySelectorAll("video,audio")].some((m) => !m.paused)`).catch(() => false))));
  check("no more than 4 pages play at once", playing.filter(Boolean).length <= 4, JSON.stringify(playing));

  // A group's "Mosaic · n" button.
  await ui.evaluate(() => window.scout.canvasShow());
  await sleep(1000);
  for (const n of [1, 2]) await ui.evaluate((u) => window.scout.trailPlace({ url: u }), `${BASE}/other.html?n=${n}`);
  const snap = await ui.evaluate(() => window.scout.trailGet());
  const pageCards = snap.cards.filter((c) => c.kind === "page");
  if (pageCards.length >= 2) {
    const [a, b] = pageCards;
    await ui.evaluate(([a, b]) => window.scout.trailGroup({ x: Math.min(a.x, b.x) - 10, y: Math.min(a.y, b.y) - 10, w: Math.abs(a.x - b.x) + 280, h: Math.abs(a.y - b.y) + 220 }), [a, b]);
    await ui.evaluate(() => window.scout.canvasShow());
    await sleep(800);
    await ui.evaluate(() => refreshCanvasData());
    await sleep(800);
    const btn = await ui.evaluate(() => document.querySelector("#canvas .cv-group-mosaic")?.textContent);
    check("a group with pages has a Mosaic · n button", /^Mosaic · \d+$/.test(btn || ""), btn);
    await ui.click("#canvas .cv-group-mosaic");
    await sleep(1500);
    check("which shows its pages in Mosaic", (await level(ui)) === "mosaic");
  } else console.log("  (no page cards yet: group button not checked)");

  await app.close();
  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
