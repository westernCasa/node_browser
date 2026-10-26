// Tabs do not switch by themselves, and tabs sleep only after time in use
// (reported by Sven on the Mac with 0.9.4): a Mosaic tile that loads a new
// page takes focus, which used to make it the active tab; stepping away from
// the computer counted toward putting tabs to sleep.
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

(async () => {
  const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")] });
  await app.evaluate(() => {
    const o = globalThis.fetch;
    globalThis.fetch = async (u, opt) => (/wikipedia|duckduckgo|brave\.com/.test(String(u)) ? new Response("{}", { status: 200 }) : o(u, opt));
  });
  const ui = await app.firstWindow();
  await sleep(1500);
  const active = () => ui.evaluate(() => tabs.find((x) => x.id === activeId)?.url || "");
  const asleep = () => ui.$$eval("#tabs .tab.asleep", (e) => e.length);

  // A tile in Mosaic that moves to a new page by itself, 3 s after loading.
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/grabfocus.html?m=nav`);
  for (let i = 1; i <= 2; i++) await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/other.html?n=${i}`);
  await sleep(500);
  await ui.click("#layout-btn");
  await sleep(4500);
  check("a tile loading a new page by itself does not take over", /n=2$/.test(await active()), await active());

  // Clicking inside a tile still makes it the active tab.
  const bounds = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].contentView.children.filter((v) => v.webContents && /n=after/.test(v.webContents.getURL())).map((v) => v.getBounds())[0]);
  check("the tile moved to its new page", Boolean(bounds));
  if (bounds) {
    await app.evaluate(({ BrowserWindow }) => {
      const v = BrowserWindow.getAllWindows()[0].contentView.children.find((c) => c.webContents && /n=after/.test(c.webContents.getURL()));
      for (const type of ["mouseDown", "mouseUp"]) v.webContents.sendInputEvent({ type, x: 40, y: 40, button: "left", clickCount: 1 });
    });
    await sleep(800);
  }
  check("clicking a tile still makes it active", /n=after$/.test(await active()), await active());
  await ui.click("#layout-btn");
  await sleep(1000);

  // Sleep: time away does not count; time in use does (30 minutes by default).
  check("default: sleep after 30 minutes", (await ui.evaluate(() => window.scout.getSettings())).tabSleep === 30);
  await app.evaluate(() => global.nodeTest.sleepIdleTabs({ step: 2 * 60 * 60 * 1000, inUse: false }));
  await sleep(500);
  check("two hours away: no tab sleeps", (await asleep()) === 0, String(await asleep()));
  await app.evaluate(() => global.nodeTest.sleepIdleTabs({ step: 20 * 60 * 1000, inUse: true }));
  await sleep(500);
  check("20 minutes in use: no tab sleeps", (await asleep()) === 0, String(await asleep()));
  await app.evaluate(() => global.nodeTest.sleepIdleTabs({ step: 15 * 60 * 1000, inUse: true }));
  await sleep(500);
  const n = await asleep();
  check("35 minutes in use: the other tabs sleep", n >= 2, String(n));
  check("the active tab never sleeps", !(await ui.$eval("#tabs .tab.active", (e) => e.classList.contains("asleep"))));

  // Never.
  await ui.click("#tabs .tab.asleep");
  await sleep(1000);
  await ui.evaluate(() => window.scout.setSettings({ tabSleep: 0 }));
  check("setting saved: never", (await ui.evaluate(() => window.scout.getSettings())).tabSleep === 0);
  const before = await asleep();
  await app.evaluate(() => global.nodeTest.sleepIdleTabs({ step: 10 * 60 * 60 * 1000, inUse: true }));
  await sleep(500);
  check("with Never, no more tabs sleep", (await asleep()) <= before, `${before} → ${await asleep()}`);
  check("Settings shows the choice", (await ui.$$eval("#tab-sleep option", (o) => o.map((x) => x.value))).join(",") === "15,30,60,120,0");

  await app.close();
  if (failed) console.log(`::error::30-tab-focus-sleep: ${failed} check(s) failed`);
  process.exit(failed ? 1 : 0);
})();
