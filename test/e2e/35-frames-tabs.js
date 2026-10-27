// A click in a frame from another site (a captcha, for example) stays in its
// own tab. Chromium can host the same site's frames from several tabs in one
// process, so the tab id the page script reads from its process can be
// another tab's; NODE now names the tab by the webContents that sent the
// message (reported by Sven on the Mac with 0.9.6: captchas switched back to
// the previous tab).
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

(async () => {
  const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")] });
  await app.evaluate(() => {
    const o = globalThis.fetch;
    globalThis.fetch = async (u, opt) => (/wikipedia|duckduckgo|brave\.com/.test(String(u)) ? new Response("{}", { status: 200 }) : o(u, opt));
  });
  const ui = await app.firstWindow();
  await sleep(1500);
  const active = () => ui.evaluate(() => tabs.find((t) => t.id === activeId)?.url || "");
  const inFrame = (tab, js) =>
    app.evaluate(({ webContents }, [t, code]) => webContents.getAllWebContents().find((w) => w.getURL().includes(`tab=${t}`)).mainFrame.frames[0].executeJavaScript(code), [tab, js]);

  await ui.evaluate(() => window.scout.createTab("http://127.0.0.1:8765/captcha-host.html?tab=A"));
  await sleep(1500);
  await ui.evaluate(() => window.scout.createTab("http://127.0.0.1:8765/captcha-host.html?tab=B"));
  await sleep(2000);
  check("tab B is open", (await active()).endsWith("tab=B"));
  const shared = await app.evaluate(({ webContents }) => {
    const f = (t) => webContents.getAllWebContents().find((w) => w.getURL().includes(`tab=${t}`)).mainFrame.frames[0]?.osProcessId;
    return f("A") === f("B");
  });
  console.log("  the two captcha frames share a process:", shared);
  await inFrame("B", 'document.getElementById("human").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))');
  await sleep(800);
  check("clicking the captcha in tab B stays in tab B", (await active()).endsWith("tab=B"), await active());
  await inFrame("B", 'document.getElementById("human").dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }))');
  await sleep(300);
  check("still in tab B after typing in the frame", (await active()).endsWith("tab=B"));
  // A click in tab A's frame (A not on screen) is a click in A.
  await inFrame("A", 'document.getElementById("human").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))');
  await sleep(800);
  check("a click in tab A's frame belongs to tab A", (await active()).endsWith("tab=A"), await active());

  await app.close();
  if (failed) console.log(`::error::35-frames-tabs: ${failed} check(s) failed`);
  console.log(failed ? `${failed} checks failed` : "all checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
