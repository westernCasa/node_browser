// NODE Chromium build (B51): the built-in extension in Chromium 152, the
// version the NODE build is based on. Chromium 152 has no switch to load a
// component extension from a folder, so this loads it unpacked
// (--load-extension); the manifest key gives it the same fixed ID it has as a
// component in the NODE build. Checks the ID, suggestions from the page
// (shared keyword and search code), Talk, autoplay with sound and the 4-tab
// playback limit across real tabs, and center on click. That it is hidden from
// chrome://extensions and cannot be removed needs the NODE build itself.
//
// Needs a Chromium binary of the same version as the NODE base, for example
// ungoogled-chromium 152.0.7977.64 for Linux:
//   NODE_CHROMIUM=/path/to/chrome node test/e2e/22-chromium-build.js
// Build the extension first: npm run build:browser-extension
// --autoplay-policy stands in for browser/patches/0003-node-autoplay-default.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path"), fs = require("fs"), os = require("os");
const BASE = "http://127.0.0.1:8765";
const EXT = path.join(__dirname, "..", "..", "browser", "extension", "dist");
const EXT_ID = "bdcmchdlmdgddldgdgapcmipndcgpgod";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(ok ? "✓" : "✗", name, detail ? `(${detail})` : "");
};

(async () => {
  if (!process.env.NODE_CHROMIUM) throw new Error("Set NODE_CHROMIUM to a Chromium 152 binary");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "node-chromium-"));
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.NODE_CHROMIUM,
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--host-resolver-rules=MAP talk.example 127.0.0.1:8765", `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--disable-features=DisableLoadExtensionCommandLineSwitch", "--autoplay-policy=no-user-gesture-required", "--no-sandbox"],
    viewport: { width: 1200, height: 800 },
  });
  // Search and Talk answers (the network is not reachable in tests).
  await ctx.route(/wikipedia\.org\/w\/api\.php/, (route) => {
    const q = new URL(route.request().url()).searchParams.get("gsrsearch");
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ query: { pages: { 0: { index: 0, title: `Wiki: ${q}`, fullurl: `${BASE}/other.html?w=1`, extract: "stub" } } } }) });
  });
  await ctx.route(/duckduckgo\.com/, (route) => route.fulfill({ contentType: "text/html", body: `<a class="result__a" href="${BASE}/other.html?d=1">Levain guide</a><a class="result__snippet">web result</a>` }));
  await ctx.route(/hn\.algolia\.com/, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ hits: [{ objectID: "77", title: "Ask HN: why did my starter fail?", url: "http://talk.example/article.html", points: 50, num_comments: 31, author: "x", created_at_i: 1760000000 }] }) }));
  await ctx.route(/api\.bsky\.app/, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [] }) }));

  let sw = ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  check("extension loads with the fixed ID", extId === EXT_ID, extId);

  // Suggestions from the page.
  const article = await ctx.newPage();
  await article.goto(`${BASE}/article.html`);
  await sleep(1500);
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  const tabId = await panel.evaluate(async () => (await chrome.tabs.query({ url: "http://127.0.0.1:8765/article.html" }))[0].id);
  await panel.goto(`chrome-extension://${extId}/sidepanel.html?tab=${tabId}`);
  for (let i = 0; i < 40 && !/results for/.test(await panel.textContent("#suggest-status")); i++) await sleep(250);
  const keys = await panel.$$eval("#keys .key", (e) => e.map((x) => x.textContent));
  check("keywords from the page", keys.length >= 3, keys.join(" | "));
  const cards = await panel.$$eval("#results .card", (e) => e.length);
  check("search results shown", cards > 0, `${cards} cards · ${await panel.textContent("#suggest-status")}`);
  await panel.setViewportSize({ width: 360, height: 800 });
  await panel.screenshot({ path: path.join(os.tmpdir(), "node-chromium-panel.png") });

  // Talk (on a public-looking address mapped to the test server).
  await article.goto("http://talk.example/article.html");
  await sleep(1000);
  const talkTab = await panel.evaluate(async () => (await chrome.tabs.query({ url: "http://talk.example/*" }))[0].id);
  await panel.goto(`chrome-extension://${extId}/sidepanel.html?tab=${talkTab}`);
  await sleep(800);
  await panel.click("#tab-talk");
  for (let i = 0; i < 20 && !/Hacker News/.test(await panel.textContent("#talk-status")); i++) await sleep(250);
  check("Talk finds the Hacker News story", /1 on Hacker News/.test(await panel.textContent("#talk-status")), await panel.textContent("#talk-status"));

  // Autoplay with sound, and the playback limit across real tabs.
  const videos = [];
  for (let n = 1; n <= 5; n++) {
    const p = await ctx.newPage();
    await p.goto(`${BASE}/video-main.html?n=${n}`);
    videos.push(p);
    await sleep(1500);
  }
  await sleep(1500);
  const states = await Promise.all(videos.map((p) => p.evaluate(() => [...document.querySelectorAll("video")].map((v) => ({ playing: !v.paused, muted: v.muted })))));
  const playing = states.map((s) => s.some((v) => v.playing));
  check("autoplay with sound", states[4].some((v) => v.playing && !v.muted));
  check("4 of 5 video tabs play, the oldest is paused", playing.filter(Boolean).length === 4 && !playing[0], JSON.stringify(playing));

  // Center on click.
  const c = await ctx.newPage();
  await c.goto(`${BASE}/center.html`);
  await sleep(800);
  const before = await c.evaluate(() => scrollY);
  await (await c.$("img, video")).click();
  await sleep(1200);
  const after = await c.evaluate(() => scrollY);
  check("center on click", after !== before, `${before} → ${after}`);

  await ctx.close();
  console.log(failed ? `${failed} failed` : "all passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("TEST ERROR", e);
  process.exit(1);
});
