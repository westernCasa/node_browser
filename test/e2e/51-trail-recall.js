// Find things in past trails by what you remember (B89): an "In your trails"
// group in the CommandBar and in the canvas search bar's list. Picking a
// result switches to its trail and shows its card, or its timeline row when
// it never became a card. Words like "after", "yesterday" and "video" are
// read locally (core/recall.js).
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
    globalThis.fetch = async (u, opt) => (/wikipedia|duckduckgo|brave\.com|x\.ai|11434/.test(String(u)) ? new Response("{}", { status: 200 }) : o(u, opt));
  });
  const ui = await app.firstWindow();
  await sleep(1800);
  const menuItem = (label) => app.evaluate(({ Menu }, l) => Menu.getApplicationMenu().items.flatMap((m) => m.submenu?.items || []).find((i) => i.label === l).click(), label);
  const current = () => ui.evaluate(() => window.scout.trailList().then((l) => l.find((t) => t.current)?.name));

  // Trail 1: the encyclopedia page, then the article (both cards), and a
  // quick look that stays in the timeline.
  await ui.evaluate(() => window.scout.trailRename("Reading list"));
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/seealso.html`);
  await sleep(1500);
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/article.html`);
  await sleep(1500);
  const tabId = await ui.evaluate(() => activeId);
  await ui.evaluate(([id, u]) => window.scout.navigate(id, u), [tabId, `${BASE}/other.html?n=quick`]);
  await sleep(2500);
  await ui.evaluate(([id, u]) => window.scout.navigate(id, u), [tabId, `${BASE}/article.html`]);
  await sleep(1500);
  // Trail 2: another trail, so the first one's open pages become cards (B104).
  await ui.evaluate(() => window.scout.researchNew("Elsewhere"));
  await sleep(2000);
  check("now on another trail", (await current()) === "Elsewhere");

  // CommandBar: "after memex" finds the article in the other trail.
  await menuItem("Open Location");
  await sleep(700);
  await ui.fill("#cmd-input", "after the memex page");
  await sleep(900);
  const groups = await ui.$$eval("#cmd-list *", (els) => els.filter((e) => e.textContent === "In your trails" && !e.querySelector("*")).length);
  const rows = await ui.$$eval("#cmd-list .cmd-row", (r) => r.map((x) => ({ id: x.id, t: x.querySelector(".t")?.textContent || x.textContent })));
  const hit = rows.find((r) => /Why sourdough starters fail/.test(r.t));
  check("the CommandBar has an “In your trails” group", groups >= 1, JSON.stringify(rows.map((r) => r.t)));
  check("“after the memex page” finds the page that came next", Boolean(hit) && /after “Memex/.test(hit.t) && /Reading list/.test(hit.t), hit?.t);
  await ui.screenshot({ path: path.join(OUT, "51-cmdbar.png") });
  await ui.click(`#${hit.id}`);
  let ring = false;
  for (let i = 0; i < 20 && !ring; i++) {
    await sleep(100);
    ring = await ui.evaluate(() => Boolean(document.querySelector("#canvas .cv-card.found")));
  }
  await ui.screenshot({ path: path.join(OUT, "51-card.png") });
  await sleep(1500);
  check("picking it switches to its trail", (await current()) === "Reading list", await current());
  const sel = await ui.evaluate(() => ({ shown: !canvasEl.hidden, sel: trailCanvas?.selected, title: trailCanvas?.data?.cards.find((c) => c.id === trailCanvas.selected)?.title }));
  check("and shows its card, selected, on the canvas", sel.shown && /Why sourdough starters fail/.test(sel.title || ""), JSON.stringify(sel));
  check("the card gets a ring for a moment", ring);

  // Canvas search bar, from the other trail again.
  await ui.evaluate(() => window.scout.trailList().then((l) => goTrail(l.find((t) => t.name === "Elsewhere").id)));
  await sleep(1500);
  await ui.evaluate(() => trailCanvas.focusSearch());
  await ui.keyboard.type("memex today");
  await sleep(1200);
  const drop = await ui.evaluate(() => ({ head: document.querySelector("#canvas .cv-drop-head")?.textContent, rows: [...document.querySelectorAll("#canvas .cv-drop-row.recall")].map((r) => r.textContent) }));
  check("the canvas search list has “In your trails” too", drop.head === "In your trails" && drop.rows.some((t) => /Memex/.test(t) && /today · Reading list/.test(t)), JSON.stringify(drop));
  check("the web search choices stay first", await ui.evaluate(() => document.querySelector("#canvas .cv-drop-row .nm")?.textContent.startsWith("Search the web")));
  await ui.screenshot({ path: path.join(OUT, "51-canvas-search.png") });
  await ui.evaluate(() => [...document.querySelectorAll("#canvas .cv-drop-row.recall")].find((r) => /Memex/.test(r.textContent)).click());
  await sleep(2000);
  check("picking it from the canvas goes to its card", (await current()) === "Reading list" && /Memex/.test(await ui.evaluate(() => trailCanvas.data.cards.find((c) => c.id === trailCanvas.selected)?.title || "")));

  // A page that stayed in the timeline: its row is shown and marked.
  await ui.evaluate(() => window.scout.trailList().then((l) => goTrail(l.find((t) => t.name === "Elsewhere").id)));
  await sleep(1500);
  const quick = await ui.evaluate(() => window.scout.trailRecall("levain guide"));
  check("a timeline-only page can be found", quick.length && quick[0].timelineOnly && quick[0].trailName === "Reading list", JSON.stringify(quick[0]));
  await ui.evaluate((r) => goRecall(r), quick[0]);
  await sleep(1800);
  const row = await ui.evaluate(() => {
    const r = document.querySelector("#sb-timeline-list .sb-tl-row.found");
    return r ? { text: r.textContent, focused: document.activeElement === r } : null;
  });
  check("picking it marks its row in the timeline", (await current()) === "Reading list" && row && /Levain guide/.test(row.text) && row.focused, JSON.stringify(row));
  await ui.screenshot({ path: path.join(OUT, "51-timeline.png") });

  // Words that say nothing, and addresses, find nothing in trails.
  check("words that say nothing find nothing", (await ui.evaluate(() => window.scout.trailRecall("the page"))).length === 0);
  check("short text finds nothing", (await ui.evaluate(() => window.scout.trailRecall("a"))).length === 0);

  await app.close();
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
