// Rename and delete trails from the switcher (B115): each trail in the
// switcher menu has a "…" button with Rename and Delete…; double-clicking the
// switcher's name renames the current trail. Delete asks first, closes the
// trail's tabs, makes the next trail current and offers Undo for 10 s. The
// files go when NODE next starts. An opened file can be deleted, not renamed.
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
const trailsDir = path.join(userData, "trails");

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
const menuLabel = (app, label) => app.evaluate(({ Menu }, l) => Menu.getApplicationMenu().items.flatMap((m) => m.submenu?.items || []).find((i) => i.label === l).click(), label);
const names = (ui) => ui.evaluate(() => window.scout.trailList().then((l) => l.map((t) => t.name)));
const current = (ui) => ui.evaluate(() => window.scout.trailList().then((l) => l.find((t) => t.current)?.name));
const openMenu = async (ui) => {
  if (await ui.evaluate(() => document.getElementById("sb-switch-menu").hidden)) await ui.click("#sb-switch-name");
  await sleep(300);
};
const rowOf = (ui, name) =>
  ui.evaluateHandle((n) => [...document.querySelectorAll("#sb-switch-menu .sb-menu-row")].find((r) => r.querySelector(".nm")?.textContent === n), name);
const more = async (ui, name) => {
  await openMenu(ui);
  const row = await rowOf(ui, name);
  await (await row.$(".sb-menu-more")).click();
  await sleep(250);
};
const chip = (ui, label) => ui.evaluateHandle((l) => [...document.querySelectorAll("#sb-switch-menu .chip")].find((b) => b.textContent === l), label);

