// Phase 3 checks: Wikipedia-first results (B25) and site rules (B16).
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path");
const fs = require("fs");
const OUT = process.argv[2] || require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "scout-e2e-"));
const BASE = "http://127.0.0.1:8765";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);

(async () => {
  const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
  const rulesPath = path.join(userData, "rules.json");
  const rules = {
    rules: [
      { match: "*", autoplay: "on" },
      { name: "Test article", match: "127.0.0.1/article", popups: "block", extract: { skip: ["#p1"], include: ["#p3"] } },
      { name: "Test media, autoplay off", match: "127.0.0.1/media", autoplay: "off" },
      { name: "Test private page", match: "127.0.0.1/perm", suggest: false, mosaic: false },
    ],
  };
  fs.writeFileSync(rulesPath, JSON.stringify(rules));
  const app = await electron.launch({
    executablePath: require("electron"),
    args: ["--no-sandbox", `--user-data-dir=${userData}`, require("path").join(__dirname, "..", "..")],
  });
  await app.evaluate(() => {
    globalThis.__fetched = [];
    const orig = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      globalThis.__fetched.push(u);
      const q = (() => { try { const x = new URL(u); return x.searchParams.get("gsrsearch") || x.searchParams.get("q"); } catch { return ""; } })();
      const link = (tag, i) => `http://127.0.0.1:8765/other.html?${tag}=${encodeURIComponent(q)}&i=${i}`;
      if (u.includes("wikipedia.org/w/api.php")) {
        const pages = {};
        for (let i = 0; i < 2; i++) pages[i] = { index: i, title: `Wiki: ${q} #${i + 1}`, fullurl: link("w", i), extract: "stub", thumbnail: { source: "http://127.0.0.1:8765/img/IMG_2041.jpg" } };
        return new Response(JSON.stringify({ query: { pages } }), { status: 200 });
      }
      if (u.includes("duckduckgo.com")) {
        await new Promise((r) => setTimeout(r, 3000)); // slow web search
        return new Response([0, 1].map((i) => `<a class="result__a" href="${link("d", i)}">Web: ${q} #${i + 1}</a><a class="result__snippet">s</a>`).join(""), { status: 200 });
      }
      return orig(url, opts);
    };
  });
  const ui = await app.firstWindow();
  await sleep(1500);
  const go = async (url) => { await ui.fill("#omni", url); await ui.press("#omni", "Enter"); };

  // B25: Wikipedia first.
  await go(BASE + "/article.html");
  const t0 = Date.now();
  let firstAt = 0, firstStatus = "";
  while (Date.now() - t0 < 15000) {
    const st = await ui.textContent("#suggest-status");
    if (!firstAt && st.includes("loading web results")) { firstAt = Date.now() - t0; firstStatus = st; }
    if (/^\d+ results/.test(st)) { log(`Wikipedia results shown after ${firstAt} ms ("${firstStatus}")`); log(`full results after ${Date.now() - t0} ms: ${st}`); break; }
    await sleep(100);
  }
  log("sources in final list:", [...new Set(await ui.$$eval("#results .card .src", (e) => e.map((x) => x.textContent.split(" ")[0].trim())))].join(","));

  // B16: extraction rule (skip #p1, include #p3) and rule line.
  log("keywords with rule:", (await ui.$$eval("#keys .key", (els) => els.map((e) => e.textContent.replace("×", "").trim()))).join(" | "));
  log("rule line:", await ui.textContent("#rule-line"));
  log("popup blocked by rule even after a click? notice:", (await ui.textContent("#notice")).slice(0, 60));

  // Popups "block": a real click on the target=_blank link must not open a tab.
  const click = async (sel) => app.evaluate(async ({ BrowserWindow }, sel) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children.at(-1);
    const r = await v.webContents.executeJavaScript(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return {x: b.x + 5, y: b.y + 5}; })()`);
    v.webContents.sendInputEvent({ type: "mouseDown", x: Math.round(r.x), y: Math.round(r.y), button: "left", clickCount: 1 });
    v.webContents.sendInputEvent({ type: "mouseUp", x: Math.round(r.x), y: Math.round(r.y), button: "left", clickCount: 1 });
  }, sel);
  const nTabs = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length);
  await click("#pop");
  await sleep(1500);
  log("tabs after clicking a target=_blank link with popups=block:", await nTabs());

  // B16: autoplay off.
  await go(BASE + "/media.html");
  await sleep(3000);
  const paused = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.executeJavaScript("document.getElementById('a').paused"));
  log("media page with autoplay=off, audio paused:", await paused());

  // B16: suggest=false.
  await go(BASE + "/perm.html");
  await sleep(3000);
  log("private page status:", await ui.textContent("#suggest-status"), "| chips:", await ui.$$eval("#keys .key", (e) => e.length));

  // B16: live reload. Change media rule to autoplay on, reload the page.
  rules.rules[2].autoplay = "on";
  fs.writeFileSync(rulesPath, JSON.stringify(rules));
  await sleep(1200);
  await go(BASE + "/media.html");
  await sleep(3000);
  log("after editing rules.json to autoplay=on, audio paused:", await paused());

  // Broken file keeps the previous rules and reports it.
  fs.writeFileSync(rulesPath, "{ broken");
  await sleep(1500);
  log("notice after saving a broken rules file:", (await ui.textContent("#notice")).slice(0, 140));
  await ui.evaluate(() => document.querySelector('#sources-btn').click()); // in the menu overlay or the hidden Capture actions
  await sleep(800);
  await ui.screenshot({ path: path.join(OUT, "settings.png") });
  await app.close();
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
