// Trail provenance (B83): how each page was reached is kept on its card,
// shown on the card, and NODE's own picks are marked. Typed addresses, links
// clicked on a page, NODE's suggestions, the research agent, a site moving to
// the next item by itself, and NODE's autoplay.
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
  const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")] });
  await app.evaluate(() => {
    const o = globalThis.fetch;
    globalThis.fetch = async (u, opt) => (/wikipedia|duckduckgo|brave\.com/.test(String(u)) ? new Response("{}", { status: 200 }) : o(u, opt));
  });
  const ui = await app.firstWindow();
  await sleep(1800);
  await ui.evaluate(() => window.scout.trailRename("Provenance"));
  const view = (re) => app.evaluate(({ BrowserWindow }, s) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children.find((x) => x.webContents && new RegExp(s).test(x.webContents.getURL()));
    return v ? v.webContents.id : null;
  }, re.source);

  // Typed in the address bar.
  await ui.evaluate(() => (document.getElementById("omni").value = "http://127.0.0.1:8765/seealso.html"));
  await ui.evaluate(() => document.getElementById("omni-form").requestSubmit());
  await sleep(1800);
  // A link clicked on that page (a real click).
  const pos = await app.evaluate(async ({ webContents }, id) => {
    const wc = webContents.fromId(id);
    return wc.executeJavaScript(`(() => { const r = document.querySelector('a[href*="zettel"]').getBoundingClientRect(); return { x: Math.round(r.left + 5), y: Math.round(r.top + r.height / 2) }; })()`);
  }, await view(/seealso/));
  await app.evaluate(({ webContents }, { id, x, y }) => {
    const wc = webContents.fromId(id);
    wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
    wc.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
  }, { id: await view(/seealso/), ...pos });
  await sleep(1800);
  // A suggestion card's Open tab.
  await ui.evaluate((u) => {
    const c = buildCard({ url: u, title: "Suggested page", query: "levain" });
    document.body.append(c);
    c.querySelector('[data-act="open"]').click();
    c.remove();
  }, `${BASE}/other.html?w=suggested`);
  await sleep(1500);
  // A page the research agent cited.
  await ui.evaluate((u) => window.scout.createTab(u, { how: "agent" }), `${BASE}/other.html?w=agent`);
  await sleep(1500);
  // A player that plays by itself, then moves to the next item without a click.
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/next.html?v=1`);
  await sleep(9000);
  // Something the window says that isn't a known way is ignored.
  await ui.evaluate((u) => window.scout.createTab(u, { how: "hacked", query: "x" }), `${BASE}/other.html?w=unknown`);
  await sleep(1500);

  // Leaving the trail makes every open page a card (B104).
  const trailId = (await ui.evaluate(() => window.scout.trailGet())).trail.id;
  await ui.evaluate(() => window.scout.researchNew("Other"));
  await sleep(1500);
  await ui.evaluate((id) => window.scout.trailSwitch(id), trailId);
  await sleep(1500);
  const cards = (await ui.evaluate(() => window.scout.trailGet())).cards.filter((c) => c.kind === "page");
  const via = (re) => {
    const c = cards.find((k) => re.test(k.url || ""));
    return c ? JSON.stringify({ via: c.via || null, played: Boolean(c.played) }) : "no card";
  };
  // The typed page was left for the link within 20 s: timeline only, with how.
  const tl = (await ui.evaluate(() => window.scout.trailTimeline())).flatMap((s) => s.items);
  const typed = tl.find((i) => /seealso/.test(i.url || ""));
  check("a typed address (a page that stayed in the timeline keeps it)", typed?.timelineOnly && JSON.stringify(typed.via) === JSON.stringify({ how: "typed" }), JSON.stringify(typed));
  check("a link clicked on a page names that page's site", via(/zettel/) === JSON.stringify({ via: { how: "link", host: "127.0.0.1" }, played: false }), via(/zettel/));
  check("a suggestion keeps the keyword it came from", via(/w=suggested/) === JSON.stringify({ via: { how: "suggested", query: "levain" }, played: false }), via(/w=suggested/));
  check("a page the agent found", via(/w=agent/) === JSON.stringify({ via: { how: "agent" }, played: false }), via(/w=agent/));
  // The first item was left for the next one within 20 s: timeline only.
  const first = tl.find((i) => /v=1/.test(i.url || ""));
  check("NODE's autoplay is marked", first?.played === true && !first.via, JSON.stringify(first));
  check("the site moving on by itself is auto-played next", via(/v=2/) === JSON.stringify({ via: { how: "next", host: "127.0.0.1" }, played: false }), via(/v=2/));
  check("an unknown way is not stored", via(/w=unknown/) === JSON.stringify({ via: null, played: false }), via(/w=unknown/));

  // On the canvas: a line on each card; NODE's picks in violet.
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.flatMap((m) => m.submenu?.items || []).find((i) => i.label === "Tab 1").click());
  await sleep(1200);
  await ui.evaluate(() => trailCanvas?.fit(false));
  await sleep(500);
  const lines = await ui.evaluate(() => [...document.querySelectorAll("#canvas .cv-card")].map((c) => [c.querySelector(".cv-card-title")?.textContent, c.querySelector(".cv-card-via")?.textContent || "", c.querySelector(".cv-card-via")?.classList.contains("node") || false]));
  const line = (t) => lines.find((l) => l[0] && l[0].includes(t)) || [];
  check("cards say how: Link from …, not in violet", lines.some((l) => l[1] === "Link from 127.0.0.1" && !l[2]), JSON.stringify(lines));
  check("cards say how: Suggested by NODE, in violet", /^Suggested by NODE for “levain”$/.test(line("suggested")[1] || lines.find((l) => /Suggested by NODE/.test(l[1]))?.[1] || "") && lines.some((l) => /Suggested by NODE/.test(l[1]) && l[2]), JSON.stringify(lines));
  check("cards say how: Auto-played next, in violet", lines.some((l) => l[1] === "Auto-played next on 127.0.0.1" && l[2]), JSON.stringify(lines));
  const color = await ui.evaluate(() => {
    const n = document.querySelector("#canvas .cv-card-via.node");
    const plain = document.querySelector("#canvas .cv-card-via:not(.node)");
    return [n && getComputedStyle(n).color, plain && getComputedStyle(plain).color];
  });
  check("NODE's picks look different from the person's", color[0] && color[1] && color[0] !== color[1], JSON.stringify(color));
  await ui.screenshot({ path: path.join(OUT, "50-canvas.png") });

  // Replay says it too.
  const steps = await ui.evaluate(() => window.scout.trailReplay());
  const caps = steps.map((s) => s.caption || "").join("\n");
  check("Replay says a visit was typed", /visited “[^”]*” for \d+ s \(typed address\)\. It stayed in the timeline only\./.test(caps), caps);
  check("Replay names NODE's suggestion", /NODE suggested “[^”]*” on 127\.0\.0\.1 for “levain”, and you opened it\./.test(caps), caps);
  check("Replay names the site's autoplay", /127\.0\.0\.1 played “[^”]*” next by itself\./.test(caps), caps);

  await app.close();
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
