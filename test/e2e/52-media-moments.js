// Media moments (B88): ⌘⇧K marks a start, then the end, and saves a moment
// card next to the page's card with the captions shown during it, then
// pauses. With a loop set, one press saves the loop. ⌘⇧J saves the last
// 30 seconds. On the canvas: change the times, Ask for ID, Play.
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
    globalThis.fetch = async (u, opt) => (/wikipedia|duckduckgo|brave\.com|x\.ai|11434/.test(String(u)) ? new Response("{}", { status: 200 }) : o(u, opt));
  });
  const ui = await app.firstWindow();
  await sleep(1800);
  const menuItem = (label) => app.evaluate(({ Menu }, l) => Menu.getApplicationMenu().items.flatMap((m) => m.submenu?.items || []).find((i) => i.label === l).click(), label);
  const page = (js) =>
    app.evaluate(async ({ BrowserWindow }, code) => {
      const v = BrowserWindow.getAllWindows()[0].contentView.children.find((x) => x.webContents && /moment\.html/.test(x.webContents.getURL()));
      return v ? v.webContents.executeJavaScript(code) : null;
    }, js);
  const moments = async () => (await ui.evaluate(() => window.scout.trailGet())).cards.filter((c) => c.kind === "moment").sort((a, b) => a.placedAt - b.placedAt);
  const notices = [];
  await ui.exposeFunction("__notice", (m) => notices.push(m));
  await ui.evaluate(() => window.scout.onCommand?.((cmd, msg) => cmd === "notice" && window.__notice(msg.message)));

  // Seek once the whole video is loaded (the test server has no range requests).
  const seekPlay = (t) =>
    page(`new Promise((done) => {
      const v = document.getElementById("v");
      const loaded = () => v.buffered.length && v.buffered.end(v.buffered.length - 1) >= v.duration - 0.5;
      const go = () => { v.addEventListener("seeked", () => v.play().then(() => done(true), () => done(false)), { once: true }); v.currentTime = ${t}; };
      if (loaded()) go();
      else { const t0 = setInterval(() => { if (loaded()) { clearInterval(t0); go(); } }, 100); setTimeout(() => done(false), 15000); }
    })`);
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/moment.html`);
  await sleep(2000);
  check("the test video loads and seeks", await seekPlay(4));
  await sleep(800);

  // ⌘⇧K: start, then end.
  await menuItem("Save Moment: Start / End");
  await sleep(3200);
  check("the first press keeps it playing", (await page(`!document.getElementById("v").paused`)) === true);
  await menuItem("Save Moment: Start / End");
  await sleep(1500);
  let ms = await moments();
  const first = ms[0];
  check("the second press saves a moment card", ms.length === 1 && first.b - first.a > 2 && first.b - first.a < 5 && first.a >= 4, JSON.stringify(first && { a: first.a, b: first.b }));
  check("and pauses", (await page(`document.getElementById("v").paused`)) === true);
  check("the moment keeps the captions shown during it", /Line \d+: /.test(first?.transcript || ""), first?.transcript);
  const snap = await ui.evaluate(() => window.scout.trailGet());
  const pageCard = snap.cards.find((c) => c.kind === "page" && /moment\.html/.test(c.url));
  check("its page became a card, with a line to the moment", Boolean(pageCard) && snap.lines.some((l) => l.from === pageCard.id && l.to === first.id && l.label === "moment from"));

  // ⌘⇧J: the last 30 seconds (from the start of the video here).
  await seekPlay(12);
  await sleep(1200);
  await menuItem("Save the Last 30 Seconds");
  await sleep(1500);
  ms = await moments();
  const last = ms[1];
  check("“Save the Last 30 Seconds” saves up to now", ms.length === 2 && last.a === 0 && last.b >= 12 && last.b < 15, JSON.stringify(last && { a: last.a, b: last.b }));
  check("with the caption cues in that range", /Line 1: the starter/.test(last?.transcript || "") && /Line 6: after two/.test(last?.transcript || ""), last?.transcript);

  // With a loop set, one press saves the loop.
  await seekPlay(20);
  await sleep(500);
  const tabId = await ui.evaluate(() => activeId);
  await ui.evaluate((id) => window.scout.loopTab?.(id, "next", 5) ?? window.scout.tabLoop?.(id, "next", 5), tabId);
  await sleep(800);
  await menuItem("Save Moment: Start / End");
  await sleep(1500);
  ms = await moments();
  const looped = ms[2];
  check("with a loop set, one press saves the loop's range", ms.length === 3 && Math.abs(looped.b - looped.a - 5) < 0.6 && looped.a >= 19.5, JSON.stringify(looped && { a: looped.a, b: looped.b }));

  // The canvas: the card, change the times, Ask for ID, Play.
  await menuItem("Tab 1");
  await sleep(1500);
  await ui.evaluate((id) => trailCanvas.select(id, { reveal: true }), first.id);
  await sleep(600);
  const card = `#canvas .cv-card[data-id="${first.id}"]`;
  const shown = await ui.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el && { kind: el.querySelector(".cv-card-kind").textContent, times: el.querySelector(".cv-moment-times").textContent, text: el.querySelector(".cv-moment-text")?.textContent || "", acts: [...el.querySelectorAll(".cv-moment-acts .chip")].map((b) => b.textContent) };
  }, card);
  check("the card shows Moment, its times, its captions, Play and Ask for ID", shown && shown.kind === "Moment · 127.0.0.1" && /^0:0\d – 0:0\d$/.test(shown.times) && /Line/.test(shown.text) && shown.acts.join() === "Play,Ask for ID", JSON.stringify(shown));
  await ui.screenshot({ path: path.join(OUT, "52-card.png") });
  const rows = await ui.evaluate(() => [...document.querySelectorAll("#sb-timeline-list .sb-tl-row .nm")].map((r) => r.textContent));
  check("the timeline says Moment and its times", rows.some((r) => /^Moment 0:\d\d–0:\d\d · A long talk about levain$/.test(r)), JSON.stringify(rows));
  await ui.click(`${card} .cv-moment-times`);
  await sleep(200);
  await ui.keyboard.press("ControlOrMeta+a");
  await ui.keyboard.type("0:02–0:06");
  await ui.keyboard.press("Enter");
  await sleep(1000);
  const edited = (await moments()).find((c) => c.id === first.id);
  check("clicking the times lets you change them", edited.a === 2 && edited.b === 6, JSON.stringify({ a: edited.a, b: edited.b }));
  await ui.click(`${card} .cv-moment-acts .chip:nth-child(2)`);
  await sleep(1000);
  const s2 = await ui.evaluate(() => window.scout.trailGet());
  const q = s2.cards.find((c) => c.kind === "question" && c.title === "ID at 0:02?");
  check("Ask for ID makes a question “ID at 0:02?” that the moment raises", Boolean(q) && s2.lines.some((l) => l.from === first.id && l.to === q.id && l.label === "raises"), JSON.stringify(s2.cards.filter((c) => c.kind === "question").map((c) => c.title)));
  await ui.screenshot({ path: path.join(OUT, "52-id.png") });
  await ui.click(`${card} .cv-moment-acts .chip:nth-child(1)`);
  await sleep(2500);
  const playing = await page(`(() => { const v = document.getElementById("v"); return { t: v.currentTime, paused: v.paused }; })()`);
  check("Play goes to the page and plays the moment", playing && !playing.paused && playing.t >= 2 && playing.t <= 6.5, JSON.stringify(playing));
  check("looping its range", (await ui.evaluate(() => tabs.find((t) => t.id === activeId)?.loop?.label)) === "0:02–0:06");
  await sleep(4500);
  const again = await page(`document.getElementById("v").currentTime`);
  check("and goes back to the start at the end", again >= 2 && again <= 6.5, String(again));

  // A page with no video or audio.
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/article.html`);
  await sleep(1500);
  await menuItem("Save Moment: Start / End");
  await sleep(600);
  check("no video: nothing saved", (await moments()).length === 3);

  await app.close();
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
