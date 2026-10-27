// Sidebar layout (docs/18-sidebar-chrome.md): another view of the same
// chrome. The real controls move into a left column; the page sits in a frame
// right of it; full, rail and hidden widths; trails and media in the sidebar;
// the top bar comes back unchanged.
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
const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ firstRunDone: true }));

async function launch() {
  const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")] });
  await app.evaluate(() => {
    const o = globalThis.fetch;
    globalThis.fetch = async (u, opt) => (/wikipedia|duckduckgo|brave\.com/.test(String(u)) ? new Response("{}", { status: 200 }) : o(u, opt));
  });
  const ui = await app.firstWindow();
  await sleep(1800);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await sleep(400);
  return { app, ui };
}
const view = (app) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter((v) => v.webContents && !/chrome-overlay\.html/.test(v.webContents.getURL())).map((v) => v.getBounds()).find((b) => b.width > 0));
const menuClick = (app, id) => app.evaluate(({ Menu }, i) => Menu.getApplicationMenu().getMenuItemById(i).click(), id);
const inSidebar = (ui, sel) => ui.evaluate((s) => Boolean(document.querySelector(`#sidebar ${s}`)), sel);

(async () => {
  let { app, ui } = await launch();
  for (const u of ["article.html", "other.html?n=1", "other.html?n=2"]) await ui.evaluate((x) => window.scout.createTab(x), `${BASE}/${u}`);
  await sleep(2000);

  check("Top bar is the default", (await ui.evaluate(() => window.scout.getSettings())).chromeLayout === "top" && !(await ui.evaluate(() => document.body.classList.contains("side"))));
  const topView = await view(app);
  check("top bar: page under the toolbar", topView.x === 0 && topView.y === 96, JSON.stringify(topView));

  // Switch in Settings.
  await ui.evaluate(() => openMenu("settings"));
  await sleep(600);
  await ui.selectOption("#chrome-layout", "side");
  await sleep(300);
  await ui.keyboard.press("Escape");
  await sleep(900);
  check("Settings switches to the sidebar", await ui.evaluate(() => document.body.classList.contains("side")));
  check("the setting is saved", (await ui.evaluate(() => window.scout.getSettings())).chromeLayout === "side");
  check("the address bar, tabs and tools move into the sidebar", (await inSidebar(ui, "#omni")) && (await inSidebar(ui, "#tabs")) && (await inSidebar(ui, ".sb-tools #layout-btn")) && (await inSidebar(ui, "#back")));
  check("8 tool tiles", (await ui.$$eval(".sb-tools .tb", (b) => b.filter((x) => x.offsetParent).length)) === 8);
  check("the top bar is hidden", await ui.$eval("header.chrome", (h) => getComputedStyle(h).display === "none"));
  let v = await view(app);
  const frame = await ui.$eval("#page-frame", (f) => f.getBoundingClientRect().toJSON());
  check("the page sits inside the frame right of the sidebar", v.x === Math.round(frame.x) + 1 && v.y === Math.round(frame.y) + 1 && v.x === 273 && v.width === Math.round(frame.width) - 2, `${JSON.stringify(v)} frame ${JSON.stringify(frame)}`);
  check("View → Use Sidebar Layout is ticked", await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById("sidebar-layout").checked));

  // Tabs in the sidebar work.
  const rows = await ui.$$eval("#sidebar .tab", (t) => t.length);
  check("tabs listed in the sidebar", rows >= 3, String(rows));
  await ui.click("#sidebar .tab:nth-child(2)");
  await sleep(600);
  check("clicking a tab row opens it", await ui.$eval("#sidebar .tab:nth-child(2)", (t) => t.classList.contains("active")));
  await ui.click("#sidebar #new-tab");
  await sleep(800);
  await ui.press("#cmd-input", "Enter"); // New tab opens the CommandBar; Enter with nothing typed: a blank tab
  await sleep(900);
  check("New tab adds a row", (await ui.$$eval("#sidebar .tab", (t) => t.length)) === rows + 1);
  check("a tab shows its monogram", /^[A-Z·]{1,2}$/.test(await ui.$eval("#sidebar .tab .mono", (m) => m.textContent)));

  // Hidden and rail.
  await menuClick(app, "sidebar-toggle");
  await sleep(600);
  v = await view(app);
  check("⌘S hides the sidebar: a 52px column stays", (await ui.evaluate(() => document.getElementById("sidebar").hidden)) && v.x === 53, JSON.stringify(v));
  check("the show button is there", await ui.$eval("#sb-show", (b) => b.offsetParent !== null));
  await menuClick(app, "sidebar-toggle");
  await sleep(600);
  check("⌘S again: back to full", (await view(app)).x === 273);
  await menuClick(app, "sidebar-rail");
  await sleep(600);
  v = await view(app);
  check("compact rail: 68px", v.x === 69, JSON.stringify(v));
  check("the rail shows 5 tools", (await ui.$$eval(".sb-tools .tb", (b) => b.filter((x) => x.offsetParent).length)) === 5);
  check("the rail hides tab titles", await ui.$eval("#sidebar .tab > span:not(.mono)", (s) => getComputedStyle(s).display === "none"));
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.flatMap((m) => m.submenu?.items || []).find((i) => i.label === "Open Location").click());
  await sleep(700);
  check("⌘L in the rail opens the CommandBar", (await ui.evaluate(() => cmdOpen)) && (await ui.evaluate(() => document.activeElement?.id)) === "cmd-input");
  await ui.keyboard.press("Escape");
  await sleep(500);
  await menuClick(app, "sidebar-rail");
  await sleep(600);

  // Trails and media.
  await ui.evaluate(() => window.scout.researchNew("Second trail"));
  await ui.evaluate(() => refreshSideTrails(true));
  await sleep(500);
  const trailRows = await ui.$$eval("#sb-trail-list .sb-trail-row:not(.add)", (r) => r.map((x) => x.textContent));
  check("active trails list the sessions", trailRows.length === 2 && trailRows.some((t) => t.includes("Second trail")), trailRows.join(" | "));
  await ui.click('#sb-trail-list .sb-trail-row[aria-current="false"]');
  await sleep(700);
  check("clicking a trail switches to it", (await ui.evaluate(() => window.scout.researchGet())).name !== "Second trail");
  check("the trail header shows the current trail", (await ui.$eval("#sb-trail-name", (n) => n.textContent)) === (await ui.evaluate(() => window.scout.researchGet())).name);
  await ui.click("#sb-trails-toggle");
  await sleep(300);
  check("the trails section folds", (await ui.$eval("#sb-trails-toggle", (b) => b.getAttribute("aria-expanded"))) === "false" && (await ui.$eval("#sb-trail-list", (l) => l.hidden)));
  check("media strip shows the sound mode", (await ui.$eval("#sb-sound", (s) => s.textContent)) === "SOUND: ONE");
  await ui.click("#sidebar #sound-btn");
  await sleep(500);
  check("Sound: all turns the tile and the strip violet", (await ui.$eval("#sb-sound", (s) => s.textContent)) === "SOUND: ALL" && (await ui.$eval("#sidebar #sound-btn", (b) => getComputedStyle(b).borderColor)) === "rgb(177, 140, 255)");
  await ui.click("#sidebar #sound-btn");

  // Full screen keeps the sidebar; no sliding toolbar.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit("enter-full-screen"));
  await sleep(600);
  check("full screen keeps the sidebar and the page in place", (await view(app)).x === 273 && !(await ui.evaluate(() => document.body.classList.contains("immersive"))));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit("leave-full-screen"));
  await sleep(300);

  // Kept across a restart.
  await app.close();
  ({ app, ui } = await launch());
  await sleep(800);
  check("the sidebar layout is kept after a restart", (await ui.evaluate(() => document.body.classList.contains("side"))) && (await view(app))?.x === 273);

  // Back to the top bar from the View menu.
  await menuClick(app, "sidebar-layout");
  await sleep(900);
  v = await view(app);
  check("View → Use Sidebar Layout off: the top bar comes back", !(await ui.evaluate(() => document.body.classList.contains("side"))) && v.x === 0 && v.y === 96, JSON.stringify(v));
  check("every control is back in the top bar", await ui.evaluate(() => ["omni", "tabs", "back", "layout-btn", "menu-btn", "new-tab"].every((id) => document.querySelector(`header.chrome #${id}`))));
  check("the sidebar-only tiles are hidden in the top bar", await ui.evaluate(() => document.getElementById("sb-history-btn").hidden && document.getElementById("sb-downloads-btn").hidden));
  check("the setting is saved as top", (await ui.evaluate(() => window.scout.getSettings())).chromeLayout === "top");

  await app.close();
  if (failed) console.log(`::error::33-sidebar-chrome: ${failed} check(s) failed`);
  console.log(failed ? `${failed} checks failed` : "all checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
