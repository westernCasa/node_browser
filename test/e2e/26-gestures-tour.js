// Gestures (B72): trackpad pinch between Focus, Mosaic and the tab overview,
// pinch to zoom the page, Ctrl + mouse wheel left alone, ⌘1-⌘4 in Mosaic, the
// loop shortcut, and the gestures tutorial (practice tabs, coach band, steps,
// putting the user's tabs back, the one-time offer).
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

async function launch(env = {}) {
  const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")], env: { ...process.env, ...env } });
  await app.evaluate(() => {
    const o = globalThis.fetch;
    globalThis.fetch = async (u, opt) => (/wikipedia|duckduckgo|brave\.com/.test(String(u)) ? new Response("{}", { status: 200 }) : o(u, opt));
  });
  const ui = await app.firstWindow();
  await sleep(1500);
  return { app, ui };
}
// Runs code in the page of a tab, found by address.
const inPage = (app, match, code) =>
  app.evaluate(({ webContents }, [m, c]) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes(m));
    return wc ? wc.executeJavaScript(c, true) : "no page";
  }, [match, code]);
// A trackpad pinch: ctrl + wheel in small fractional steps. dir "in" = fingers together.
const pinchPage = (app, match, dir, steps = 12) =>
  inPage(app, match, `(async () => { for (let i = 0; i < ${steps}; i++) { window.dispatchEvent(new WheelEvent("wheel", { ctrlKey: true, deltaY: ${dir === "in" ? 3.5 : -3.5}, cancelable: true })); await new Promise((r) => setTimeout(r, 16)); } return true; })()`);
const pinchUi = (ui, dir, steps = 12) =>
  ui.evaluate(async ([d, n]) => {
    const el = document.getElementById("overview");
    for (let i = 0; i < n; i++) { el.dispatchEvent(new WheelEvent("wheel", { ctrlKey: true, deltaY: d === "in" ? 3.5 : -3.5, cancelable: true, bubbles: true })); await new Promise((r) => setTimeout(r, 16)); }
  }, [dir, steps]);
const menuClick = (app, label) =>
  app.evaluate(({ Menu }, l) => {
    const find = (items) => { for (const it of items) { if (it.label === l) return it; if (it.submenu) { const f = find(it.submenu.items); if (f) return f; } } return null; };
    const it = find(Menu.getApplicationMenu().items);
    if (!it) return false;
    it.click();
    return true;
  }, label);
const layoutOf = (ui) => ui.evaluate(() => ({ layout, ov: ovOpen, active: activeId }));
const zoomOf = (app, match) => app.evaluate(({ webContents }, m) => webContents.getAllWebContents().find((w) => w.getURL().includes(m))?.getZoomFactor(), match);

