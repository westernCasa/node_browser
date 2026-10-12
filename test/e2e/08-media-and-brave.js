// Plays the main media right away, catches late and single-page players,
// leaves media the user paused, and Brave Search as the default.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path");
const fs = require("fs");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(require("os").tmpdir(), "scout-e2e-"));
const BASE = "http://127.0.0.1:8765";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);

(async () => {
  const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
  // Settings saved by an older version, with Brave switched off.
  fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ providers: { brave: { enabled: false }, ddg: { enabled: true } } }));
  const app = await electron.launch({
    executablePath: require("electron"),
    args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
  });
  await app.evaluate(({ app: a, webContents, session }, ud) => {
    a.setPath("userData", ud);
    // A slow image keeps the video page loading for 8 s.
    session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://127.0.0.1/slow.jpg*"] }, (_d, cb) => setTimeout(() => cb({ cancel: true }), 8000));
    globalThis.fetch = async (url) => {
      if (String(url).includes("wikipedia.org/w/api.php")) return new Response(JSON.stringify({ query: { pages: {} } }), { status: 200 });
      return new Response("", { status: 200 });
    };
    globalThis.__navs = [];
    const seen = new Set();
    setInterval(() => {
      for (const wc of webContents.getAllWebContents()) {
        if (seen.has(wc.id)) continue;
        seen.add(wc.id);
        wc.on("did-start-navigation", (d) => d.isMainFrame && globalThis.__navs.push(d.url));
      }
    }, 50);
  }, userData);

  const ui = await app.firstWindow();
  await ui.waitForLoadState("domcontentloaded");
  await sleep(1500);

  const page = (code) =>
    app.evaluate(({ webContents }, code) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith("http://127.0.0.1:8765"));
      return wc ? wc.executeJavaScript(code) : null;
    }, code);
  const loading = () =>
    app.evaluate(({ webContents }) => webContents.getAllWebContents().find((w) => w.getURL().startsWith("http://127.0.0.1:8765"))?.isLoading());
  const state = (id) => page(`(() => { const v = document.getElementById(${JSON.stringify(id)}); return v ? { playing: !v.paused, muted: v.muted } : null; })()`);

  // Brave: default on, old settings migrated, one-time notice, address bar.
  const settings = await ui.evaluate(() => window.scout.getSettings());
  log("Brave source on by default (old settings had it off):", settings.providers.brave.enabled);
  log("first-run notice:", (await ui.textContent("#notice")).trim().slice(0, 70));
  const status = await ui.evaluate(() => window.scout.searchStatus());
  log("Brave without a key, Settings says:", status.find((s) => s.id === "brave").setupHint.slice(0, 60) + "…");
  await ui.fill("#omni", "sourdough starter");
  await ui.press("#omni", "Enter");
  await sleep(1500);
  log("address-bar search goes to:", (await app.evaluate(() => globalThis.__navs)).find((u) => u.includes("sourdough")));

  // 1. Main video plays while the page is still loading; the small one does not.
  await ui.fill("#omni", BASE + "/video-main.html");
  await ui.press("#omni", "Enter");
  await sleep(2500);
  log("page still loading (slow image):", await loading());
  log("large video:", JSON.stringify(await state("big")), "| small video:", JSON.stringify(await state("small")));

  // 2. User pauses it: it stays paused, also after the page finishes loading.
  await page(`document.getElementById("big").pause()`);
  await sleep(7000);
  log("after the user paused it, and after the page finished loading:", "loading", await loading(), JSON.stringify(await state("big")));

  // 3. Player added by a script 1.5 s after load.
  await ui.fill("#omni", BASE + "/video-late.html");
  await ui.press("#omni", "Enter");
  await sleep(3500);
  log("player added by script:", JSON.stringify(await state("late")));

  // 4. Single-page navigation (address changes without a load) with a new player.
  await page("spa()");
  await sleep(2500);
  log("after single-page navigation, new player:", JSON.stringify(await state("next")));

  // 5. Media keeps playing (muted) in a background tab.
  await page(`document.getElementById("next").play()`);
  await ui.click("#new-tab");
  await sleep(3000);
  const bg = await page(`(() => { const v = document.getElementById("next"); return { playing: !v.paused, time: Math.round(v.currentTime * 10) / 10 }; })()`);
  await sleep(1000);
  const bg2 = await page(`Math.round(document.getElementById("next").currentTime * 10) / 10`);
  const tabMuted = await app.evaluate(({ webContents }) => webContents.getAllWebContents().find((w) => w.getURL().includes("video-late"))?.isAudioMuted());
  log("background tab video:", JSON.stringify(bg), "| one second later at", bg2, "s | tab muted:", tabMuted);

  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
