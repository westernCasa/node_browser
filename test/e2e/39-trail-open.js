// Opening a shared trail (B82 step 5): a preview; Open as New Trail (with its
// tabs if asked); a later file from the same trail is offered for merging into
// it, with what is new and the questions; Merge keeps everyone's replies and
// notes; a file that is not a trail is refused with a reason.
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
const at = (s) => Date.parse(s);
const alex = {
  id: "trail-alex-1", name: "Sourdough from Alex", pins: ["hydration"], tags: [],
  threads: [{ id: "t1", title: "Why do starters fail in winter?", status: "open", conclusion: "", tags: ["temperature"], pages: ["https://example.com/starters"], by: "Alex", at: at("2026-10-27T14:00:00Z"),
    replies: [{ id: "r1", by: "Alex", at: at("2026-10-27T14:02:00Z"), text: "Below 24 °C it sleeps.", replies: [] }] }],
  pages: [{ id: "p1", url: "https://example.com/starters", title: "Starters", firstAt: at("2026-10-27T13:00:00Z"), lastAt: at("2026-10-27T13:30:00Z"), keywords: ["starter"], tags: [], notes: [{ id: "n1", by: "Alex", at: at("2026-10-27T13:10:00Z"), text: "Read section 3." }] }],
  reports: [{ id: "rep1", title: "Summary", by: "NODE research agent", at: at("2026-10-27T15:00:00Z"), text: "Warmth matters." }],
  tabs: [`${BASE}/other.html?n=alextab`],
};
const file1 = path.join(OUT, "Sourdough.trail.md");
fs.writeFileSync(file1, T.toMarkdown(alex, { by: "Alex", at: at("2026-10-28T10:00:00Z") }));

