// Browser basics: error and crash pages, reopen closed tab, tab shortcuts,
// right-click menu items, downloads, Save as PDF, session restore with
// sleeping tabs, sleeping idle tabs.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path"), fs = require("fs"), os = require("os");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "scout-e2e-"));
const BASE = "http://127.0.0.1:8765";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);
(async () => {
  const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
  const downloadsDir = fs.mkdtempSync(path.join(OUT, "dl-"));
  const launch = async () => {
    const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")] });
    await app.evaluate(({ app: a }, dir) => {
      a.setPath("downloads", dir);
      const real = globalThis.fetch;
      globalThis.fetch = async (u, o) => (/wikipedia|duckduckgo/.test(String(u)) ? new Response("{}", { status: 200 }) : real(u, o));
    }, downloadsDir);
    const ui = await app.firstWindow();
    await sleep(1500);
    return { app, ui };
  };
  let { app, ui } = await launch();
  const go = async (u, wait = 1800) => {
    await ui.fill("#omni", u);
    await ui.press("#omni", "Enter");
    await sleep(wait);
  };
  const menu = (top, label) => app.evaluate(({ Menu }, [t, l]) => Menu.getApplicationMenu().items.find((i) => i.label === t).submenu.items.find((i) => i.label === l).click(), [top, label]);
  const urls = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.getURL()).filter((u) => !u.includes("renderer/index.html")));
  const tabTitles = () => ui.$$eval("#tabs .tab", (e) => e.map((x) => x.textContent.replace(/[×🔊🔇]/gu, "").trim()));

  // Error page.
  await go("http://127.0.0.1:9/nothing-here", 2500);
  log("failed load shows:", (await urls()).some((u) => u.includes("error.html")), "| address bar keeps:", await ui.$eval("#omni", (e) => e.value), "| tab title:", (await tabTitles())[0]);

  // Crash page.
  await go(BASE + "/article.html");
  await app.evaluate(({ webContents }) => webContents.getAllWebContents().find((w) => w.getURL().includes("article.html")).forcefullyCrashRenderer());
  await sleep(1500);
  log("crashed tab shows:", (await tabTitles())[0], "| page:", (await urls()).find((u) => u.includes("error.html"))?.match(/kind=\w+/)?.[0]);

  // Tabs: open three, close one, reopen it, shortcuts.
  await go(BASE + "/article.html");
  await ui.evaluate((b) => window.scout.createTab(b + "/other.html"), BASE);
  await sleep(1200);
  await ui.evaluate((b) => window.scout.createTab(b + "/media.html"), BASE);
  await sleep(1500);
  log("tabs:", (await tabTitles()).join(" | "));
  await menu("File", "Close Tab");
  await sleep(800);
  log("after Close Tab:", (await tabTitles()).length, "tabs");
  await menu("File", "Reopen Closed Tab");
  await sleep(1500);
  log("after Reopen Closed Tab:", (await tabTitles()).join(" | "));
  await menu("View", "Tab 1");
  await sleep(500);
  const active1 = await ui.$eval("#tabs .tab.active", (e) => e.textContent);
  await menu("View", "Next Tab");
  await sleep(500);
  log("Tab 1 →", active1.replace("×", "").trim(), "| Next Tab →", (await ui.$eval("#tabs .tab.active", (e) => e.textContent)).replace("×", "").trim());

  // Right-click menu items.
  const id = await ui.$eval("#tabs .tab.active", (e) => e.dataset.id);
  const items = (p) => app.evaluate(({}, [i, q]) => global.nodeTest.contextMenuItems(i, q), [id, p]);
  log("menu on a link:", (await items({ linkURL: BASE + "/x.html", x: 1, y: 1 })).join(", "));
  log("menu on an image:", (await items({ mediaType: "image", srcURL: BASE + "/img/IMG_2041.jpg", x: 1, y: 1 })).join(", "));
  log("menu on selected text:", (await items({ selectionText: "sourdough starter", x: 1, y: 1 })).join(", "));
  log("menu on the page:", (await items({ x: 1, y: 1 })).join(", "));
  // NODE's page scripts run in their own world: the page cannot see them.
  const seen = await app.evaluate(({ webContents }) => webContents.getAllWebContents().find((w) => /\/(article|other|media)\.html/.test(w.getURL())).executeJavaScript(`Object.keys(window).filter((k) => /scout|node/i.test(k)).join(",") || "none"`));
  log("NODE globals visible to the page:", seen);
  // A Mac right-click on a quote mark selects just that mark: no search or pin items.
  log("menu on a lone quote mark:", (await items({ selectionText: '"', x: 1, y: 1 })).join(", "));

  // Downloads.
  await app.evaluate(({ webContents }, b) => webContents.getAllWebContents().find((w) => /\/(article|other|media)\.html/.test(w.getURL())).downloadURL(b + "/clip.webm"), BASE);
  await app.evaluate(({ webContents }, b) => webContents.getAllWebContents().find((w) => /\/(article|other|media)\.html/.test(w.getURL())).downloadURL(b + "/clip.webm"), BASE);
  await sleep(2500);
  const dls = await ui.evaluate(() => window.scout.downloads());
  log("downloads:", dls.map((d) => `${d.name} ${d.state}`).join(" | "), "| files:", fs.readdirSync(downloadsDir).join(", "));
  await ui.click("#menu-btn");
  await sleep(500);
  await ui.click('.mnav[data-section="downloads"]');
  await sleep(500);
  log("Library → Downloads rows:", await ui.$$eval(".download-row", (e) => e.length));
  await ui.click("#menu-close");
  await sleep(300);

  // Save as PDF.
  await app.evaluate(({}, i) => global.nodeTest.savePdf(i), id);
  await sleep(2000);
  log("PDF saved:", fs.readdirSync(downloadsDir).filter((f) => f.endsWith(".pdf")).join(", "));

  // Sleeping tabs: time away does not count; then pretend 40 minutes of use passed.
  const away = await app.evaluate(() => global.nodeTest.sleepIdleTabs({ step: 40 * 60 * 1000, inUse: false }));
  log("tabs put to sleep while away:", away);
  const slept = await app.evaluate(() => global.nodeTest.sleepIdleTabs({ step: 40 * 60 * 1000, inUse: true }));
  await sleep(800);
  log("tabs put to sleep:", slept, "| asleep in the tab bar:", await ui.$$eval("#tabs .tab.asleep", (e) => e.length), "| titles kept:", (await tabTitles()).join(" | "));
  await ui.click("#tabs .tab.asleep");
  await sleep(1500);
  log("clicked sleeping tab woke:", await ui.$$eval("#tabs .tab.asleep", (e) => e.length), "asleep left | its page loaded:", (await urls()).filter((u) => /\/(article|other|media)\.html/.test(u)).length, "pages");

  // Session restore.
  const before = await tabTitles();
  await app.close();
  const saved = JSON.parse(fs.readFileSync(path.join(userData, "tabs.json"), "utf8"));
  log("saved tabs:", saved.tabs.length, "| active:", saved.active);
  ({ app, ui } = await launch());
  await sleep(1500);
  const after = await tabTitles();
  log("restored tabs:", after.length, "of", before.length, "| same titles:", JSON.stringify(after) === JSON.stringify(before), "| asleep:", await ui.$$eval("#tabs .tab.asleep", (e) => e.length), "| pages loaded:", (await urls()).filter((u) => /^http/.test(u)).length);
  await ui.screenshot({ path: path.join(OUT, "basics.png") });
  await app.close();
  process.exit(0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
