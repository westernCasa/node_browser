const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path");
const fs = require("fs");
const OUT = process.argv[2] || require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "scout-e2e-"));
const BASE = "http://127.0.0.1:8765";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);

(async () => {
  const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
  const app = await electron.launch({
    executablePath: require("electron"),
    args: ["--no-sandbox", `--user-data-dir=${userData}`, require("path").join(__dirname, "..", "..")],
  });
  await app.evaluate(({}) => {
    globalThis.__fetched = [];
    const orig = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      globalThis.__fetched.push(u);
      const q = (() => { try { const x = new URL(u); return x.searchParams.get("gsrsearch") || x.searchParams.get("q"); } catch { return ""; } })();
      const link = (tag, i) => `http://127.0.0.1:8765/other.html?${tag}=${encodeURIComponent(q)}&i=${i}`;
      if (u.includes("wikipedia.org/w/api.php")) {
        const pages = {};
        for (let i = 0; i < 3; i++) pages[i] = { index: i, title: `Wiki: ${q} #${i + 1}`, fullurl: link("w", i), extract: "stub" };
        return new Response(JSON.stringify({ query: { pages } }), { status: 200 });
      }
      if (u.includes("duckduckgo.com")) return new Response("<html>anomaly-modal</html>", { status: 202 });
      if (u.includes("api.search.brave.com")) {
        const key = opts?.headers?.["X-Subscription-Token"];
        if (key !== "good-key") return new Response("", { status: 401 });
        const results = [0, 1, 2, 3].map((i) => ({ url: link("b", i), title: `Brave: ${q} #${i + 1}`, description: "stub" }));
        return new Response(JSON.stringify({ web: { results } }), { status: 200 });
      }
      return orig(url, opts);
    };
  });
  const ui = await app.firstWindow();
  await sleep(1500);
  await ui.fill("#omni", BASE + "/article.html");
  await ui.press("#omni", "Enter");
  await sleep(6000);
  log("status (DDG blocked):", await ui.textContent("#suggest-status"));
  log("sources of results:", [...new Set(await ui.$$eval("#results .card .src", (e) => e.map((x) => x.textContent.split(" ")[0].trim())))].join(","));

  const previewCount = () => app.evaluate(() => globalThis.__fetched.filter((u) => u.includes("/other.html?")).length);
  log("cards:", await ui.$$eval("#results .card", (e) => e.length), "| previews fetched before scrolling:", await previewCount());
  await ui.$eval("#rail", (r) => (r.scrollTop = r.scrollHeight));
  await sleep(2500);
  log("previews fetched after scrolling to the bottom:", await previewCount());
  await ui.$eval("#rail", (r) => (r.scrollTop = 0));

  // Sources panel: wrong key first, then the right one.
  await ui.click("#sources-btn");
  await sleep(800);
  log("sources panel visible:", await ui.$eval("#sources-pane", (e) => !e.hidden), "| DDG state:", (await ui.$$eval("#sources-list .source", (e) => e.map((x) => x.textContent))).find((t) => t.trim().startsWith("DuckDuckGo")).replace(/\s+/g, " ").slice(0, 120));
  const brave = (await ui.$$("#sources-list .source"))[1];
  await (await brave.$("input[type=checkbox]")).check();
  await (await brave.$("input[type=password]")).fill("bad-key");
  await (await brave.$("button")).click(); // Test
  await sleep(2500);
  log("Brave test with bad key:", (await (await brave.$(".state")).textContent()).trim());
  await ui.screenshot({ path: path.join(OUT, "sources.png") });
  const brave2 = (await ui.$$("#sources-list .source"))[1];
  await (await brave2.$("input[type=password]")).fill("good-key");
  await (await brave2.$("button")).click();
  await sleep(2500);
  log("Brave test with good key:", (await (await (await ui.$$("#sources-list .source"))[1].$(".state")).textContent()).trim());
  await ui.click("#sources-save");
  await sleep(6000);
  log("status after enabling Brave:", await ui.textContent("#suggest-status"));
  log("sources of results:", [...new Set(await ui.$$eval("#results .card .src", (e) => e.map((x) => x.textContent.split(" ")[0].trim())))].join(","));
  const settings = fs.readFileSync(path.join(userData, "settings.json"), "utf8");
  log("settings.json has plain key:", settings.includes("good-key"), "| encrypted field:", settings.includes("keyEnc"));
  await ui.screenshot({ path: path.join(OUT, "after-brave.png") });
  await app.close();
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
