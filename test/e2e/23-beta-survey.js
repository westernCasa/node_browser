// Beta survey (B64, B65): local usage counts and the summary in Settings →
// Help, the one-time survey prompt after 3 days of use, and that the summary
// holds no pages, addresses or keywords.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path"), fs = require("fs"), os = require("os");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "node-e2e-"));
const BASE = "http://127.0.0.1:8765";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(ok ? "✓" : "✗", name, detail ? `(${detail})` : "");
};
const userData = fs.mkdtempSync(path.join(OUT, "ud-"));

async function launch() {
  const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")] });
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
      if (/duckduckgo|brave\.com|forms\.gle/.test(u)) return new Response("", { status: 200 });
      return o(u, opt);
    };
  });
  const ui = await app.firstWindow();
  await sleep(1500);
  return { app, ui };
}

(async () => {
  // Day 1: no prompt yet. Use NODE a little.
  let { app, ui } = await launch();
  const go = async (url) => { await ui.fill("#omni", url); await ui.press("#omni", "Enter"); await sleep(3500); };
  await go(BASE + "/article.html");
  await ui.click("#keys .key:nth-child(1) .label");
  await sleep(1500);
  await ui.click("#keys .key:nth-child(3) button");
  await sleep(1500);
  await ui.click("#results .card [data-act='open']").catch(() => {});
  await sleep(1500);
  await ui.click("#tabs .tab:nth-child(1)").catch(() => {});
  await go(BASE + "/other.html?x=1");
  await sleep(8000);
  check("no survey prompt on the first day", !/survey/i.test(await ui.textContent("#notice").catch(() => "")) || (await ui.$eval("#notice", (e) => e.hidden)));
  const summary = await ui.evaluate(() => window.scout.copyUsage());
  console.log(summary.split("\n").map((l) => "    " + l).join("\n"));
  const n = (label) => Number((summary.match(new RegExp(label + ": (\\d+)")) || [])[1] || 0);
  check("summary counts days, version and system", /Days used: 1 /.test(summary) && /Version \d+\.\d+\.\d+ · (Linux|Windows|macOS) /.test(summary));
  check("suggestions shown and opened are counted", n("Suggestions shown") >= 3 && /opened: [1-9]/.test(summary), `${n("Suggestions shown")} shown`);
  check("pins and hides are counted", n("Keywords pinned") === 1 && /hidden: 1/.test(summary));
  check("trail pages are counted", n("Trail pages") >= 2, String(n("Trail pages")));
  check("the summary holds no addresses, titles or keywords", !/127\.0\.0\.1|http|sourdough|starter|Bread Lab/i.test(summary));
  check("Copy usage summary puts it on the clipboard", (await app.evaluate(({ clipboard }) => clipboard.readText())) === summary);
  await ui.click("#menu-btn");
  await sleep(600);
  await ui.click('.mnav[data-section="help"]');
  await sleep(600);
  check("Settings → Help has the survey and the usage summary", (await ui.isVisible("#survey-open")) && (await ui.isVisible("#usage-copy")));
  await ui.click("#usage-copy");
  await sleep(300);
  check("Help says what was copied", /Copied \d+ lines/.test(await ui.textContent("#usage-state")));
  await ui.keyboard.press("Escape");
  await app.evaluate(({ app }) => app.quit());
  await sleep(1500);

  // Two more days of use, as if NODE had been opened on Oct 21 and 22.
  const file = path.join(userData, "usage.json");
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  saved.days = ["2026-10-21", "2026-10-22", ...saved.days];
  fs.writeFileSync(file, JSON.stringify(saved));

  // Day 3: the prompt appears once, with three choices.
  ({ app, ui } = await launch());
  await sleep(8500);
  const notice = await ui.evaluate(() => { const e = document.getElementById("notice"); return { shown: !e.hidden, text: e.textContent, buttons: [...e.querySelectorAll("button")].map((b) => b.textContent) }; });
  check("survey prompt after 3 days of use", notice.shown && /3 days/.test(notice.text) && /survey/i.test(notice.text), notice.text.slice(0, 80));
  check("prompt choices: Take survey, Later, Don't ask again", notice.buttons.join("|") === "Take survey|Later|Don't ask again", notice.buttons.join("|"));
  await ui.click("#notice button:has-text('Later')");
  await sleep(500);
  check("Later hides it", await ui.$eval("#notice", (e) => e.hidden));
  await app.evaluate(({ app }) => app.quit());
  await sleep(1500);

  // Same day again: Later holds until another day of use.
  ({ app, ui } = await launch());
  await sleep(8500);
  check("Later: not asked again the same day", await ui.$eval("#notice", (e) => e.hidden || !/survey/i.test(e.textContent)));
  await app.evaluate(({ app }) => app.quit());
  await sleep(1500);
  const s2 = JSON.parse(fs.readFileSync(file, "utf8"));
  s2.days = ["2026-10-20", ...s2.days];
  fs.writeFileSync(file, JSON.stringify(s2));

  // Next day: asked again; Take survey opens it in a tab and ends the prompts.
  ({ app, ui } = await launch());
  await sleep(8500);
  check("Later: asked again on the next day of use", await ui.$eval("#notice", (e) => !e.hidden && /survey/i.test(e.textContent)));
  await ui.click("#notice button:has-text('Take survey')");
  await sleep(1500);
  const urls = await app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.getURL()));
  check("Take survey opens the survey in a tab", urls.some((u) => decodeURIComponent(u).includes("forms.gle/XuMGZUzScNYPyP319")), urls.filter((u) => /forms/.test(u)).join(" "));
  await app.evaluate(({ app }) => app.quit());
  await sleep(1500);
  const s3 = JSON.parse(fs.readFileSync(file, "utf8"));
  s3.days = ["2026-10-19", ...s3.days];
  fs.writeFileSync(file, JSON.stringify(s3));
  ({ app, ui } = await launch());
  await sleep(8500);
  check("after Take survey, never asked again", await ui.$eval("#notice", (e) => e.hidden || !/survey/i.test(e.textContent)));
  await app.evaluate(({ app }) => app.quit());

  console.log(failed ? `${failed} checks failed` : "all checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
