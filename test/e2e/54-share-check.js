// The check before sharing (B86): the share sheet lists contact details
// (email addresses, phone numbers) in what would be shared, each ticked.
// Unticking one leaves it out of the file ("[email left out]"). Share links
// get the same check (format 1).
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
fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ firstRunDone: true, displayName: "Sven" }));

(async () => {
  const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")] });
  await app.evaluate(() => {
    const o = globalThis.fetch;
    globalThis.fetch = async (u, opt) => (/wikipedia|duckduckgo|brave\.com|x\.ai|11434/.test(String(u)) ? new Response("{}", { status: 200 }) : o(u, opt));
  });
  const ui = await app.firstWindow();
  await sleep(1800);
  await ui.evaluate(() => window.scout.trailRename("Rye millers"));
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/article.html`);
  await sleep(1500);
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.flatMap((m) => m.submenu?.items || []).find((i) => i.label === "Tab 1").click());
  await sleep(1200);
  await ui.evaluate(() => window.scout.trailNote({ x: 400, y: 0, text: "Miller: jo@mill.example, call 203-555-0142 before 9:30" }));
  await ui.evaluate(() => window.scout.trailQuestion({ x: 0, y: 300, title: "Who sells whole rye? Ask kim@example.org" }));
  await sleep(500);

  // Open the share sheet.
  await ui.evaluate(() => openShareSheet());
  await sleep(1500);
  const list = () => ui.evaluate(() => ({ hidden: document.getElementById("share-check-file").hidden, help: document.querySelector("#share-check-file .help")?.textContent || "", rows: [...document.querySelectorAll("#share-check-file label")].map((l) => ({ text: l.textContent, on: l.querySelector("input").checked })) }));
  let l = await list();
  check("the share sheet lists the contact details in the file", !l.hidden && l.rows.length === 3, JSON.stringify(l));
  check("each one ticked, with where it is", l.rows.every((r) => r.on) && l.rows.some((r) => /^Email jo@mill\.example · Note: Miller: jo@mill\.example, call 203-555-0142 bef?o?…, and 1 more place$/.test(r.text)) && l.rows.some((r) => /^Phone 203-555-0142 · Note: /.test(r.text)) && l.rows.some((r) => /^Email kim@example\.org · Question: /.test(r.text)), JSON.stringify(l.rows.map((r) => r.text)));
  check("it says what unticking does", /Untick one to leave it out: it shows as “\[email left out\]” or “\[phone number left out\]”\./.test(l.help), l.help);
  await ui.screenshot({ path: path.join(OUT, "54-sheet.png") });

  // The note typed in the sheet is checked too.
  await ui.fill("#share-note", "Questions to sven@example.net");
  await sleep(900);
  l = await list();
  check("the note for the reader is checked as you type", l.rows.some((r) => /^Email sven@example\.net · Your note in the share sheet$/.test(r.text)), JSON.stringify(l.rows.map((r) => r.text)));

  // Untick the miller's email and phone; save.
  await ui.evaluate(() => [...document.querySelectorAll("#share-check-file label")].filter((x) => /jo@mill|203-555/.test(x.textContent)).forEach((x) => x.querySelector("input").click()));
  await sleep(800);
  const preview = await ui.evaluate(() => document.getElementById("share-preview-text").textContent);
  check("the preview shows them left out", preview.includes("Miller: [email left out], call [phone number left out] before 9:30") && preview.includes("kim@example.org"), preview.slice(0, 200));
  const file = path.join(OUT, "Rye millers.trail.md");
  await app.evaluate((_e, f) => global.nodeTest.setTrailSavePath(f), file);
  await ui.click("#share-save");
  await sleep(1200);
  const text = fs.readFileSync(file, "utf8");
  check("the saved file leaves them out", text.includes("Miller: [email left out], call [phone number left out] before 9:30") && !/jo@mill|203-555-0142/.test(text));
  check("the ticked ones stay", text.includes("kim@example.org") && text.includes("sven@example.net"));
  check("the trail itself is unchanged", JSON.stringify(await ui.evaluate(() => window.scout.trailGet())).includes("jo@mill.example"));

  // Share links: the same check on what a link carries.
  const linkFound = await ui.evaluate(() => window.scout.trailShareCheck({ kind: "link" }));
  check("share links are checked too", linkFound.some((f) => f.value === "kim@example.org"), JSON.stringify(linkFound));

  // A trail with nothing to flag shows no list.
  await ui.evaluate(() => window.scout.researchNew("Clean"));
  await sleep(1200);
  await ui.evaluate(() => openShareSheet());
  await sleep(1200);
  check("nothing found, no list", (await list()).hidden === true);

  await app.close();
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
