// Performance probe: how long page reading takes on a large article, how often
// it runs while the page sits idle, and whether hidden tabs are throttled.
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
  await app.evaluate(({ webContents, app: a }, ud) => {
    a.setPath("userData", ud);
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes("wikipedia.org/w/api.php")) return new Response(JSON.stringify({ query: { pages: {} } }), { status: 200 });
      return new Response("", { status: 200 });
    };
    // Count page reads: every executeJavaScript call that carries the extraction script.
    globalThis.__reads = [];
    const wrap = (wc) => {
      if (wc.__wrapped) return;
      wc.__wrapped = true;
      const orig = wc.executeJavaScript.bind(wc);
      wc.executeJavaScript = (code, g) => {
        const isRead = String(code).includes("MEDIA_EXT");
        const t0 = Date.now();
        const p = orig(code, g);
        if (isRead) p.then(() => globalThis.__reads.push({ id: wc.id, ms: Date.now() - t0, at: Date.now() })).catch(() => {});
        return p;
      };
    };
    setInterval(() => webContents.getAllWebContents().forEach(wrap), 50);
  }, userData);

  const ui = await app.firstWindow();
  await ui.waitForLoadState("domcontentloaded");
  await sleep(1500);
  await ui.fill("#omni", BASE + "/big.html");
  await ui.press("#omni", "Enter");
  await sleep(4000);

  // 1. Idle: page not scrolled, nothing selected, for 30 s.
  await app.evaluate(() => (globalThis.__reads = []));
  await sleep(30000);
  const idle = await app.evaluate(() => globalThis.__reads);
  log("page reads while idle for 30 s:", idle.length, idle.length ? `(avg ${Math.round(idle.reduce((s, r) => s + r.ms, 0) / idle.length)} ms each)` : "");

  // 1b. Scrolling still triggers a read (suggestions follow the page).
  await app.evaluate(() => (globalThis.__reads = []));
  await app.evaluate(({ webContents }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith("http") && w.getURL().includes("big.html"));
    return wc.executeJavaScript("scrollTo(0, 60000)");
  });
  await sleep(7000);
  const afterScroll = await app.evaluate(() => globalThis.__reads.length);
  log("page reads within 7 s after scrolling:", afterScroll);

  // 2. One read on the large page, timed.
  const { extractionScript } = require("../../core/page-scripts.js");
  const code = `(() => { const t0 = performance.now(); const r = ${extractionScript()}; return { ms: performance.now() - t0, text: r.text.length, heads: r.headings.length }; })()`;
  const t = await app.evaluate(async ({ webContents }, code) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith("http") && w.getURL().includes("big.html"));
    return wc.executeJavaScript(code);
  }, code);
  log(`one page read on a large article: ${t.ms.toFixed(0)} ms in the page (text ${t.text} chars, ${t.heads} headings)`);

  // 3. Hidden tab: open a second tab and check the first is hidden and throttled.
  await ui.click("#new-tab");
  await sleep(2500);
  const hidden = await app.evaluate(({ webContents, BaseWindow }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith("http") && w.getURL().includes("big.html"));
    return { throttled: wc.getBackgroundThrottling ? wc.getBackgroundThrottling() : "n/a" };
  });
  const vis = await app.evaluate(({ webContents }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith("http") && w.getURL().includes("big.html"));
    return wc.executeJavaScript("new Promise((done) => { let n = 0; const f = () => { n++; requestAnimationFrame(f); }; requestAnimationFrame(f); setTimeout(() => done({ state: document.visibilityState, frames: n }), 1000); })");
  });
  log("background tab: throttled =", hidden.throttled, "| visibility:", vis.state, "| animation frames in 1 s:", vis.frames);

  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
