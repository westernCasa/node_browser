// Sharing a trail as a file (B82 step 4): File → Share Trail… opens the sheet
// in Menu → Trail with every page ticked; unticked pages, private address
// parts and tracking codes stay out; threads, replies and notes go in; open
// tabs only when ticked; the file reads back as the same trail.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path"), fs = require("fs"), os = require("os");
const T = require("../../core/trail-file");
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
const saved = path.join(OUT, "Sourdough.trail.md");

(async () => {
  const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")] });
  await app.evaluate(() => {
    const o = globalThis.fetch;
    globalThis.fetch = async (u, opt) => (/wikipedia|duckduckgo|brave\.com/.test(String(u)) ? new Response("{}", { status: 200 }) : o(u, opt));
  });
  const ui = await app.firstWindow();
  await sleep(1800);
  await app.evaluate((_e, p) => global.nodeTest.setTrailSavePath(p), saved);
  await ui.evaluate(async () => {
    const s = window.scout;
    await s.researchRename("Sourdough");
    await s.researchVisit("https://example.com/starters?utm_source=x&page=2", "Why starters fail", ["hydration"]);
    await s.researchVisit("https://example.com/private?token=SECRET123&id=4", "Private one", []);
    await s.researchVisit("https://example.com/rye", "Rye and enzymes", ["hydration"]);
    let snap = await s.threadAdd({ title: "Why do starters fail in winter?", tags: ["temperature"], pages: ["https://example.com/rye", "https://example.com/starters?utm_source=x&page=2"] });
    const t = snap.threadList[0];
    snap = await s.threadReply(t.id, "", "Below 24 °C it goes dormant.");
    await s.threadReply(t.id, snap.threadList[0].replies[0].id, "Rye flour helps.");
    await s.noteAdd("https://example.com/rye", "Good on enzymes.");
  });
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/other.html?n=open`);
  await sleep(1500);

  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find((m) => m.label === "File").submenu.items.find((i) => i.label === "Share Trail…").click());
  await sleep(1200);
  check("File → Share Trail… opens the sheet in Menu → Trail", (await ui.isVisible("#share-sheet")) && (await ui.isVisible("#trail-pane")));
  check("the summary counts threads, replies and notes, with the name", /1 thread with 2 replies, 1 note/.test(await ui.textContent("#share-summary")) && /Sven/.test(await ui.textContent("#share-summary")), await ui.textContent("#share-summary"));
  check("every page is listed and ticked", (await ui.textContent("#share-pages-count")) === "Pages: 3 of 3", await ui.textContent("#share-pages-count"));
  check("open tabs are off by default", !(await ui.isChecked("#share-tabs")) && /\(1\)/.test(await ui.textContent("#share-tabs-label")));

  await ui.locator("#share-pages label", { hasText: "Rye and enzymes" }).locator("input").uncheck();
  check("unticking updates the count", (await ui.textContent("#share-pages-count")) === "Pages: 2 of 3");
  await ui.click("#share-none");
  check("Untick all", (await ui.textContent("#share-pages-count")) === "Pages: 0 of 3");
  await ui.click("#share-all");
  await ui.locator("#share-pages label", { hasText: "Rye and enzymes" }).locator("input").uncheck();
  await ui.check("#share-tabs");
  await ui.click("#share-save");
  await sleep(800);
  check("Save File writes the file and says so", fs.existsSync(saved) && /Saved Sourdough\.trail\.md/.test(await ui.textContent("#share-msg")), await ui.textContent("#share-msg"));

  const text = fs.readFileSync(saved, "utf8");
  const back = T.fromMarkdown(text);
  check("the file is a NODE trail with the name and sender", T.isTrailFile(text) && back.name === "Sourdough" && back.exportedBy === "Sven");
  check("an unticked page is left out", !back.pages.some((p) => /rye/.test(p.url)) && back.pages.length === 2, back.pages.map((p) => p.url).join(" "));
  check("tracking codes and private tokens are removed", !text.includes("utm_source") && !text.includes("SECRET123") && back.pages.some((p) => p.url === "https://example.com/private?id=4"));
  check("the thread goes with its nested replies", back.threads[0]?.title === "Why do starters fail in winter?" && back.threads[0].replies[0].replies[0]?.text === "Rye flour helps." && back.threads[0].replies[0].by === "Sven");
  check("an unticked page is not linked from a thread either", !text.includes("example.com/rye") && back.threads[0].pages.join() === "https://example.com/starters?page=2", JSON.stringify(back.threads[0].pages));
  check("open tabs go in when ticked", back.tabs.some((u) => /other\.html\?n=open/.test(u)), JSON.stringify(back.tabs));
  check("the file reads as plain Markdown", /^# Sourdough$/m.test(text) && /^## Threads$/m.test(text) && /^## Pages$/m.test(text));

  await ui.click("#share-cancel");
  check("Cancel closes the sheet", !(await ui.isVisible("#share-sheet")));
  await app.close();
  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