(async () => {
  let { app, ui } = await launch();
  await ui.fill("#omni", `${BASE}/other.html?n=1`);
  await ui.press("#omni", "Enter");
  await sleep(1500);
  for (const n of [2, 3]) await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/other.html?n=${n}`);
  await sleep(2000);
  check("no tutorial offer in test runs", !/2-minute tutorial/.test(await ui.textContent("#notice")));

  // Pinch in Focus: out zooms the page, in zooms it back, then (a new pinch) goes to Mosaic.
  await pinchPage(app, "n=3", "out");
  await sleep(400);
  const z1 = await zoomOf(app, "n=3");
  check("pinch out in Focus zooms the page", z1 > 1.2 && (await layoutOf(ui)).layout === "focus", `zoom ${z1?.toFixed(2)}`);
  await pinchPage(app, "n=3", "in", 30);
  await sleep(400);
  const z2 = await zoomOf(app, "n=3");
  check("pinch in on a zoomed page zooms back to 100% and stays in Focus", Math.abs(z2 - 1) < 0.01 && (await layoutOf(ui)).layout === "focus", `zoom ${z2?.toFixed(2)}`);
  await pinchPage(app, "n=3", "in");
  await sleep(1200);
  check("pinch in at 100% goes to Mosaic", (await layoutOf(ui)).layout === "mosaic" && (await ui.getAttribute("#layout-btn", "aria-pressed")) === "true");

  // Ctrl + mouse wheel is page zoom, not a level change.
  await inPage(app, "n=2", `window.dispatchEvent(new WheelEvent("wheel", { ctrlKey: true, deltaY: 100, cancelable: true })), true`);
  await sleep(500);
  check("Ctrl + mouse wheel does not change the level", (await layoutOf(ui)).layout === "mosaic" && !(await layoutOf(ui)).ov);

  // Mosaic: pinch in → overview; pinch out there → back to Mosaic.
  await pinchPage(app, "n=1", "in");
  await sleep(1500);
  check("pinch in in Mosaic opens the tab overview", (await layoutOf(ui)).ov && (await ui.isVisible("#overview")));
  await pinchUi(ui, "out");
  await sleep(1200);
  check("pinch out in the overview = Done, back to Mosaic", !(await layoutOf(ui)).ov && (await layoutOf(ui)).layout === "mosaic");

  // Pinch out on a tile focuses that tile.
  await pinchPage(app, "n=2", "out");
  await sleep(1200);
  const l3 = await layoutOf(ui);
  const activeUrl = await ui.evaluate(() => tabs.find((t) => t.id === activeId)?.url);
  check("pinch out on a tile focuses that tile", l3.layout === "focus" && /n=2/.test(activeUrl), activeUrl);

  // ⌘1-⌘4 in Mosaic focus a tile; outside Mosaic they pick tabs.
  await ui.click("#layout-btn");
  await sleep(1000);
  await menuClick(app, "Tab 3");
  await sleep(1000);
  const l4 = await layoutOf(ui);
  check("⌘3 in Mosaic focuses the third tile", l4.layout === "focus" && /n=3/.test(await ui.evaluate(() => tabs.find((t) => t.id === activeId)?.url)));
  await menuClick(app, "Tab 1");
  await sleep(600);
  check("⌘1 outside Mosaic still picks tab 1", (await layoutOf(ui)).layout === "focus" && /n=1/.test(await ui.evaluate(() => tabs.find((t) => t.id === activeId)?.url)));

  // The tutorial.
  const before = await ui.evaluate(() => ({ n: tabs.length, active: activeId }));
  await ui.evaluate(() => startTour());
  await sleep(2500);
  const t0 = await ui.evaluate(() => ({ n: tabs.length, tiles: tabs.filter((t) => t.tile).length, coach: !document.getElementById("coach").hidden, step: document.querySelector("#coach h2")?.textContent }));
  check("the tutorial opens 4 practice tabs as Mosaic tiles", t0.n === before.n + 4 && t0.tiles === 4, JSON.stringify(t0));
  check("the coach shows step 1", t0.coach && /Zoom out to Mosaic/.test(t0.step), t0.step);
  const pageBox = await app.evaluate(({ BrowserWindow, webContents }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const v = w.contentView.children.find((c) => c.webContents && /tutorial\/levain/.test(c.webContents.getURL()));
    return { page: v ? v.getBounds() : null, win: w.getContentBounds() };
  });
  check("pages leave room for the coach band", pageBox.page && pageBox.page.y + pageBox.page.height <= pageBox.win.height - 132 + 1, JSON.stringify(pageBox.page));
  const step = () => ui.evaluate(() => tour ? tour.i : -1);
  // 1 Mosaic by pinch, 2 Focus by ⌘2, 3 overview by shortcut, 4 pick two, 5 Enter, 6 ⌘⇧M, 7 loop, 8 stop.
  await pinchPage(app, "tutorial/levain", "in");
  await sleep(1600);
  check("step 1 done by pinching in", (await step()) === 1, String(await step()));
  await menuClick(app, "Tab 2");
  await sleep(1600);
  check("step 2 done by ⌘2", (await step()) === 2);
  await menuClick(app, "Choose Tabs for Mosaic…");
  await sleep(1800);
  check("step 3 done by ⌘⇧\\", (await step()) === 3);
  const cards = await ui.$$eval("#ov-grid .ov-card", (els) => els.filter((c) => /Wild yeast|Amylase|Rye/.test(c.textContent)).map((c) => c.dataset.id));
  for (const id of cards.slice(0, 2)) await ui.click(`#ov-grid .ov-card[data-id="${id}"]`);
  await sleep(1600);
  check("step 4 done by picking two cards", (await step()) === 4);
  await ui.keyboard.press("Enter");
  await sleep(1800);
  check("step 5 done by Enter", (await step()) === 5 && (await ui.evaluate(() => tabs.filter((t) => t.tile).length)) === 2);
  await menuClick(app, "Toggle Mosaic");
  await sleep(2600);
  check("step 6 done by ⌘⇧M; step 7 opens the practice video", (await step()) === 6 && (await ui.evaluate(() => activeId === tour.video)));
  await sleep(2500);
  const pv = { omni: await ui.inputValue("#omni"), status: await ui.textContent("#suggest-status") };
  check("practice pages show no address and no suggestions", pv.omni === "" && /practice page for the tutorial/i.test(pv.status), JSON.stringify(pv));
  await menuClick(app, "Loop Video: Next Minute / Stop");
  await sleep(1600);
  check("step 7 done by ⌘⇧L (loops the next minute)", (await step()) === 7 && /↻ \d+:\d\d–\d+:\d\d/.test(await ui.textContent("#tabs .tab.active .loop-mark").catch(() => "")));
  await menuClick(app, "Loop Video: Next Minute / Stop");
  await sleep(1600);
  check("step 8 done by ⌘⇧L again (stops)", (await step()) === 8 && /Tutorial complete/.test(await ui.textContent("#coach")));
  await ui.click("#coach-close");
  await sleep(1500);
  const after = await ui.evaluate(() => ({ n: tabs.length, active: activeId, tiles: tabs.filter((t) => t.tile).length, coach: !document.getElementById("coach").hidden, layout }));
  check("closing puts the user's tabs back", after.n === before.n && after.active === before.active && after.tiles === 0 && !after.coach && after.layout === "focus", JSON.stringify(after));
  const box2 = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; const v = w.contentView.children.find((c) => c.webContents && /n=1/.test(c.webContents.getURL())); return { page: v.getBounds(), win: w.getContentBounds() }; });
  check("the pages take the full height again", box2.page.y + box2.page.height >= box2.win.height - 1, JSON.stringify(box2.page));

  // End tutorial in the middle also puts things back.
  await ui.evaluate(() => startTour());
  await sleep(2000);
  await ui.click("#coach-close");
  await sleep(1500);
  check("End tutorial mid-way closes the practice tabs", (await ui.evaluate(() => tabs.length)) === before.n);
  await app.evaluate(({ app }) => app.quit());
  await sleep(1500);

  // The one-time offer (NODE_TOUR=1 stands for a normal start).
  ({ app, ui } = await launch({ NODE_TOUR: "1" }));
  await sleep(2500);
  const offerUd = await ui.evaluate(() => { try { localStorage.removeItem("node.tour"); } catch (_) {} return true; });
  void offerUd;
  await app.evaluate(({ app }) => app.quit());
  await sleep(1500);
  ({ app, ui } = await launch({ NODE_TOUR: "1" }));
  await sleep(3000);
  const offer = await ui.textContent("#notice");
  check("after an update, the tutorial is offered once", /2-minute tutorial/.test(offer) && (await ui.isVisible("#notice button:has-text('Start tutorial')")), offer.slice(0, 60));
  await ui.click("#notice button:has-text('Not now')");
  await app.evaluate(({ app }) => app.quit());
  await sleep(1500);
  ({ app, ui } = await launch({ NODE_TOUR: "1" }));
  await sleep(3000);
  check("...and not again", !/2-minute tutorial/.test(await ui.textContent("#notice").catch(() => "")) || (await ui.$eval("#notice", (e) => e.hidden)));
  check("Help has Learn gestures and shortcuts", (await ui.$("#tour-start")) !== null);
  await app.evaluate(({ app }) => app.quit());

  console.log(failed ? `${failed} checks failed` : "all checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