(async () => {
  let { app, ui } = await launch();
  await ui.evaluate(() => window.scout.trailRename("Starters"));
  await ui.evaluate(() => window.scout.researchNew("Rye breads"));
  await sleep(800);
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/other.html?n=r1`);
  await sleep(1000);
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/other.html?n=r2`);
  await sleep(1000);
  await ui.evaluate(() => window.scout.researchNew("Scoring"));
  await sleep(1000);
  await ui.evaluate(() => window.scout.trailSwitch && window.scout.trailList().then((l) => window.scout.trailSwitch(l.find((t) => t.name === "Rye breads").id)));
  await sleep(1200);
  await ui.evaluate(() => refreshSideTrails(true));
  check("three trails, Rye breads current", (await names(ui)).length === 3 && (await current(ui)) === "Rye breads", (await names(ui)).join());

  // Every trail row has a "…" button.
  await openMenu(ui);
  const rows = await ui.evaluate(() => [...document.querySelectorAll("#sb-switch-menu .sb-menu-row")].map((r) => [r.querySelector(".nm").textContent, !!r.querySelector(".sb-menu-more")]));
  check("each trail in the switcher has a … button", rows.length === 3 && rows.every((r) => r[1]), JSON.stringify(rows));
  await ui.screenshot({ path: path.join(OUT, "49-menu.png") });

  // Rename a trail that isn't current, from "…".
  await more(ui, "Scoring");
  await ui.screenshot({ path: path.join(OUT, "49-actions.png") });
  await (await chip(ui, "Rename")).click();
  await sleep(200);
  check("Rename shows a text field with the name selected", await ui.evaluate(() => document.activeElement?.classList.contains("sb-menu-rename") && document.activeElement.value === "Scoring" && document.activeElement.selectionEnd - document.activeElement.selectionStart === 7));
  await ui.keyboard.type("Scoring the loaf");
  await ui.keyboard.press("Enter");
  await sleep(800);
  check("Enter saves the new name", (await names(ui)).includes("Scoring the loaf") && (await current(ui)) === "Rye breads", (await names(ui)).join());
  check("the menu shows the new name", await ui.evaluate(() => [...document.querySelectorAll("#sb-switch-menu .nm")].some((x) => x.textContent === "Scoring the loaf")));

  // Escape cancels.
  await more(ui, "Scoring the loaf");
  await (await chip(ui, "Rename")).click();
  await sleep(200);
  await ui.keyboard.type("Nope");
  await ui.keyboard.press("Escape");
  await sleep(500);
  check("Escape keeps the old name", (await names(ui)).includes("Scoring the loaf") && !(await names(ui)).includes("Nope"));

  // Double-click the switcher's name: rename the current trail.
  await ui.evaluate(() => closeSwitchMenu());
  await ui.dblclick("#sb-switch-name");
  await sleep(400);
  check("double-clicking the name renames the current trail", await ui.evaluate(() => document.activeElement?.classList.contains("sb-menu-rename") && document.activeElement.value === "Rye breads"));
  await ui.keyboard.type("Rye and spelt");
  await ui.keyboard.press("Enter");
  await sleep(800);
  check("the current trail's name changes in the switcher", (await current(ui)) === "Rye and spelt" && (await ui.evaluate(() => document.getElementById("sb-switch-name").textContent.includes("Rye and spelt"))));
  const tid = await ui.evaluate(() => window.scout.trailList().then((l) => l.find((t) => t.current).id));
  const ev = fs.readFileSync(path.join(trailsDir, tid, "events.jsonl"), "utf8");
  check("a rename is recorded as an event", /"type":"renamed"/.test(ev));

  // Keyboard: F2 on a trail renames it.
  await openMenu(ui);
  await ui.evaluate(() => [...document.querySelectorAll("#sb-switch-menu .sb-menu-row")].find((r) => r.querySelector(".nm").textContent === "Starters").querySelector(".sb-menu-item").focus());
  await ui.keyboard.press("F2");
  await sleep(200);
  check("F2 renames the focused trail", await ui.evaluate(() => document.activeElement?.value === "Starters"));
  await ui.keyboard.press("Escape");
  await sleep(300);

  // Over a page, the sidebar is a copy in its own layer: rename works there too.
  await ui.evaluate(() => closeSwitchMenu());
  await menuLabel(app, "Tab 2");
  await sleep(700);
  await menuLabel(app, "Show Sidebar");
  await sleep(700);
  const inLayer = (js) =>
    app.evaluate(async ({ BrowserWindow }, code) => {
      const v = BrowserWindow.getAllWindows()[0].contentView.children.find((x) => x.webContents && /chrome-overlay\.html/.test(x.webContents.getURL()));
      return v ? v.webContents.executeJavaScript(code) : "no layer";
    }, js);
  await inLayer(`document.querySelector("#bar #sb-switch-name").click()`);
  await sleep(500);
  await inLayer(`[...document.querySelectorAll("#bar .sb-menu-row")].find((r) => r.querySelector(".nm").textContent === "Rye and spelt").querySelector(".sb-menu-more").click()`);
  await sleep(500);
  await inLayer(`[...document.querySelectorAll("#bar .chip")].find((b) => b.textContent === "Rename").click()`);
  await sleep(700);
  const typing = await inLayer(`(() => { const f = document.activeElement; return f && f.classList.contains("sb-menu-rename") ? f.value : ""; })()`);
  check("over a page, Rename gives a field in the sidebar's layer", typing === "Rye and spelt", typing);
  await inLayer(`(() => { const f = document.activeElement; f.value = "Rye, spelt and einkorn"; f.dispatchEvent(new Event("input", { bubbles: true })); f.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })()`);
  await sleep(900);
  check("Enter in the layer saves the name", (await current(ui)) === "Rye, spelt and einkorn", await current(ui));
  await ui.evaluate(() => window.scout.trailRename("Rye and spelt"));
  await menuLabel(app, "Show Sidebar");
  await menuLabel(app, "Tab 1");
  await sleep(700);
  await ui.evaluate(() => (closeSwitchMenu(), refreshSideTrails(true)));

  // Delete the current trail: asks first, closes its 2 tabs, the next trail becomes current.
  const tabsBefore = await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter((w) => /other\.html/.test(w.getURL())).length);
  await more(ui, "Rye and spelt");
  await (await chip(ui, "Delete…")).click();
  await sleep(250);
  const msg = await ui.evaluate(() => document.querySelector("#sb-switch-menu .sb-menu-confirm")?.textContent || "");
  check("Delete asks first and says what goes", /Delete “Rye and spelt”\? Its canvas, timeline and Replay go, and its 2 tabs close\. Library files stay\./.test(msg), msg);
  check("the focus is on Keep", await ui.evaluate(() => document.activeElement?.textContent === "Keep"));
  await ui.screenshot({ path: path.join(OUT, "49-confirm.png") });
  await (await chip(ui, "Keep")).click();
  await sleep(300);
  check("Keep changes nothing", (await names(ui)).length === 3);
  await more(ui, "Rye and spelt");
  await (await chip(ui, "Delete…")).click();
  await sleep(200);
  await (await chip(ui, "Delete trail")).click();
  await sleep(1500);
  const after = await names(ui);
  check("the trail is gone from the list", after.length === 2 && !after.includes("Rye and spelt"), after.join());
  check("the most recently used other trail is current", (await current(ui)) === "Scoring the loaf", await current(ui));
  const tabsAfter = await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter((w) => /other\.html/.test(w.getURL())).length);
  check("its tabs closed", tabsBefore >= 2 && tabsAfter === tabsBefore - 2, `${tabsBefore} → ${tabsAfter}`);
  check("its files stay until NODE restarts", fs.existsSync(path.join(trailsDir, tid, "trail.json")));
  const undo = await ui.evaluate(() => ({ shown: !document.getElementById("sb-undo").hidden, text: document.getElementById("sb-undo-text").textContent }));
  check("Undo is offered", undo.shown && undo.text === "Deleted “Rye and spelt”.", JSON.stringify(undo));
  await ui.screenshot({ path: path.join(OUT, "49-undo.png") });

  // Undo brings it back, current.
  await ui.click("#sb-undo-btn");
  await sleep(1200);
  check("Undo brings the trail back as the current trail", (await current(ui)) === "Rye and spelt" && (await names(ui)).length === 3);
  check("the Undo bar goes", await ui.evaluate(() => document.getElementById("sb-undo").hidden));

  // Delete it again, with the keyboard, and restart: the files are purged.
  await openMenu(ui);
  await ui.evaluate(() => [...document.querySelectorAll("#sb-switch-menu .sb-menu-row")].find((r) => r.querySelector(".nm").textContent === "Rye and spelt").querySelector(".sb-menu-item").focus());
  await ui.keyboard.press("Delete");
  await sleep(200);
  check("Delete key asks to delete the focused trail", /Delete “Rye and spelt”/.test(await ui.evaluate(() => document.querySelector("#sb-switch-menu .sb-menu-confirm")?.textContent || "")));
  await (await chip(ui, "Delete trail")).click();
  await sleep(1200);
  // A non-current trail too.
  await more(ui, "Starters");
  await (await chip(ui, "Delete…")).click();
  await sleep(200);
  const msg2 = await ui.evaluate(() => document.querySelector("#sb-switch-menu .sb-menu-confirm")?.textContent || "");
  check("a trail with no tabs doesn't mention tabs", msg2 === "Delete “Starters”? Its canvas, timeline and Replay go. Library files stay.", msg2);
  await (await chip(ui, "Delete trail")).click();
  await sleep(1200);
  check("one trail left", (await names(ui)).join() === "Scoring the loaf", (await names(ui)).join());
  await app.close();
  ({ app, ui } = await launch());
  check("after a restart the deleted trails' files are gone", !fs.existsSync(path.join(trailsDir, tid)));
  check("the remaining trail is still there", (await names(ui)).join() === "Scoring the loaf", (await names(ui)).join());

  // Deleting the last trail starts a new one.
  await more(ui, "Scoring the loaf");
  await (await chip(ui, "Delete…")).click();
  await sleep(200);
  await (await chip(ui, "Delete trail")).click();
  await sleep(1500);
  const left = await ui.evaluate(() => window.scout.trailList());
  check("deleting the only trail starts a new, empty one", left.length === 1 && left[0].name !== "Scoring the loaf" && left[0].cards === 0, JSON.stringify(left.map((t) => t.name)));

  // An opened trail file: Rename is off, Delete works.
  const file = path.join(__dirname, "..", "..", "docs", "sourdough-starters.trail.md");
  await app.evaluate((_e, f) => global.nodeTest.openSharedTrail(f), file);
  await sleep(1500);
  const opened = (await ui.evaluate(() => window.scout.trailList())).find((t) => t.readonly);
  if (opened) {
    await ui.evaluate(() => refreshSideTrails(true));
    await more(ui, opened.name);
    const ren = await ui.evaluate(() => {
      const b = [...document.querySelectorAll("#sb-switch-menu .chip")].find((x) => x.textContent === "Rename");
      return { disabled: b?.disabled, title: b?.title };
    });
    check("an opened file can't be renamed", ren.disabled && ren.title === "Read only. Save as new trail to change it.", JSON.stringify(ren));
    const r = await ui.evaluate((id) => window.scout.trailRenameId(id, "Mine now"), opened.id);
    check("main refuses to rename it too", r === null);
    await (await chip(ui, "Delete…")).click();
    await sleep(200);
    await (await chip(ui, "Delete trail")).click();
    await sleep(1200);
    check("an opened file's trail can be deleted", !(await ui.evaluate(() => window.scout.trailList())).some((t) => t.readonly));
    check("the file itself stays", fs.existsSync(file));
  } else check("opened a trail file", false, "no way to open a file from the test");

  await app.close();
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
