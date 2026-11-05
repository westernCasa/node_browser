// Trail canvas, step 1 (B100-B103). This file grows with each item.
// B100: research sessions move into the trail store on the first start;
// trail:* channels; research:* still works on top of it; NODE opens on the
// trail that was current.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path"), fs = require("fs"), os = require("os");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "node-e2e-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(ok ? "✓" : "✗", name, detail ? `(${detail})` : "");
};
const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ firstRunDone: true }));
const day = (s) => Date.parse(s);
const sessions = path.join(userData, "sessions");
fs.mkdirSync(sessions);
fs.writeFileSync(
  path.join(sessions, "s-sour.json"),
  JSON.stringify({
    id: "s-sour",
    name: "Sourdough starters",
    started: day("2026-10-27T14:00:00Z"),
    updated: day("2026-10-28T09:41:00Z"),
    pins: ["hydration"],
    trail: [
      { url: "https://kingarthurbaking.com/cold", title: "Keeping a starter in a cold kitchen", firstAt: day("2026-10-27T14:10:00Z"), lastAt: day("2026-10-27T14:13:00Z"), visits: 2, keywords: ["temperature"] },
      { url: "https://en.wikipedia.org/wiki/Sourdough", title: "Sourdough", firstAt: day("2026-10-27T14:05:00Z"), lastAt: day("2026-10-27T14:05:00Z"), visits: 1, keywords: [] },
    ],
    opened: [],
    dismissed: [],
    threadList: [{ id: "q1", title: "Why do starters fail in winter?", status: "open", conclusion: "", tags: [], pages: [], by: "Sven", at: day("2026-10-27T14:02:00Z"), replies: [] }],
  }),
);
fs.writeFileSync(path.join(sessions, "s-curie.json"), JSON.stringify({ id: "s-curie", name: "Curie / radium", started: day("2026-10-21T19:00:00Z"), updated: day("2026-10-22T21:00:00Z"), pins: [], trail: [{ url: "https://en.wikipedia.org/wiki/Marie_Curie", title: "Marie Curie", firstAt: day("2026-10-21T19:41:00Z"), lastAt: day("2026-10-21T19:45:00Z"), visits: 1, keywords: ["radium"] }], opened: [], dismissed: [] }));
fs.writeFileSync(path.join(sessions, "current.txt"), "s-sour");

async function launch() {
  const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")] });
  await app.evaluate(() => {
    const o = globalThis.fetch;
    globalThis.fetch = async (u, opt) => (/wikipedia|duckduckgo|brave\.com/.test(String(u)) ? new Response("{}", { status: 200 }) : o(u, opt));
  });
  const ui = await app.firstWindow();
  await sleep(1800);
  return { app, ui };
}

(async () => {
  let { app, ui } = await launch();
  const trails = path.join(userData, "trails");
  check("first start makes userData/trails/ with one folder per session", fs.existsSync(path.join(trails, "index.json")) && fs.existsSync(path.join(trails, "s-sour", "trail.json")) && fs.existsSync(path.join(trails, "s-sour", "events.jsonl")) && fs.existsSync(path.join(trails, "s-curie", "view.json")));
  check("the old sessions/ files are left in place", fs.existsSync(path.join(sessions, "s-sour.json")));
  let t = await ui.evaluate(() => window.scout.trailGet());
  check("NODE opens on the trail that was current", t?.trail.id === "s-sour", t?.trail.id);
  const kinds = (t?.cards || []).map((c) => c.kind).sort().join();
  check("existing session data shows as cards: the read page and the thread", kinds === "page,question", kinds);
  const only = t.timeline.flatMap((s) => s.items).filter((i) => i.timelineOnly).map((i) => i.title);
  check("a quick visit stays timeline-only", only.join() === "Sourdough", only.join());
  const r = await ui.evaluate(() => window.scout.researchGet());
  check("research:get still works over the trail store", r?.trail?.length === 2 && r.threadList?.[0]?.id === "q1" && r.pins.join() === "hydration");
  const list = await ui.evaluate(() => window.scout.trailList());
  check("trail:list has both trails, current first", list.length === 2 && list[0].id === "s-sour" && list[0].current && list[1].name === "Curie / radium", JSON.stringify(list.map((x) => x.name)));

  await ui.evaluate(() => window.scout.researchVisit("https://example.com/new-page", "A new page", ["new"]));
  t = await ui.evaluate(() => window.scout.trailGet());
  check("a visit through research:* lands in the trail's event log", t.timeline.flatMap((s) => s.items).some((i) => i.title === "A new page") && fs.readFileSync(path.join(trails, "s-sour", "events.jsonl"), "utf8").includes("example.com/new-page"));

  await ui.evaluate(() => window.scout.trailView({ x: -120, y: 60, z: 0.6, selected: "q1" }));
  const sw = await ui.evaluate(() => window.scout.trailSwitch("s-curie"));
  check("trail:switch changes the current trail", sw?.trail.id === "s-curie" && (await ui.evaluate(() => window.scout.researchGet())).name === "Curie / radium");
  await ui.evaluate(() => window.scout.trailSwitch("s-sour"));
  await app.close();

  ({ app, ui } = await launch());
  t = await ui.evaluate(() => window.scout.trailGet());
  check("after a restart NODE opens on the last trail at its saved position", t.trail.id === "s-sour" && t.view.x === -120 && t.view.z === 0.6 && t.view.selected === "q1", JSON.stringify(t.view));
  const evCount = fs.readFileSync(path.join(trails, "s-sour", "events.jsonl"), "utf8").trim().split("\n").length;
  check("the migration does not run twice", (await ui.evaluate(() => window.scout.trailList())).length === 2 && evCount < 12, String(evCount));
  await app.close();
  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
