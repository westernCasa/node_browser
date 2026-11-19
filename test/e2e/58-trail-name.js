// Trail names (B128): a new trail, still on its default name, takes its name
// from its first search, or else from the title of its first page (without
// the site's name). Once only; a name the person typed is never replaced;
// private tabs never name a trail.
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
fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ firstRunDone: true }));

(async () => {
  const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")] });
  await app.evaluate(() => {
    const o = globalThis.fetch;
    globalThis.fetch = async (u, opt) => (/wikipedia|duckduckgo|brave\.com/.test(String(u)) ? new Response("{}", { status: 200 }) : o(u, opt));
  });
  const ui = await app.firstWindow();
  await sleep(1800);
  const current = () => ui.evaluate(() => window.scout.trailList().then((l) => l.find((t) => t.current)));
  const header = () => ui.evaluate(() => document.getElementById("sb-switch-title").textContent);

  // A new trail named by its first page.
  await ui.evaluate(() => window.scout.trailNew());
  await sleep(800);
  const fresh = (await current()).name;
  check("a new trail starts on its default name", /^Research /.test(fresh), fresh);
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/article.html`);
  await sleep(4000);
  let t = await current();
  check("its first page names it, without the site's name", t.name === "Why sourdough starters fail", t.name);
  check("the sidebar shows the new name", (await header()).toLowerCase() === "why sourdough starters fail", await header());
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/other.html`);
  await sleep(4000);
  check("the next page doesn't rename it", (await current()).name === "Why sourdough starters fail", (await current()).name);
  await ui.evaluate(() => window.scout.researchVisit("http://127.0.0.1:8765/paper.html", "Paper", []));
  await sleep(600);
  check("nor does a later save of the trail put the old name back", (await current()).name === "Why sourdough starters fail", (await current()).name);

  // A new trail named by its first search.
  await ui.evaluate(() => window.scout.trailNew());
  await sleep(800);
  await ui.evaluate(() => window.scout.trailSearch("levain hydration"));
  await sleep(1500);
  t = await current();
  check("a first search names a new trail", t.name === "levain hydration", t.name);
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/article.html`);
  await sleep(4000);
  check("and a page after it doesn't", (await current()).name === "levain hydration", (await current()).name);

  // A name the person typed stays.
  await ui.evaluate(() => window.scout.trailNew("Rye experiments"));
  await sleep(800);
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/other.html`);
  await sleep(4000);
  check("a trail made with a name keeps it", (await current()).name === "Rye experiments", (await current()).name);
  await ui.evaluate(() => window.scout.trailNew());
  await sleep(800);
  await ui.evaluate(() => window.scout.trailRename("My topic"));
  await sleep(400);
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/other.html`);
  await sleep(4000);
  check("a trail renamed before its first page keeps that name", (await current()).name === "My topic", (await current()).name);

  // Private tabs never name a trail.
  await ui.evaluate(() => window.scout.trailNew());
  await sleep(800);
  const before = (await current()).name;
  await ui.evaluate(() => window.scout.privateTab());
  await sleep(1000);
  const priv = await app.evaluate(({ webContents }) => webContents.getAllWebContents().find((w) => /private\.html/.test(w.getURL()))?.id);
  if (priv) await app.evaluate(({ webContents }, [id, u]) => webContents.fromId(id).loadURL(u), [priv, `${BASE}/article.html`]);
  await sleep(4000);
  check("a private tab doesn't name the trail", (await current()).name === before, (await current()).name);
  await ui.screenshot({ path: path.join(OUT, "58-trail-name.png") });

  await app.close();
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
