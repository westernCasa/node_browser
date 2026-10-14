// Talk (social layer stage 1): nothing is looked up until Talk is opened,
// Hacker News and Bluesky rows for the page, a source failing, private and
// sign-in pages, follows the active tab while open, quiet once closed.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path"), fs = require("fs");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(require("os").tmpdir(), "scout-e2e-"));
const SITE = "http://talk.example"; // mapped to the local test server
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);
(async () => {
  const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
  const app = await electron.launch({
    executablePath: require("electron"),
    args: ["--no-sandbox", "--host-resolver-rules=MAP talk.example 127.0.0.1:8765", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")],
  });
  await app.evaluate(() => {
    const real = globalThis.fetch;
    globalThis.__talk = [];
    globalThis.__bskyDown = false;
    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes("hn.algolia.com")) {
        globalThis.__talk.push(u);
        const page = new URL(u).searchParams.get("query");
        const hits = page.endsWith("/article.html") ? [{ objectID: "9001", title: "Why sourdough starters fail", url: page + "?utm_source=hn", points: 210, num_comments: 87, author: "baker", created_at_i: Math.floor(Date.now() / 1000) - 86400 * 3 }] : [];
        return new Response(JSON.stringify({ hits }), { status: 200 });
      }
      if (u.includes("api.bsky.app")) {
        globalThis.__talk.push(u);
        if (globalThis.__bskyDown) return new Response("{}", { status: 403 });
        return new Response(JSON.stringify({ posts: [{ uri: "at://did:plc:x/app.bsky.feed.post/3abc", author: { handle: "crumb.bsky.social", displayName: "Crumb" }, record: { text: "Temperature really is everything with starters" }, likeCount: 8, replyCount: 2, indexedAt: new Date().toISOString() }] }), { status: 200 });
      }
      if (/wikipedia|duckduckgo/.test(u)) return new Response("{}", { status: 200 });
      return real(url, opts);
    };
  });
  const ui = await app.firstWindow();
  await sleep(1500);
  const go = async (u) => {
    await ui.fill("#omni", u);
    await ui.press("#omni", "Enter");
    await sleep(2500);
  };
  const lookups = () => app.evaluate(() => globalThis.__talk.length);

  await go(SITE + "/article.html");
  await go(SITE + "/other.html");
  log("lookups before Talk is opened:", await lookups());

  await go(SITE + "/article.html");
  await ui.click("#talk-btn");
  await sleep(1500);
  log("status:", await ui.textContent("#talk-status"));
  log("rows:", (await ui.$$eval("#talk-list .talk-item", (e) => e.map((x) => x.textContent.replace(/\s+/g, " ").trim()))).join(" | "));
  const sent = await app.evaluate(() => globalThis.__talk.map((u) => decodeURIComponent(u)));
  log("address sent (tracking-free, no fragment):", sent.every((u) => !u.includes("#")), "|", sent[0].replace(/^.*query=([^&]*).*$/, "$1"));
  await ui.screenshot({ path: path.join(OUT, "talk.png") });

  await ui.click("#talk-list .talk-item");
  await sleep(1000);
  log("click opens:", await app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.getURL()).find((u) => u.includes("ycombinator")) || "nothing"));

  // Follows the active tab while open; Bluesky failing leaves Hacker News.
  await app.evaluate(() => (globalThis.__bskyDown = true));
  await ui.evaluate(() => document.querySelector("#tabs .tab").click());
  await sleep(500);
  await go(SITE + "/other.html");
  await sleep(1200);
  log("after going to another page:", await ui.textContent("#talk-status"), "| bluesky note:", await ui.$eval("#talk-list .bad", (e) => e.textContent).catch(() => "none"));

  // Pages never looked up.
  const before = await lookups();
  await go(SITE + "/members/login.html");
  await sleep(800);
  log("sign-in page:", await ui.textContent("#talk-status"), "| lookups:", (await lookups()) - before);
  await go("http://127.0.0.1:8765/article.html");
  await sleep(800);
  log("local address:", await ui.textContent("#talk-status"));

  // Closed: navigation sends nothing.
  await ui.click("#talk-back");
  const closed = await lookups();
  await go(SITE + "/article.html");
  await go(SITE + "/other.html");
  log("lookups after closing Talk:", (await lookups()) - closed);
  process.exit(0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
