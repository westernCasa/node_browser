// Trails keep their own tabs (B80): each tab belongs to the trail that was
// current when it opened; switching trails shows that trail's tabs and keeps
// the others open out of view; Mosaic, tab shortcuts, closing and reordering
// work on the current trail's tabs; the split is kept across a restart.
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
// Tabs saved by an earlier version (no trail): they join the current trail.
fs.writeFileSync(path.join(userData, "tabs.json"), JSON.stringify({ version: 1, layout: "focus", active: 0, tabs: [{ url: `${BASE}/other.html?n=old`, title: "Old tab" }] }));

async function launch() {
  const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")] });
  await app.evaluate(() => {
    const o = globalThis.fetch;
    globalThis.fetch = async (u, opt) => (/wikipedia|duckduckgo|brave\.com/.test(String(u)) ? new Response("{}", { status: 200 }) : o(u, opt));
  });
  const ui = await app.firstWindow();
  await sleep(1800);
  return { app, ui };
}
const shown = (ui) => ui.evaluate(() => tabs.map((t) => t.url.replace(/^.*\?n=/, "")));
const active = (ui) => ui.evaluate(() => (tabs.find((t) => t.id === activeId)?.url || "").replace(/^.*\?n=/, ""));
const views = (app) => app.evaluate(({ webContents }) => webContents.getAllWebContents().filter((w) => /other\.html/.test(w.getURL())).length);
const menuItem = (app, label) => app.evaluate(({ Menu }, l) => Menu.getApplicationMenu().items.flatMap((m) => m.submenu?.items || []).find((i) => i.label === l).click(), label);

(async () => {
  let { app, ui } = await launch();
  check("tabs from an earlier version join the current trail", (await shown(ui)).join() === "old", (await shown(ui)).join());
  const first = await ui.evaluate(() => window.scout.researchGet());
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/other.html?n=a1`);
  await sleep(800);
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/other.html?n=a2`);
  await sleep(1200);
  check("first trail: three tabs", (await shown(ui)).join() === "old,a1,a2", (await shown(ui)).join());

  // A new trail starts with its own new tab; the first trail's tabs stay open.
  await ui.evaluate(() => window.scout.researchNew("Second"));
  await sleep(1500);
  let s = await shown(ui);
  check("a new trail shows only its own new tab", s.length === 1 && !s[0].startsWith("a"), s.join());
  check("the first trail's pages stay open out of view", (await views(app)) >= 2);
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/other.html?n=b1`);
  await sleep(1200);
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/other.html?n=b2`);
  await sleep(1200);
  const list = await ui.evaluate(() => window.scout.researchList());
  check("the trail list counts each trail's tabs", list.find((t) => t.name === "Second")?.tabs === 2 && list.find((t) => t.id === first.id)?.tabs === 3, JSON.stringify(list.map((t) => [t.name, t.tabs])));

  // Tab shortcuts and Mosaic stay within the trail.
  await menuItem(app, "Next Tab");
  await sleep(500);
  await menuItem(app, "Next Tab");
  await sleep(500);
  await menuItem(app, "Next Tab");
  await sleep(500);
  check("Next Tab cycles through this trail's tabs only", !(await active(ui)).startsWith("a") && !(await active(ui)).startsWith("old"), await active(ui));
  await ui.click("#layout-btn");
  await sleep(1200);
  const tiles = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter((v) => v.webContents && v.getBounds().width > 0 && /8765|start/.test(v.webContents.getURL())).map((v) => v.webContents.getURL().replace(/^.*\?n=/, "")));
  check("Mosaic shows this trail's tabs only", tiles.length >= 2 && tiles.every((t) => !t.startsWith("a") && t !== "old"), tiles.join());
  await ui.click("#layout-btn");
  await sleep(800);

  // Reordering works while other trails' tabs are hidden.
  const ids = await ui.evaluate(() => tabs.map((t) => t.id));
  await ui.evaluate((o) => window.scout.moveTabs(o), [...ids].reverse());
  await sleep(500);
  check("reordering this trail's tabs works", (await ui.evaluate(() => tabs.map((t) => t.id))).join() === [...ids].reverse().join());

  // Switch back: the first trail's tabs, with the one that was active.
  await ui.evaluate((id) => window.scout.researchSwitch(id), first.id);
  await sleep(1200);
  check("switching back shows the first trail's tabs", (await shown(ui)).join() === "old,a1,a2", (await shown(ui)).join());
  check("and the tab that was active there", (await active(ui)) === "a2", await active(ui));

  // Closing the last tab of a trail opens a new one there, not another trail's.
  const second = (await ui.evaluate(() => window.scout.researchList())).find((t) => t.name === "Second");
  await ui.evaluate((id) => window.scout.researchSwitch(id), second.id);
  await sleep(1000);
  for (const id of await ui.evaluate(() => tabs.map((t) => t.id))) {
    await ui.evaluate((i) => window.scout.closeTab(i), id);
    await sleep(500);
  }
  await sleep(800);
  s = await shown(ui);
  check("closing every tab of a trail leaves one new tab in it", s.length === 1 && !/^(a|b|old)/.test(s[0]), s.join());
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/other.html?n=b3`);
  await sleep(1500);

  // Restart: each trail keeps its tabs.
  await app.close();
  ({ app, ui } = await launch());
  await sleep(1000);
  check("after a restart the current trail shows its tabs", (await shown(ui)).some((t) => t === "b3") && !(await shown(ui)).some((t) => /^a/.test(t)), (await shown(ui)).join());
  await ui.evaluate((id) => window.scout.researchSwitch(id), first.id);
  await sleep(1200);
  check("and the other trail still has its own", (await shown(ui)).join() === "old,a1,a2", (await shown(ui)).join());

  await app.close();
  if (failed) console.log(`::error::36-trail-tabs: ${failed} check(s) failed`);
  console.log(failed ? `${failed} checks failed` : "all checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
