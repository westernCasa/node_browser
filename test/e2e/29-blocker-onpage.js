// Built-in blocker, on the page (B77): leftover ad boxes are hidden by
// cosmetic filters, only where blocking is on (not with the switch off or a
// site rule allowing ads), and "Also hide cookie notices" switches to the list
// set with cookie-notice filters.
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

(async () => {
  const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
  const { ElectronBlocker } = require("@ghostery/adblocker-electron");
  // The "ads and tracking" set hides ad boxes; the "full" set also hides cookie notices.
  fs.writeFileSync(path.join(userData, "adblock.bin"), ElectronBlocker.parse("127.0.0.1##.ad-box\n/adbanner.").serialize());
  fs.writeFileSync(path.join(userData, "adblock-full.bin"), ElectronBlocker.parse("127.0.0.1##.ad-box\n127.0.0.1##.cookie-banner\n/adbanner.").serialize());
  fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ firstRunDone: true }));
  fs.writeFileSync(path.join(userData, "rules.json"), JSON.stringify({ rules: [{ name: "Allow ads here", match: "127.0.0.1/cosmetic-allowed", adblock: false }] }));
  const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")] });
  await app.evaluate(() => {
    const o = globalThis.fetch;
    globalThis.fetch = async (u, opt) => (/wikipedia|duckduckgo|brave\.com/.test(String(u)) ? new Response("{}", { status: 200 }) : o(u, opt));
  });
  const ui = await app.firstWindow();
  await sleep(2500);
  const go = async (url) => { await ui.fill("#omni", url); await ui.press("#omni", "Enter"); await sleep(3000); };
  const shown = (match) =>
    app.evaluate(({ webContents }, m) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().includes(m));
      return wc ? wc.executeJavaScript(`({ ad: getComputedStyle(document.getElementById("ad")).display !== "none", cookie: getComputedStyle(document.getElementById("cookie")).display !== "none", text: document.querySelector("p").offsetHeight > 0 })`) : null;
    }, match);

  await go(`${BASE}/cosmetic.html`);
  let s = await shown("cosmetic.html");
  check("a leftover ad box is hidden on the page", s && !s.ad && s.text, JSON.stringify(s));
  check("cookie notices stay unless asked", s && s.cookie, JSON.stringify(s));

  await go(`${BASE}/cosmetic-allowed.html`);
  s = await shown("cosmetic-allowed.html");
  check("a site rule that allows ads leaves the page alone", s && s.ad, JSON.stringify(s));

  await ui.evaluate(() => window.scout.setSettings({ adblock: false }));
  await go(`${BASE}/cosmetic.html?off=1`);
  s = await shown("cosmetic.html?off=1");
  check("with blocking off, nothing is hidden", s && s.ad, JSON.stringify(s));
  await ui.evaluate(() => window.scout.setSettings({ adblock: true }));

  await ui.evaluate(() => window.scout.setSettings({ adblockCookies: true }));
  await sleep(2500);
  check("Also hide cookie notices is saved", (await ui.evaluate(() => window.scout.getSettings())).adblockCookies === true);
  await go(`${BASE}/cosmetic.html?cookies=1`);
  s = await shown("cosmetic.html?cookies=1");
  check("with cookie notices on, the notice is hidden too", s && !s.cookie && !s.ad, JSON.stringify(s));
  const st = (await ui.evaluate(() => window.scout.getSettings())).adblockStats;
  check("the engine reports the full list set", st && st.mode === "full" && /^ready/.test(st.status), JSON.stringify(st));

  await ui.evaluate(() => window.scout.setSettings({ adblockCookies: false }));
  await sleep(2500);
  await go(`${BASE}/cosmetic.html?cookies=0`);
  s = await shown("cosmetic.html?cookies=0");
  check("turning it off brings cookie notices back", s && s.cookie && !s.ad, JSON.stringify(s));

  await app.evaluate(({ app }) => app.quit());
  console.log(failed ? `${failed} checks failed` : "all checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
