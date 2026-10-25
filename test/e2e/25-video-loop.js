// Loop a section of a video (B70): loop the next N seconds, start and end
// points, the tab-strip mark that stops it, and the loop ending when the page
// moves to another address.
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
  await sleep(1500);
  await ui.fill("#omni", `${BASE}/loop.html`);
  await ui.press("#omni", "Enter");
  await sleep(2500);
  // Runs in the page: the video's time and state.
  const video = (js) =>
    app.evaluate(({ webContents }, code) => {
      const wc = webContents.getAllWebContents().find((w) => /loop\.html/.test(w.getURL()));
      return wc.executeJavaScript(code, true);
    }, js);
  const id = await ui.evaluate(() => activeId);
  const loop = (op, secs) => ui.evaluate(([i, o, s]) => window.scout.loopTab(i, o, s), [id, op, secs]);

  check("no loop before one is set", (await loop("get")) === null);
  await video(`(() => { const v = document.getElementById("v"); v.currentTime = 8; return v.play().then(() => true); })()`);
  await sleep(600);
  const r = await loop("next", 5);
  check("Loop the next 5 s starts at the current time", r && Math.abs(r.a - 8) < 1.2 && Math.abs(r.b - r.a - 5) < 0.1, JSON.stringify(r));
  await sleep(7500);
  const t = await video(`document.getElementById("v").currentTime`);
  check("after 7.5 s the video is still inside the section", t >= r.a - 0.2 && t <= r.b + 0.3, t.toFixed(2));
  const mark = await ui.textContent("#tabs .tab.active .loop-mark").catch(() => "");
  check("the tab shows the looping section", /↻ 0:0[89]–0:1[34]/.test(mark), mark);
  check("a notice says what loops", /Looping 0:0\d to 0:1\d/.test(await ui.textContent("#notice")));

  // Start and end points.
  await video(`document.getElementById("v").currentTime = 20`);
  await sleep(400);
  const s = await loop("start");
  await video(`document.getElementById("v").currentTime = 26`);
  await sleep(400);
  const e = await loop("end");
  check("Start Loop Here then End Loop Here loops between them", s && e && Math.abs(e.a - 20) < 1 && Math.abs(e.b - 26) < 1, JSON.stringify(e));
  await sleep(800);
  const t2 = await video(`document.getElementById("v").currentTime`);
  check("End Loop Here goes back to the start point", t2 >= 19.5 && t2 <= 22.5, t2.toFixed(2));

  // The tab mark stops it.
  await ui.click("#tabs .tab.active .loop-mark");
  await sleep(500);
  check("clicking the mark stops looping", (await ui.$("#tabs .tab.active .loop-mark")) === null && (await loop("get")) === null);
  await video(`document.getElementById("v").currentTime = 24`);
  await sleep(3500);
  const t3 = await video(`document.getElementById("v").currentTime`);
  check("after stopping, the video plays past the old end", t3 > 26.5, t3.toFixed(2));

  // Another address on the same page (as YouTube does between videos) ends the loop.
  await loop("next", 10);
  await video(`history.pushState({}, "", "/loop.html?v=2")`);
  await sleep(800);
  check("a new address on the same page ends the loop", (await ui.$("#tabs .tab.active .loop-mark")) === null && (await loop("get")) === null);

  // A page without video says so.
  await ui.fill("#omni", `${BASE}/other.html`);
  await ui.press("#omni", "Enter");
  await sleep(2000);
  await loop("next", 30);
  await sleep(300);
  check("no video: a notice says so", /No video to loop/.test(await ui.textContent("#notice")));

  await app.evaluate(({ app }) => app.quit());
  console.log(failed ? `${failed} checks failed` : "all checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
