// Engine test (B51 step 1): NODE's features as a Chromium extension, loaded
// into Playwright's Chromium. Checks suggestions from the page (shared
// keyword and search code), autoplay and the 4-tab playback limit across real
// browser tabs, center on click, and Talk.
// Build first: npm run build:chromium
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path"), fs = require("fs"), os = require("os");
const BASE = "http://127.0.0.1:8765";
const EXT = path.join(__dirname, "..", "..", "chromium", "dist");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "node-ext-"));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: ["--host-resolver-rules=MAP talk.example 127.0.0.1:8765", `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--autoplay-policy=no-user-gesture-required", "--no-sandbox"],
    viewport: { width: 1200, height: 800 },
  });
  // Search and Talk answers (the network is not reachable here).
  await ctx.route(/wikipedia\.org\/w\/api\.php/, (route) => {
    const q = new URL(route.request().url()).searchParams.get("gsrsearch");
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ query: { pages: { 0: { index: 0, title: `Wiki: ${q}`, fullurl: `${BASE}/other.html?w=1`, extract: "stub" } } } }) });
  });
  await ctx.route(/duckduckgo\.com/, (route) => route.fulfill({ contentType: "text/html", body: `<a class="result__a" href="${BASE}/other.html?d=1">Levain guide</a><a class="result__snippet">web result</a>` }));
  await ctx.route(/hn\.algolia\.com/, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ hits: [{ objectID: "77", title: "Ask HN: why did my starter fail?", url: "http://talk.example/article.html", points: 50, num_comments: 31, author: "x", created_at_i: 1760000000 }] }) }));
  await ctx.route(/api\.bsky\.app/, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ posts: [] }) }));

  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker");
  const extId = new URL(sw.url()).host;
  log("extension loaded:", extId.length === 32, "| service worker:", sw.url().split("/").pop());

  // Suggestions from the page.
  const article = await ctx.newPage();
  await article.goto(`${BASE}/article.html`);
  await sleep(1500);
  const panel = await ctx.newPage();
  const tabId = await (async () => {
    await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
    return panel.evaluate(async () => (await chrome.tabs.query({ url: "http://127.0.0.1:8765/article.html" }))[0].id);
  })();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html?tab=${tabId}`);
  for (let i = 0; i < 40 && !/results for/.test(await panel.textContent("#suggest-status")); i++) await sleep(250);
  log("keywords:", (await panel.$$eval("#keys .key", (e) => e.map((x) => x.textContent))).join(" | "));
  log("status:", await panel.textContent("#suggest-status"));
  log("result cards:", await panel.$$eval("#results .card", (e) => e.length));
  await panel.setViewportSize({ width: 360, height: 800 });
  await panel.screenshot({ path: path.join(os.tmpdir(), "node-ext-panel.png") });

  // Talk (on a public-looking address mapped to the test server).
  await article.goto("http://talk.example/article.html");
  await sleep(1000);
  const talkTab = await panel.evaluate(async () => (await chrome.tabs.query({ url: "http://talk.example/*" }))[0].id);
  await panel.goto(`chrome-extension://${extId}/sidepanel.html?tab=${talkTab}`);
  await sleep(800);
  await panel.click("#tab-talk");
  await sleep(1000);
  log("talk:", await panel.textContent("#talk-status"), "|", (await panel.$$eval("#talk-list .talk-item", (e) => e.map((x) => x.textContent.replace(/\s+/g, " ").trim()))).join(" | "));

  // Autoplay and the playback limit across real tabs.
  const videos = [];
  for (let n = 1; n <= 5; n++) {
    const p = await ctx.newPage();
    await p.goto(`${BASE}/video-main.html?n=${n}`);
    videos.push(p);
    await sleep(1500);
  }
  await sleep(1500);
  const states = await Promise.all(videos.map((p) => p.evaluate(() => [...document.querySelectorAll("video")].some((v) => !v.paused))));
  log("video tabs playing:", JSON.stringify(states), "| playing count:", states.filter(Boolean).length);

  // Center on click.
  const c = await ctx.newPage();
  await c.goto(`${BASE}/center.html`);
  await sleep(800);
  const before = await c.evaluate(() => scrollY);
  const target = await c.$("img, video");
  await target.click();
  await sleep(1200);
  log("center on click: scrolled from", before, "to", await c.evaluate(() => scrollY));

  await ctx.close();
  process.exit(0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
