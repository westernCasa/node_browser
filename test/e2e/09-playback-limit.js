// Media plays in up to 4 tabs at once; a 5th pauses the oldest, and a paused
// tab resumes when it is opened.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path");
const fs = require("fs");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(require("os").tmpdir(), "scout-e2e-"));
const BASE = "http://127.0.0.1:8765";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);

(async () => {
  const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
  const app = await electron.launch({
    executablePath: require("electron"),
    args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
  });
  await app.evaluate(({ app: a }, ud) => {
    a.setPath("userData", ud);
    globalThis.fetch = async (url) =>
      String(url).includes("wikipedia.org/w/api.php")
        ? new Response(JSON.stringify({ query: { pages: {} } }), { status: 200 })
        : new Response("", { status: 200 });
  }, userData);
  const ui = await app.firstWindow();
  await ui.waitForLoadState("domcontentloaded");
  await sleep(1500);

  // Which video pages are playing, by tab number n.
  const playing = () =>
    app.evaluate(async ({ webContents }) => {
      const out = {};
      for (const wc of webContents.getAllWebContents()) {
        const m = /video-main\.html\?n=(\d)/.exec(wc.getURL());
        if (m) out[m[1]] = await wc.executeJavaScript(`(() => { const v = document.getElementById("big"); return v ? !v.paused : null; })()`).catch(() => null);
      }
      return out;
    });
  const marked = () => ui.$$eval("#tabs .tab", (els) => els.map((e, i) => (e.querySelector(".limit") ? i + 1 : 0)).filter(Boolean));

  for (let n = 1; n <= 5; n++) {
    if (n > 1) {
      await ui.click("#new-tab");
      await sleep(800);
    }
    await ui.fill("#omni", `${BASE}/video-main.html?n=${n}`);
    await ui.press("#omni", "Enter");
    await sleep(2500);
    log(`after opening video tab ${n}, playing:`, JSON.stringify(await playing()));
  }
  log("tabs marked as paused by the limit:", JSON.stringify(await marked()));

  // Open tab 1 (paused by the limit): it resumes, and the oldest other one pauses.
  await ui.click("#tabs .tab:nth-child(1)");
  await sleep(2000);
  log("after opening tab 1 again, playing:", JSON.stringify(await playing()));
  log("tabs marked as paused by the limit:", JSON.stringify(await marked()));

  // Close a playing tab: nothing else changes.
  await ui.click("#tabs .tab:nth-child(5) .x");
  await sleep(1500);
  log("after closing tab 5, playing:", JSON.stringify(await playing()));

  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