(async () => {
  const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")] });
  await app.evaluate(() => {
    const o = globalThis.fetch;
    globalThis.fetch = async (u, opt) => (/wikipedia|duckduckgo|brave\.com/.test(String(u)) ? new Response("{}", { status: 200 }) : o(u, opt));
  });
  const ui = await app.firstWindow();
  await sleep(1800);
  const mine = await ui.evaluate(() => window.scout.researchGet());
  const open = (f) => app.evaluate((_e, f) => global.nodeTest.openSharedTrail(f), f);

  await open(file1);
  await sleep(1000);
  check("the preview shows in Menu → Trail", (await ui.isVisible("#shared-sheet")) && (await ui.isVisible("#trail-pane")));
  check("it says the name, who sent it and what is in it", /Sourdough from Alex.*from Alex/.test(await ui.textContent("#shared-title")) && /1 page, 1 thread with 1 reply, 1 note, 1 report/.test(await ui.textContent("#shared-summary")), (await ui.textContent("#shared-title")) + " | " + (await ui.textContent("#shared-summary")));
  check("its tabs are offered, off", (await ui.isVisible("#shared-tabs-row")) && !(await ui.isChecked("#shared-tabs")));
  check("nothing changes before a choice", (await ui.evaluate(() => window.scout.researchGet())).id === mine.id);

  await ui.check("#shared-tabs");
  await ui.click("#shared-open-new");
  await sleep(1500);
  let s = await ui.evaluate(() => window.scout.researchGet());
  check("Open as New Trail makes it the current trail", s.id !== mine.id && s.name === "Sourdough from Alex" && s.sharedId === "trail-alex-1");
  check("with the thread, reply, page note and pins", s.threadList[0].replies[0].by === "Alex" && s.trail[0].notes[0].text === "Read section 3." && s.pins.join() === "hydration");
  check("the report is saved and linked", (s.reports || []).length === 1 && /shared-report/.test(s.reports[0].file));
  check("its tabs open in the new trail", (await ui.evaluate(() => tabs.map((t) => t.url))).some((u) => /n=alextab/.test(u)));
  check("the sheet closes and the trail shows the thread", !(await ui.isVisible("#shared-sheet")) && (await ui.locator(".thread", { hasText: "Why do starters fail" }).count()) === 1);

  // Sven replies; Alex sends a newer file: resolved, a new reply and a new page.
  await ui.evaluate(() => window.scout.threadReply("t1", "r1", "Mine too, at 19 °C."));
  const alex2 = JSON.parse(JSON.stringify(alex));
  alex2.threads[0].status = "resolved";
  alex2.threads[0].conclusion = "Keep it above 24 °C.";
  alex2.threads[0].replies.push({ id: "r9", by: "Alex", at: at("2026-10-28T12:00:00Z"), text: "Tried the oven light: works.", replies: [] });
  alex2.pages.push({ id: "p2", url: "https://example.com/oven?utm_source=x", title: "Oven light", firstAt: at("2026-10-28T11:00:00Z"), lastAt: at("2026-10-28T11:00:00Z"), keywords: [], tags: [], notes: [] });
  alex2.pins = ["hydration", "oven"];
  const file2 = path.join(OUT, "Sourdough-2.trail.md");
  fs.writeFileSync(file2, T.toMarkdown(alex2, { by: "Alex", at: at("2026-10-28T13:00:00Z") }));
  await open(file2);
  await sleep(1000);
  const target = await ui.$eval("#shared-target", (x) => x.options[x.selectedIndex].textContent);
  check("the trail it came from is offered first for a merge", /Sourdough from Alex.*from before/.test(target), target);
  const plan = await ui.textContent("#shared-plan");
  check("the summary says what is new", /Adds 1 page, 1 reply\./.test(plan) && /1 page is in both/.test(plan), plan);
  check("NODE asks about the thread's status and the pins", (await ui.locator("#shared-questions select[data-q='status:t1']").count()) === 1 && (await ui.locator("#shared-questions select[data-q='pins']").count()) === 1);
  await ui.selectOption("#shared-questions select[data-q='status:t1']", "theirs");
  await ui.click("#shared-merge");
  await sleep(1200);
  s = await ui.evaluate(() => window.scout.researchGet());
  const t1 = s.threadList.find((t) => t.id === "t1");
  check("merge: their status (as asked) and conclusion", t1.status === "resolved" && t1.conclusion === "Keep it above 24 °C.");
  check("merge: everyone's replies kept in place", t1.replies[0].replies[0]?.text === "Mine too, at 19 °C." && t1.replies.some((r) => r.id === "r9"));
  check("merge: the new page is added, without its tracking code", s.trail.length === 2 && s.trail.some((r) => r.url === "https://example.com/oven"));
  check("merge: pins from both", s.pins.join() === "hydration,oven");
  check("merge: the report is not added twice", (s.reports || []).length === 1);
  check("merge: the trail notes where it came from", (s.shareLog || []).map((x) => x.kind).join() === "opened,merged" && s.shareLog[1].from === "Alex");
  check("the Trail section says what was merged", /Merged: 1 new page, 0 new threads\./.test(await ui.textContent("#session-meta")), await ui.textContent("#session-meta"));

  // Merging the same file again adds nothing.
  await open(file2);
  await sleep(900);
  check("the same file again: nothing new", /Nothing new/.test(await ui.textContent("#shared-plan")), await ui.textContent("#shared-plan"));
  await ui.click("#shared-cancel");
  check("Cancel closes it", !(await ui.isVisible("#shared-sheet")));
  await ui.evaluate(() => closeMenu());

  // Not a trail file.
  const bad = path.join(OUT, "notes.md");
  fs.writeFileSync(bad, "# Just my notes\n");
  await open(bad);
  await sleep(800);
  check("an ordinary Markdown file is refused with a reason", (await ui.isVisible("#shared-sheet")) && /could not be opened/.test(await ui.textContent("#shared-title")) && /not a NODE trail file/.test(await ui.textContent("#shared-summary")) && !(await ui.isVisible("#shared-merge")));

  // From outside NODE: Open With in Finder (open-file) and a path on the command line.
  await app.evaluate((_e, f) => global.nodeTest.openFromOutside(f), file1);
  await sleep(900);
  check("Open With a trail file shows the preview", (await ui.isVisible("#shared-sheet")) && /Sourdough from Alex/.test(await ui.textContent("#shared-title")));
  await ui.click("#shared-cancel");
  const plain = path.join(OUT, "plain notes.md");
  fs.writeFileSync(plain, "# Plain notes\n\nNot a trail.\n");
  await app.evaluate((_e, f) => global.nodeTest.openFromOutside(f), plain);
  await sleep(1200);
  check("Open With another Markdown file opens it in a tab to read", (await ui.evaluate(() => tabs.map((t) => t.url))).some((u) => /plain%20notes\.md$/.test(u)), JSON.stringify(await ui.evaluate(() => tabs.map((t) => t.url))));
  await app.close();

  const app2 = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", ".."), file2] });
  const ui2 = await app2.firstWindow();
  await sleep(3500);
  check("a trail file on the command line (Windows Open with) shows the preview at start", (await ui2.isVisible("#shared-sheet")) && /Sourdough from Alex/.test(await ui2.textContent("#shared-title")));
  await app2.close();
  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
