// B17 checks: trail, pins persistence across restart, dismiss, read badge, export, new session.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path"), fs = require("fs");
const OUT = process.argv[2] || require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "scout-e2e-")), BASE = "http://127.0.0.1:8765";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);
const userData = fs.mkdtempSync(path.join(OUT, "ud-"));

async function launch() {
  const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, require("path").join(__dirname, "..", "..")] });
  await app.evaluate(() => {
    const o = globalThis.fetch;
    globalThis.fetch = async (u, opt) => {
      u = String(u);
      const q = (() => { try { const x = new URL(u); return x.searchParams.get("gsrsearch") || x.searchParams.get("q"); } catch { return ""; } })();
      if (u.includes("wikipedia.org/w/api.php")) {
        const pages = {};
        for (let i = 0; i < 3; i++) pages[i] = { index: i, title: `Wiki ${i + 1}: ${q}`, fullurl: `http://127.0.0.1:8765/other.html?w=${i}`, extract: "stub" };
        return new Response(JSON.stringify({ query: { pages } }), { status: 200 });
      }
      if (u.includes("duckduckgo")) return new Response("", { status: 200 });
      return o(u, opt);
    };
  });
  const ui = await app.firstWindow();
  await sleep(1500);
  return { app, ui };
}

(async () => {
  let { app, ui } = await launch();
  const go = async (url) => { await ui.fill("#omni", url); await ui.press("#omni", "Enter"); await sleep(3500); };
  await go(BASE + "/article.html");
  await ui.click("#keys .key:nth-child(1)"); // pin first keyword
  await sleep(2500);
  log("pinned:", (await ui.$$eval("#keys .key.pinned", (e) => e.map((x) => x.textContent.replace("×", "").trim()))).join(", "));
  await go(BASE + "/media.html");
  await go(BASE + "/other.html?x=1");

  // Dismiss the first card, open the second.
  const firstUrl = await ui.$eval("#results .card", (c) => c.dataset.url);
  await ui.click("#results .card .dismiss");
  await sleep(300);
  log("dismissed card gone:", !(await ui.$$eval("#results .card", (cs) => cs.map((c) => c.dataset.url))).includes(firstUrl));
  await ui.click("#results .card [data-act='open']");
  await sleep(2000);
  await ui.click("#tabs .tab:nth-child(1)");
  await sleep(500);
  await ui.click("#refresh-suggest");
  await sleep(3500);
  const urls = await ui.$$eval("#results .card", (cs) => cs.map((c) => ({ u: c.dataset.url, read: c.classList.contains("read") })));
  log("dismissed result stays hidden after a new search:", !urls.some((x) => x.u === firstUrl), "| cards marked read:", urls.filter((x) => x.read).length);

  // A screenshot taken now goes in the trail, under the page it was taken on.
  await ui.click("#shot-btn");
  await sleep(1500);
  await ui.evaluate(() => closeLibrary?.()).catch(() => {});
  await sleep(500);
  await ui.click("#trail-btn");
  await sleep(1000);
  const caps = await ui.$$eval("#trail-list .cap img", (e) => e.map((x) => x.naturalWidth));
  log("captures in the trail:", caps.length, "| image loads:", caps.every((w) => w > 0));
  log("trail pages:", (await ui.$$eval("#trail-list .trail-row .t", (e) => e.map((x) => x.textContent))).join(" | "));
  log("recurring keywords:", (await ui.$$eval("#threads .key", (e) => e.map((x) => x.textContent))).join(" | "));
  log("session meta:", await ui.textContent("#session-meta"));
  await ui.fill("#session-name", "Sourdough starters");
  await sleep(800);
  await ui.click("#session-export");
  await sleep(800);
  const saves = fs.readdirSync(path.join(userData, "library", "saves")).filter((f) => f.endsWith(".md"));
  log("exported:", saves.join(", "));
  log("export lists the capture:", /## Captures[\s\S]*Screenshot: shot-/.test(fs.readFileSync(path.join(userData, "library", "saves", saves[0]), "utf8")));
  log("export first lines:", fs.readFileSync(path.join(userData, "library", "saves", saves[0]), "utf8").split("\n").slice(0, 3).join(" / "));
  await ui.screenshot({ path: path.join(OUT, "trail.png") });
  await app.evaluate(({ app }) => app.quit());
  await sleep(1500);

  // Restart: pins and session come back.
  ({ app, ui } = await launch());
  await sleep(1000);
  log("after restart, pinned:", (await ui.$$eval("#keys .key.pinned", (e) => e.map((x) => x.textContent.replace("×", "").trim()))).join(", "));
  await ui.click("#trail-btn");
  await sleep(800);
  log("after restart, session:", await ui.inputValue("#session-name"), "|", (await ui.$$eval("#trail-list .trail-row", (e) => e.length)), "pages");
  await ui.click("#session-new");
  await sleep(800);
  log("new session: pinned", await ui.$$eval("#keys .key.pinned", (e) => e.length), "| sessions in list:", (await ui.$$eval("#session-select option", (e) => e.map((x) => x.textContent))).join(" | "));
  process.exit(0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
