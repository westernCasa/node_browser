// Ad and tracker blocking, visible (B73): the shield next to the address
// counts what was blocked on the page, resets on the next page, shows when
// blocking is off (Settings or a site rule), and its menu lists the sites
// blocked, the switch and the What NODE sends link.
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
  fs.writeFileSync(path.join(userData, "adblock.bin"), ElectronBlocker.parse("/adbanner.\n||tracker.test^").serialize());
  fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ firstRunDone: true }));
  fs.writeFileSync(path.join(userData, "rules.json"), JSON.stringify({ rules: [{ name: "Allow ads here", match: "127.0.0.1/ads-allowed", adblock: false }] }));
  const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")] });
  await app.evaluate(() => {
    const o = globalThis.fetch;
    globalThis.fetch = async (u, opt) => (/wikipedia|duckduckgo|brave\.com/.test(String(u)) ? new Response("{}", { status: 200 }) : o(u, opt));
  });
  const ui = await app.firstWindow();
  await sleep(2500);
  const go = async (url) => { await ui.fill("#omni", url); await ui.press("#omni", "Enter"); await sleep(2500); };
  const shield = () => ui.evaluate(() => {
    const b = document.getElementById("shield-btn");
    return { count: b.querySelector(".count").hidden ? "" : b.querySelector(".count").textContent, glyph: b.querySelector("use").getAttribute("href"), tip: b.getAttribute("aria-label"), muted: b.classList.contains("muted") };
  });
  const menuLabels = () =>
    app.evaluate(({ Menu }) => {
      const orig = Menu.prototype.popup;
      let seen = null;
      Menu.prototype.popup = function () { seen = this.items.map((i) => (i.type === "separator" ? "-" : i.label + (i.type === "checkbox" ? (i.checked ? " [on]" : " [off]") : ""))); };
      return new Promise((r) => setTimeout(() => { Menu.prototype.popup = orig; r(seen); }, 900));
    });

  await go(`${BASE}/ads.html`);
  // Also a tracker request, from the page.
  await app.evaluate(({ webContents }) => webContents.getAllWebContents().find((w) => /ads\.html/.test(w.getURL())).executeJavaScript(`(() => { const i = new Image(); i.src = "http://tracker.test/pixel.gif"; document.body.appendChild(i); return 1; })()`));
  await sleep(1500);
  let s = await shield();
  check("the shield counts ads and trackers blocked on the page", s.count === "2" && /#i-shield$/.test(s.glyph), JSON.stringify(s));
  check("its name says how many", /2 ads and trackers blocked on this page/.test(s.tip), s.tip);
  const waitMenu = menuLabels();
  await ui.click("#shield-btn");
  const items = await waitMenu;
  check("the menu lists the count and the sites blocked", items && /2 ads and trackers blocked/.test(items[0]) && items.some((l) => /127\.0\.0\.1 {2}· {2}1|tracker\.test {2}· {2}1/.test(l)), (items || []).join(" | "));
  check("the menu has the switch and What NODE sends", items && items.includes("Block Ads and Trackers [on]") && items.includes("What NODE Sends…"));

  await go(`${BASE}/other.html`);
  s = await shield();
  check("the count starts again on the next page", s.count === "" && /None on this page yet/.test(s.tip), JSON.stringify(s));

  await go(`${BASE}/ads-allowed.html`);
  s = await shield();
  check("a site rule that allows ads shows a crossed-out shield", s.muted && /shield-off/.test(s.glyph) && /site rule/.test(s.tip), JSON.stringify(s));

  await ui.evaluate(() => window.scout.setSettings({ adblock: false }));
  await go(`${BASE}/ads.html?off=1`);
  s = await shield();
  check("blocking off in Settings shows a crossed-out shield", s.muted && /blocking is off/.test(s.tip), JSON.stringify(s));
  await ui.evaluate(() => window.scout.setSettings({ adblock: true }));

  // PR #42: the window that holds NODE's own bridge never leaves NODE's
  // pages and opens no windows; permissions NODE doesn't know are refused.
  const before = await ui.evaluate(() => location.href);
  await ui.evaluate(() => {
    try {
      location.href = "https://example.com/";
    } catch (_) {}
  });
  await sleep(800);
  check("the NODE window can't be sent to a web page", (await ui.evaluate(() => location.href)) === before && before.startsWith("file:"));
  check("the NODE window opens no new windows", (await ui.evaluate(() => window.open("https://example.com/") === null)) && (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)) === 1);
  const state = await ui.evaluate(async () => (await navigator.permissions.query({ name: "persistent-storage" })).state);
  check("permissions NODE doesn't list (here: persistent storage) are refused when checked", state !== "granted", state);

  const welcome = fs.readFileSync(path.join(__dirname, "..", "..", "renderer", "index.html"), "utf8");
  check("the welcome screen says NODE blocks ads and trackers", /NODE blocks ads and trackers on every page/.test(welcome));

  await app.evaluate(({ app }) => app.quit());
  console.log(failed ? `${failed} checks failed` : "all checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
