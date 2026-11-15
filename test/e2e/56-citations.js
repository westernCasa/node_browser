// Citations (B91): a page that becomes a card is read for its citation tags
// (authors, date, DOI, journal); "Export citations…" in a trail's … menu
// saves the trail's page cards as BibTeX or CSL-JSON. The details go in the
// trail file and come back when it is opened. Sign-in pages never go in.
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
  const notice = () => ui.evaluate(() => (document.getElementById("notice").hidden ? "" : document.querySelector("#notice > div")?.textContent || ""));
  const cards = async () => (await ui.evaluate(() => window.scout.trailGet())).cards;
  const cardOf = async (re) => (await cards()).find((c) => c.kind === "page" && re.test(c.url));
  const put = async (url) => {
    await ui.evaluate((u) => window.scout.createTab(u), url);
    await sleep(1500);
    await ui.evaluate((u) => window.scout.trailPlace({ url: u }), url);
    await sleep(1200);
  };
  await ui.evaluate(() => window.scout.trailRename("Rye & acids"));

  // A journal article page and a plain page become cards.
  await put(`${BASE}/paper.html?utm_source=newsletter`);
  const paper = await cardOf(/paper\.html/);
  const c = paper?.cite || {};
  check("a page with citation tags: its card keeps the details", c.type === "article-journal" && c.doi === "10.1016/j.jcs.2024.01.002" && c.date === "2024-03-01" && c.container === "Journal of Cereal Science" && c.pages === "45-67", JSON.stringify(c));
  check("authors, as family and given names", JSON.stringify(c.authors) === JSON.stringify([{ family: "Smith", given: "Jane" }, { family: "Pérez", given: "Ana María" }]), JSON.stringify(c.authors));
  await put(`${BASE}/article.html`);
  const plain = await cardOf(/article\.html/);
  check("a page with no citation tags is a web page", plain?.cite?.type === "webpage", JSON.stringify(plain?.cite));
  await put(`${BASE}/login.html`);
  check("a sign-in page never becomes a card", !(await cardOf(/login\.html/)));

  // The trail's … menu: Export citations…
  await ui.click("#sb-switch-name");
  await sleep(300);
  await ui.evaluate(() => [...document.querySelectorAll("#sb-switch-menu .sb-menu-row")].find((r) => r.querySelector(".nm").textContent === "Rye & acids").querySelector(".sb-menu-more").click());
  await sleep(300);
  const chips = await ui.evaluate(() => [...document.querySelectorAll("#sb-switch-menu .sb-menu-acts .chip")].map((b) => b.textContent));
  check("the … menu has Export citations…", chips.includes("Export citations…"), chips.join());
  await ui.screenshot({ path: path.join(OUT, "56-menu.png") });
  const bib = path.join(OUT, "Rye.bib");
  await app.evaluate((_e, f) => global.nodeTest.setCitationSavePath(f), bib);
  await ui.evaluate(() => [...document.querySelectorAll("#sb-switch-menu .sb-menu-acts .chip")].find((b) => b.textContent === "Export citations…").click());
  await sleep(1200);
  const bt = fs.existsSync(bib) ? fs.readFileSync(bib, "utf8") : "";
  check("it saves BibTeX: the article as @article with its details", /^@article\{smith2024lactic,/.test(bt) && bt.includes("author = {Smith, Jane and Pérez, Ana María}") && bt.includes("journal = {Journal of Cereal Science}") && bt.includes("doi = {10.1016/j.jcs.2024.01.002}") && bt.includes("pages = {45--67}"), bt.slice(0, 300));
  check("the plain page as @online with its address and date accessed", /@online\{\w+,\n  title = \{\{Why sourdough starters fail \| Bread Lab\}\},\n  url = \{http:\/\/127\.0\.0\.1:8765\/article\.html\},\n  urldate = \{\d{4}-\d\d-\d\d\}/.test(bt), bt.slice(bt.indexOf("@online"), bt.indexOf("@online") + 250));
  check("tracking codes and sign-in pages left out; the trail named in a note", !bt.includes("utm_") && !bt.includes("login") && bt.includes("note = {From the NODE trail ``Rye \\& acids''}"));
  const said = await notice();
  const shown = await ui.evaluate(() => [...document.querySelectorAll("#notice button")].map((b) => b.textContent));
  check("a notice says how many, with Show in folder", said === "Exported 2 citations as BibTeX." && shown.includes("Show in folder"), `${said} ${shown}`);
  const json = path.join(OUT, "Rye.json");
  await app.evaluate((_e, f) => global.nodeTest.setCitationSavePath(f), json);
  const r = await ui.evaluate(() => window.scout.trailExportCitations());
  let items = [];
  try {
    items = JSON.parse(fs.readFileSync(json, "utf8"));
  } catch (_) {}
  check("a .json name saves CSL-JSON, as Zotero reads it", r.ok && r.format === "csl-json" && items.length === 2 && items[0].type === "article-journal" && items[0].DOI === "10.1016/j.jcs.2024.01.002" && JSON.stringify(items[0].issued) === '{"date-parts":[[2024,3,1]]}' && items[1].type === "webpage" && Array.isArray(items[1].accessed["date-parts"][0]), JSON.stringify(items).slice(0, 300));

  // The trail file carries the details; an opened file can be cited too.
  const file = path.join(OUT, "Rye.trail.md");
  await app.evaluate((_e, f) => global.nodeTest.setTrailSavePath(f), file);
  await ui.evaluate(() => window.scout.trailShareSave({}));
  const md = fs.readFileSync(file, "utf8");
  check("the trail file has a Cite line on the article's card", md.includes("Cite: article-journal · by Smith, Jane; Pérez, Ana María · 2024-03-01 · in Journal of Cereal Science · volume 12 · issue 3 · pages 45-67 · DOI 10.1016/j.jcs.2024.01.002"), (md.match(/^Cite: .*$/m) || [""])[0]);
  await app.evaluate((_e, f) => global.nodeTest.openSharedTrail(f), file);
  await sleep(2500);
  const opened = await ui.evaluate(() => window.scout.trailGet());
  const oc = opened.cards.find((x) => /paper\.html/.test(x.url || ""));
  check("opening the file brings the details back", opened.trail.readonly === true && oc?.cite?.doi === "10.1016/j.jcs.2024.01.002", JSON.stringify(oc?.cite));
  const bib2 = path.join(OUT, "Opened.bib");
  await app.evaluate((_e, f) => global.nodeTest.setCitationSavePath(f), bib2);
  const r2 = await ui.evaluate(() => window.scout.trailExportCitations());
  check("and a read-only trail can be exported", r2.ok && r2.count === 2 && fs.readFileSync(bib2, "utf8").includes("smith2024lactic"), JSON.stringify(r2));

  // An empty trail: nothing to cite.
  await ui.evaluate(() => window.scout.researchNew("Empty"));
  await sleep(1200);
  const none = path.join(OUT, "None.bib");
  await app.evaluate((_e, f) => global.nodeTest.setCitationSavePath(f), none);
  const r3 = await ui.evaluate(() => window.scout.trailExportCitations());
  await sleep(300);
  check("an empty trail saves no file and says why", r3.empty === true && !fs.existsSync(none) && (await notice()) === "This trail has no pages on its canvas to cite yet.", await notice());

  await app.close();
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
