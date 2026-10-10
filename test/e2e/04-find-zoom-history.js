// B19 checks: history, address-bar suggestions, find in page, zoom.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path"), fs = require("fs");
const OUT = process.argv[2] || require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "scout-e2e-")), BASE = "http://127.0.0.1:8765";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);
(async () => {
  const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
  const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, require("path").join(__dirname, "..", "..")] });
  await app.evaluate(() => { const o = globalThis.fetch; globalThis.fetch = async (u, opt) => (/wikipedia|duckduckgo/.test(String(u)) ? new Response("{}", { status: 200 }) : o(u, opt)); });
  const ui = await app.firstWindow();
  await sleep(1500);
  const go = async (url) => { await ui.fill("#omni", url); await ui.press("#omni", "Enter"); await sleep(1500); };
  await go(BASE + "/other.html");
  await go(BASE + "/media.html");
  await go(BASE + "/article.html");
  await go(BASE + "/other.html");
  const send = (cmd, extra = {}) => app.evaluate(({ BrowserWindow }, m) => BrowserWindow.getAllWindows()[0].webContents.send("ui:command", m), { cmd, ...extra });

  const hits = await ui.evaluate(() => window.scout.historySearch("lev", 5));
  log("history search 'lev':", hits.map((h) => `${h.title} (${h.visits}x)`).join(" | "));
  await ui.fill("#omni", "127.0.0.1:8765/ar");
  await ui.type("#omni", "t");
  await sleep(600);
  log("address-bar suggestions:", (await ui.$$eval("#history-list option", (o) => o.map((x) => x.value))).join(" | "));

  await go(BASE + "/article.html");
  await send("find-open");
  await sleep(300);
  await ui.type("#find-input", "levain");
  await sleep(1200);
  log("find 'levain' count:", await ui.textContent("#find-count"));
  await ui.press("#find-input", "Enter");
  await sleep(800);
  log("after Enter:", await ui.textContent("#find-count"));
  await ui.screenshot({ path: path.join(OUT, "find.png") });
  await ui.press("#find-input", "Escape");
  log("find bar hidden after Esc:", await ui.$eval("#findbar", (e) => e.hidden));

  const id = await ui.evaluate(() => document.querySelector("#tabs .tab.active") && window.scout && null);
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find((i) => i.label === "View").submenu.items.find((i) => i.label === "Zoom In").click());
  await sleep(500);
  log("zoom badge after Zoom In:", await ui.$eval("#zoom-badge", (e) => (e.hidden ? "hidden" : e.textContent)));
  await ui.click("#zoom-badge");
  await sleep(500);
  log("zoom badge after click:", await ui.$eval("#zoom-badge", (e) => (e.hidden ? "hidden" : e.textContent)));

  await send("open-history");
  await sleep(1000);
  log("history shelf rows:", (await ui.$$eval(".history-row .t", (e) => e.map((x) => x.textContent))).join(" | "));
  await ui.screenshot({ path: path.join(OUT, "history.png") });
  await sleep(2000);
  log("history.json saved:", fs.existsSync(path.join(userData, "history.json")));
  process.exit(0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
