// First-run setup, the new tab page and diagnostics.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path"), fs = require("fs"), os = require("os");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "scout-e2e-"));
const BASE = "http://127.0.0.1:8765";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);
(async () => {
  const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
  const launch = async (env = {}) => {
    const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")], env: { ...process.env, ...env } });
    await app.evaluate(() => {
      const real = globalThis.fetch;
      globalThis.fetch = async (u, o) => (/wikipedia|duckduckgo/.test(String(u)) ? new Response("{}", { status: 200 }) : real(u, o));
    });
    const ui = await app.firstWindow();
    await sleep(1800);
    return { app, ui };
  };
  let { app, ui } = await launch({ NODE_FIRST_RUN: "1" });
  log("first run screen shown:", await ui.isVisible("#firstrun"), "| page views hidden:", await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length === 0));
  await ui.screenshot({ path: path.join(OUT, "first-run.png") });
  await ui.fill("#fr-brave", "BSA-test-key-123");
  await ui.check('input[name="fr-ai"][value="grok"]');
  log("Grok key field after choosing Grok:", await ui.isVisible("#fr-grok"));
  await ui.fill("#fr-grok", "xai-test");
  await ui.uncheck("#fr-adblock");
  await ui.click("#fr-done");
  await sleep(1000);
  const saved = JSON.parse(fs.readFileSync(path.join(userData, "settings.json"), "utf8"));
  log("after Start browsing: screen hidden:", !(await ui.isVisible("#firstrun")), "| saved:", JSON.stringify({ firstRunDone: saved.firstRunDone, adblock: saved.adblock, restoreTabs: saved.restoreTabs, ai: saved.ai.provider, braveOn: saved.providers.brave.enabled, braveKeyStored: Boolean(saved.providers.brave.key || saved.providers.brave.keyEnc), grokKeyStored: Boolean(saved.ai.grok.key?.enc || saved.ai.grok.key?.plain) }));
  log("page views back:", await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length));

  // New tab page.
  const tabUrl = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.getURL()).filter((u) => !u.includes("index.html")).at(-1));
  log("first tab:", (await tabUrl()).replace(/^.*\/renderer\//, "renderer/").slice(0, 30), "| address bar:", JSON.stringify(await ui.$eval("#omni", (e) => e.value)));
  for (const p of ["/article.html", "/article.html", "/other.html"]) {
    await ui.fill("#omni", BASE + p);
    await ui.press("#omni", "Enter");
    await sleep(1300);
  }
  await ui.click("#new-tab");
  await sleep(1500);
  const startUrl = await app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.getURL()).find((u) => u.includes("start.html")));
  const top = decodeURIComponent(startUrl.split("top=")[1] || "[]");
  log("new tab page most visited:", JSON.parse(top).map((t) => t.title).join(" | "), "| address bar focused:", await ui.evaluate(() => document.activeElement.id));
  await sleep(1500);
  log("suggestions on the start page:", (await ui.textContent("#suggest-status")).slice(0, 60) || "(none)");
  const tiles = await app.evaluate(({ webContents }) => webContents.getAllWebContents().find((w) => w.getURL().includes("start.html")).executeJavaScript(`[...document.querySelectorAll(".tiles a")].map((a) => a.querySelector("b").textContent)`));
  log("start page tiles:", tiles.join(" | "));
  const startWc = await app.evaluate(({ webContents }) => webContents.getAllWebContents().find((w) => w.getURL().includes("start.html")).id);
  // Typing a search on the start page.
  await app.evaluate(({ webContents }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes("start.html"));
    wc.executeJavaScript(`document.getElementById("q").value = "http://127.0.0.1:8765/other.html"; document.getElementById("f").requestSubmit();`);
  });
  await sleep(1500);
  log("start page address box opened:", await ui.$eval("#omni", (e) => e.value));

  // Custom new tab page.
  await ui.evaluate(() => window.scout.setSettings({ startPage: "http://127.0.0.1:8765/media.html" }));
  await ui.click("#new-tab");
  await sleep(1200);
  log("custom new tab page:", (await app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.getURL()))).filter((u) => u.includes("media.html")).length, "tab(s) on media.html");

  // Diagnostics.
  const diag = await ui.evaluate(() => window.scout.copyDiagnostics());
  log("diagnostics:", diag.split("\n").slice(0, 7).join(" / ").slice(0, 400));
  log("no keys in diagnostics:", !/BSA-test|xai-test/.test(diag), "| log file:", fs.existsSync(path.join(userData, "logs", "node.log")));
  const help = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find((i) => i.role === "help" || i.label === "Help")?.submenu.items.map((i) => i.label).filter(Boolean));
  log("Help menu:", help.join(", "));
  await app.close();

  // Second start: no setup screen.
  ({ app, ui } = await launch({ NODE_FIRST_RUN: "1" }));
  log("second start shows setup:", await ui.isVisible("#firstrun"));
  await app.close();
  process.exit(0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
