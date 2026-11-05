// The sidebar (B103, handoff spec 2), NODE's only chrome since the trail
// canvas. No top bar and no layout switch. Top to bottom: trail switcher,
// address bar, tabs (the canvas first), timeline, tool grid (4 × 2). On the
// canvas it always shows; pages, Mosaic and private tabs fill the window and
// the sidebar comes over them in its own layer. Private tabs: no trail, no
// history.
// Since B107 the Mosaic tool opens the Gallery when no tabs are chosen; View in Mosaic with none chosen shows the usual tabs.
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
fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ firstRunDone: true, chromeLayout: "top" }));

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
// Page views on screen (not the sidebar layer).
const views = (app) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter((v) => v.webContents && !/chrome-overlay\.html/.test(v.webContents.getURL())).map((v) => v.getBounds()).filter((b) => b.width > 0));
const layer = (app) =>
  app.evaluate(({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children.find((x) => x.webContents && /chrome-overlay\.html/.test(x.webContents.getURL()));
    return v ? v.getBounds() : null;
  });
const layerShown = (app) =>
  app.evaluate(async ({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children.find((x) => x.webContents && /chrome-overlay\.html/.test(x.webContents.getURL()));
    return v ? v.webContents.executeJavaScript(`({ shown: document.body.classList.contains("shown"), tabs: document.querySelectorAll("#bar .tab").length, address: Boolean(document.querySelector("#bar #omni")) })`) : null;
  });
const menuLabel = (app, label) => app.evaluate(({ Menu }, l) => Menu.getApplicationMenu().items.flatMap((m) => m.submenu?.items || []).find((i) => i.label === l).click(), label);
const inSidebar = (ui, sel) => ui.evaluate((s) => Boolean(document.querySelector(`#sidebar ${s}`)), sel);

(async () => {
  let { app, ui } = await launch();

  // Sidebar only.
  check("the sidebar is the only layout (an old top-bar setting is ignored)", (await ui.evaluate(() => document.body.classList.contains("side") && !document.getElementById("sidebar").hidden)) && (await ui.evaluate(() => window.scout.getSettings())).chromeLayout === "side");
  check("no top bar", await ui.$eval("header.chrome", (h) => getComputedStyle(h).display === "none"));
  check("no layout switch in Settings or the View menu", !(await ui.$("#chrome-layout")) && !(await app.evaluate(({ Menu }) => Boolean(Menu.getApplicationMenu().getMenuItemById("sidebar-layout")))));
  // In document order (the timeline is hidden until the trail has pages).
  const order = await ui.evaluate(() => {
    const els = ["#sb-switcher", "#sidebar #omni", "#canvas-tab", "#sb-timeline", ".sb-tools"].map((q) => document.querySelector(q));
    return els.every((el, i) => i === 0 || els[i - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  check("order: switcher, address bar, tabs, timeline, tool grid", order);
  check("Back, Forward and Reload sit on the address bar's row", (await inSidebar(ui, ".sb-addr-row #back")) && (await inSidebar(ui, ".sb-addr-row #reload")));
  const tiles = await ui.$$eval(".sb-tools .tb", (b) => b.filter((x) => x.offsetParent).map((x) => x.dataset.label));
  check("tool grid 4 × 2: Mosaic, Capture, Suggest, Sound, Private, Open, History, Menu", tiles.join() === "Mosaic,Capture,Suggest,Sound,Private,Open,History,Menu", tiles.join());
  const tile = await ui.$eval("#layout-btn", (b) => b.getBoundingClientRect().height);
  const side = await ui.$eval("#sidebar", (s) => s.getBoundingClientRect().width);
  check("sidebar 300 px, tool tiles 52 px", side === 300 && tile === 52, `${side} ${tile}`);
  check("agent, downloads and full screen moved to the Menu", await ui.evaluate(() => ["agent-btn", "agent-share-btn", "dl-btn", "fullscreen-btn"].every((id) => document.querySelector(`#menu-overlay #${id}`))));
  check("on the canvas the sidebar shows and no layer is needed", (await ui.evaluate(() => !document.getElementById("canvas").hidden)) && !(await layer(app)));

  // A page fills the window; the sidebar comes over it.
  for (const u of ["article.html", "other.html?n=1", "other.html?n=2"]) await ui.evaluate((x) => window.scout.createTab(x), `${BASE}/${u}`);
  await sleep(2000);
  let v = await views(app);
  check("a page fills the window (left of the suggestions widget)", v.length === 1 && v[0].x === 0 && v[0].y === 0 && v[0].height === 900, JSON.stringify(v));
  check("the sidebar is out of the way over a page", !(await layer(app)));
  await menuLabel(app, "Show Sidebar");
  await sleep(600);
  const l = await layer(app);
  const shown = await layerShown(app);
  check("⌘S brings the sidebar over the page in its own layer, 300 px wide", l && l.x === 0 && l.width === 300 && l.height === 900 && shown?.shown, JSON.stringify({ l, shown }));
  check("the layer is a copy of the sidebar: tabs and address bar", shown?.tabs >= 3 && shown?.address);
  check("the page does not move", JSON.stringify(await views(app)) === JSON.stringify(v));
  // A click in the layer reaches the real sidebar: pick the first tab row.
  await app.evaluate(async ({ BrowserWindow }) => {
    const ov = BrowserWindow.getAllWindows()[0].contentView.children.find((x) => x.webContents && /chrome-overlay\.html/.test(x.webContents.getURL()));
    await ov.webContents.executeJavaScript(`document.querySelector("#bar #tabs .tab").click()`);
  });
  await sleep(700);
  check("a click in the layer works like a click in the sidebar", /article\.html/.test(await ui.evaluate(() => tabs.find((t) => t.id === activeId)?.url)));
  await menuLabel(app, "Show Sidebar");
  await sleep(500);
  check("⌘S again sends it away", !(await layer(app)) || !(await layerShown(app))?.shown);
  await menuLabel(app, "Tab 1");
  await sleep(600);
  check("on the canvas: the sidebar is part of the window again, the page views are hidden", (await views(app)).length === 0 && !(await layerShown(app))?.shown);

  // Tabs.
  await ui.click("#sidebar #tabs .tab:nth-child(2)");
  await sleep(600);
  check("clicking a tab row opens it", await ui.$eval("#sidebar #tabs .tab:nth-child(2)", (t) => t.classList.contains("active")));
  check("a tab shows its monogram", /^[A-Z·]{1,2}$/.test(await ui.$eval("#sidebar #tabs .tab .mono", (m) => m.textContent)));

  // Switcher: the menu, New trail, dots, swipe.
  await menuLabel(app, "Tab 1");
  await sleep(400);
  await ui.click("#sb-switch-name");
  await sleep(300);
  const items = await ui.$$eval("#sb-switch-menu .sb-menu-item .nm", (r) => r.map((x) => x.textContent));
  check("the switcher menu: trails, New trail, Continue from phone, Open trail file…, Private tab", ["New trail", "Continue from phone", "Open trail file…", "Private tab"].every((x) => items.includes(x)), items.join(" | "));
  check("Continue from phone waits for sync", await ui.$eval("#sb-switch-menu .sb-menu-item:nth-last-child(3)", (b) => b.disabled));
  const first = await ui.evaluate(() => window.scout.researchGet());
  const firstName = first.name;
  await ui.locator("#sb-switch-menu .sb-menu-item", { hasText: "New trail" }).click();
  await sleep(1200);
  const second = await ui.evaluate(() => window.scout.researchGet());
  check("New trail makes a trail and shows its canvas", second.id !== first.id && (await ui.evaluate(() => !document.getElementById("canvas").hidden)), `${firstName} → ${second.name}`);
  await ui.evaluate(() => refreshSideTrails(true));
  await sleep(400);
  check("a dot per trail, the current one wide", (await ui.$$eval("#sb-dots .sb-dot", (d) => d.length)) === 2 && (await ui.$eval('#sb-dots .sb-dot[aria-selected="true"]', (d) => d.getBoundingClientRect().width)) === 16);
  check("its tabs: none yet", (await ui.evaluate(() => tabs.length)) === 0);
  // Two-finger swipe on the sidebar: the other trail.
  await ui.evaluate(() => {
    const sb = document.getElementById("sidebar");
    for (let i = 0; i < 6; i++) sb.dispatchEvent(new WheelEvent("wheel", { deltaX: 30, deltaY: 0, bubbles: true, cancelable: true }));
  });
  await sleep(1200);
  check("a two-finger swipe on the sidebar goes to the next trail", (await ui.evaluate(() => window.scout.researchGet())).id === first.id && (await ui.evaluate(() => tabs.length)) === 3);
  check("the switcher shows the current trail", (await ui.$eval("#sb-switch-title", (n) => n.textContent)) === firstName);
  await ui.click('#sb-dots .sb-dot[aria-selected="false"]');
  await sleep(1000);
  check("a dot goes to its trail", (await ui.evaluate(() => window.scout.researchGet())).id !== first.id);
  await ui.click('#sb-dots .sb-dot[aria-selected="false"]');
  await sleep(1000);

  // Timeline.
  await ui.evaluate(() => refreshTimeline(true));
  await sleep(400);
  const rows = await ui.$$eval("#sb-timeline-list .sb-tl-row .nm", (r) => r.map((x) => x.textContent));
  check("the timeline lists the trail's pages", rows.length >= 1, rows.join(" | "));

  // Tool grid: Mosaic and Sound on in violet.
  await ui.click("#sidebar #sound-btn");
  await sleep(500);
  check("Sound: all turns the tile violet", (await ui.$eval("#sidebar #sound-btn", (b) => getComputedStyle(b).borderColor)) === "rgb(177, 140, 255)" && (await ui.$eval("#sb-sound", (s) => s.textContent)) === "SOUND: ALL");
  await ui.click("#sidebar #sound-btn");
  await ui.click("#sidebar #layout-btn"); await sleep(600); if (await ui.evaluate(() => ovOpen)) await ui.click("#ov-done");
  await sleep(1200);
  const mv = await views(app);
  check("Mosaic on: the tile is violet and the tiles fill the window", (await ui.$eval("#sidebar #layout-btn", (b) => getComputedStyle(b).borderColor)) === "rgb(177, 140, 255)" && mv.length >= 2 && Math.min(...mv.map((b) => b.x)) < 20, JSON.stringify(mv));
  check("the Mosaic group lists the tiles", !(await ui.$eval("#sb-mosaic", (g) => g.hidden)) && (await ui.$$eval("#sb-mosaic .sb-mosaic-row", (r) => r.length)) >= 2);
  await ui.click("#sidebar #layout-btn"); await sleep(600); if (await ui.evaluate(() => ovOpen)) await ui.click("#ov-done");
  await sleep(1000);

  // Private tab.
  await menuLabel(app, "New Private Tab");
  await sleep(1500);
  const pv = await ui.evaluate(() => ({ t: tabs.find((x) => x.id === activeId), mark: document.querySelector("#tabs .tab.private .pv")?.textContent }));
  check("⌘⇧N opens a private tab with its mark", pv.t?.private && pv.mark === "Private", JSON.stringify(pv));
  await ui.evaluate((u) => window.scout.navigate(activeId, u), `${BASE}/other.html?n=secret`);
  await sleep(1800);
  const hist = await ui.evaluate(() => window.scout.historySearch("secret", 20));
  const trailNow = await ui.evaluate(() => window.scout.researchGet());
  check("nothing from a private tab goes into history or the trail", hist.length === 0 && !trailNow.trail.some((r) => /secret/.test(r.url)), JSON.stringify(hist.map((h) => h.url)));
  await ui.evaluate(() => refreshSideTrails(true));
  await ui.click('#sb-dots .sb-dot[aria-selected="false"]');
  await sleep(1000);
  check("a private tab is in no trail: it shows in every trail", await ui.evaluate(() => tabs.some((t) => t.private)));
  await ui.evaluate(() => window.scout.closeTab(tabs.find((t) => t.private).id));
  await sleep(600);
  await menuLabel(app, "Reopen Closed Tab");
  await sleep(800);
  check("closing it records nothing: Reopen Closed Tab does not bring it back", !(await ui.evaluate(() => tabs.some((t) => /secret/.test(t.url)))));

  // Kept across a restart; the private tab is not.
  await app.close();
  ({ app, ui } = await launch());
  await sleep(800);
  check("after a restart: the sidebar, the canvas, and no private tab", (await ui.evaluate(() => document.body.classList.contains("side") && !document.getElementById("canvas").hidden)) && !(await ui.evaluate(() => tabs.some((t) => t.private))));

  await app.close();
  if (failed) console.log(`::error::33-sidebar-chrome: ${failed} check(s) failed`);
  console.log(failed ? `${failed} checks failed` : "all checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
