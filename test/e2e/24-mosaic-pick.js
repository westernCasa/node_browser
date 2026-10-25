// Mosaic tile choice (B69): at most 4 tiles by default, tabs chosen for
// Mosaic, leaving Mosaic for a tab without a tile, the Settings choice, and
// chosen tiles kept across a restart.
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
  await sleep(1500);
  return { app, ui };
}
// Page views on screen: their addresses (?n=), in stacking order.
const tiles = (app) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].contentView.children
      .filter((v) => v.webContents && /127\.0\.0\.1:8765\/other\.html/.test(v.webContents.getURL()))
      .map((v) => ({ n: new URL(v.webContents.getURL()).searchParams.get("n"), w: v.getBounds().width }))
      .filter((v) => v.w > 0)
      .map((v) => v.n)
      .sort());
const pressed = (ui) => ui.getAttribute("#layout-btn", "aria-pressed");

(async () => {
  let { app, ui } = await launch();
  await ui.fill("#omni", `${BASE}/other.html?n=1`);
  await ui.press("#omni", "Enter");
  await sleep(1500);
  for (let i = 2; i <= 6; i++) await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/other.html?n=${i}`);
  await sleep(2500);
  const ids = await ui.$$eval("#tabs .tab", (els) => els.length);
  check("six tabs open", ids === 6, String(ids));

  await ui.click("#layout-btn");
  await sleep(1500);
  let t = await tiles(app);
  check("Mosaic shows at most 4 tiles by default", t.length === 4, t.join(","));
  check("the active tab keeps a tile", t.includes("6"), t.join(","));
  check("tooltip says tile your tabs", /tile your tabs|back to one tab/i.test(await ui.getAttribute("#layout-btn", "title")));

  // Choose tabs 2 and 4 for Mosaic.
  // Tab ids, from the renderer's tab list.
  const state = await ui.evaluate(() => (typeof tabs !== "undefined" ? tabs.map((x) => ({ id: x.id, url: x.url })) : null));
  const idOf = (n) => state.find((x) => x.url.endsWith(`n=${n}`)).id;
  check("setTabTile chooses a tab", (await ui.evaluate((id) => window.scout.setTabTile(id, true), idOf(2))) === true);
  await ui.evaluate((id) => window.scout.setTabTile(id, true), idOf(4));
  await sleep(1200);
  t = await tiles(app);
  check("with tabs chosen, Mosaic shows only those", t.join(",") === "2,4", t.join(","));
  check("the active tab moves to a chosen tile", ["2", "4"].includes(await ui.evaluate(() => tabs.find((x) => x.id === activeId)?.url.split("n=")[1])));
  const marks = await ui.$$eval("#tabs .tab .tile-mark", (els) => els.length);
  check("chosen tabs are marked in the tab strip", marks === 2, String(marks));

  // A tab without a tile, picked in the tab strip: Focus on it.
  await ui.evaluate((id) => window.scout.activateTab(id), idOf(5));
  await sleep(1200);
  t = await tiles(app);
  check("opening a tab without a tile leaves Mosaic", t.join(",") === "5" && (await pressed(ui)) === "false", `${t.join(",")} pressed=${await pressed(ui)}`);
  await ui.click("#layout-btn");
  await sleep(1200);
  t = await tiles(app);
  check("back into Mosaic shows the chosen tiles again", t.join(",") === "2,4" && (await pressed(ui)) === "true", t.join(","));

  // Mosaic is full at 4 chosen tabs.
  for (const n of [1, 3]) await ui.evaluate((id) => window.scout.setTabTile(id, true), idOf(n));
  const fifth = await ui.evaluate((id) => window.scout.setTabTile(id, true), idOf(6));
  await sleep(500);
  const notice = await ui.evaluate(() => document.getElementById("notice").textContent);
  check("a fifth chosen tab is refused, with a reason", fifth === false && /holds 4 tabs/.test(notice), notice.slice(0, 70));
  check("the tab menu opens without errors", (await ui.evaluate((id) => window.scout.tabMenu(id, 40, 40).then(() => true, () => false), idOf(6))) === true);
  await ui.keyboard.press("Escape");

  // Settings: every tab, then take every choice back.
  await ui.evaluate(() => window.scout.setSettings({ mosaicMax: 0 }));
  for (const n of [1, 2, 3, 4]) await ui.evaluate((id) => window.scout.setTabTile(id, false), idOf(n));
  await sleep(1200);
  t = await tiles(app);
  check("Every tab: all 6 tiles when none are chosen", t.length === 6, t.join(","));
  await ui.evaluate(() => window.scout.setSettings({ mosaicMax: 9 }));
  check("the setting is saved", (await ui.evaluate(() => window.scout.getSettings())).mosaicMax === 9);
  await ui.evaluate(() => window.scout.setSettings({ mosaicMax: 7 }));
  check("other numbers are ignored", (await ui.evaluate(() => window.scout.getSettings())).mosaicMax === 9);
  await ui.evaluate(() => window.scout.setSettings({ mosaicMax: 4 }));

  // Tab overview (B71): zoom out, pick tabs like photos, Done.
  await ui.evaluate(() => openOverview());
  await sleep(1200);
  check("the overview opens with a card per tab", (await ui.$$eval("#ov-grid .ov-card", (els) => els.length)) === 6);
  check("the pages are hidden under the overview", (await tiles(app)).length === 0);
  check("cards have pictures of the pages", (await ui.$$eval("#ov-grid .ov-card img", (els) => els.filter((i) => i.src.startsWith("data:image/jpeg")).length)) >= 5);
  check("the current tab has focus", await ui.evaluate(() => document.activeElement?.classList.contains("ov-card")));
  for (const n of [5, 6, 2]) await ui.click(`.ov-card[data-id="${idOf(n)}"]`);
  await sleep(300);
  check("picked cards are marked selected", (await ui.$$eval('.ov-card[aria-selected="true"]', (els) => els.length)) === 3);
  check("the count says 3 of 4", /3 of 4/.test(await ui.textContent("#ov-count")), await ui.textContent("#ov-count"));
  await ui.click(`.ov-card[data-id="${idOf(6)}"]`);
  check("clicking again unpicks", (await ui.$$eval('.ov-card[aria-selected="true"]', (els) => els.length)) === 2);
  await ui.keyboard.press("Escape");
  await sleep(800);
  check("Esc closes it and changes nothing", !(await ui.isVisible("#overview")) && (await ui.evaluate(() => tabs.filter((x) => x.tile).length)) === 0);
  await ui.evaluate(() => openOverview());
  await sleep(1000);
  for (const n of [1, 2, 3, 4]) await ui.click(`.ov-card[data-id="${idOf(n)}"]`);
  await ui.click(`.ov-card[data-id="${idOf(5)}"]`, { force: true });
  check("a fifth pick is refused", (await ui.$$eval('.ov-card[aria-selected="true"]', (els) => els.length)) === 4 && /holds 4/.test(await ui.textContent("#ov-count")));
  check("cards that can't be picked are dimmed", (await ui.$$eval(".ov-card.blocked", (els) => els.length)) === 2);
  // Keyboard: focus the first card, unpick it with Space, finish with Enter.
  await ui.focus(`.ov-card[data-id="${idOf(1)}"]`);
  await ui.keyboard.press("Space");
  await ui.keyboard.press("ArrowRight");
  check("arrow keys move between cards", await ui.evaluate((id) => document.activeElement?.dataset.id === id, idOf(2)));
  await ui.keyboard.press("Enter");
  await sleep(1500);
  t = await tiles(app);
  check("Done shows the picked tabs in Mosaic", t.join(",") === "2,3,4" && (await pressed(ui)) === "true", t.join(","));
  check("Done saves the picks as Mosaic tiles", (await ui.evaluate(() => tabs.filter((x) => x.tile).map((x) => x.url.split("n=")[1]).join(","))) === "2,3,4");
  await ui.evaluate(() => openOverview());
  await sleep(1000);
  await ui.click("#ov-clear");
  await ui.click("#ov-done");
  await sleep(1500);
  t = await tiles(app);
  check("Clear and Done: Mosaic shows its usual 4 tiles", t.length === 4 && (await ui.evaluate(() => tabs.filter((x) => x.tile).length)) === 0, t.join(","));

  // Chosen tiles survive a restart.
  await ui.evaluate((id) => window.scout.setTabTile(id, true), idOf(3));
  await sleep(1500);
  await app.evaluate(({ app }) => app.quit());
  await sleep(1500);
  ({ app, ui } = await launch());
  await sleep(1500);
  const after = await ui.evaluate(() => tabs.filter((x) => x.tile).map((x) => x.url.split("n=")[1]));
  check("chosen tiles are kept after a restart", after.join(",") === "3", after.join(","));
  await app.evaluate(({ app }) => app.quit());

  console.log(failed ? `${failed} checks failed` : "all checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
