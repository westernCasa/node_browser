// UI refresh: icon toolbar, collapsible suggestions widget, menu overlay,
// toolbar hidden in full screen, Capture menu.
// Run: node test/e2e/22-ui-refresh.js [outDir]   (xvfb-run -a on Linux)
// With SHOTS=1 it also saves full-screen captures of the X display
// (ImageMagick "import"), since the page views are not in the renderer's own
// screenshot.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(require("os").tmpdir(), "scout-e2e-"));
const BASE = "http://127.0.0.1:8765";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);
let failed = 0;
const check = (name, ok, extra = "") => {
  if (!ok) failed++;
  console.log(ok ? "✓" : "✗", name, extra);
};
const shoot = (name) => {
  if (!process.env.SHOTS) return;
  try {
    execFileSync("import", ["-window", "root", path.join(OUT, `${name}.png`)]);
  } catch (e) {
    log("screenshot failed:", e.message);
  }
};

(async () => {
  const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
  fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ firstRunDone: true }));
  const app = await electron.launch({
    executablePath: require("electron"),
    args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
  });
  await app.evaluate(({ app: a }, ud) => a.setPath("userData", ud), userData);
  const ui = await app.firstWindow();
  await ui.waitForLoadState("domcontentloaded");
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setBounds({ x: 0, y: 0, width: 1440, height: 900 });
  });
  // Skip first run if it shows.
  if (await ui.$eval("#firstrun", (e) => !e.hidden).catch(() => false)) {
    await ui.click("#fr-done");
    await sleep(300);
  }
  await ui.evaluate((u) => window.scout.navigate(document.querySelector("#tabs .tab.active")?.dataset.id || "1", u), `${BASE}/article.html`);
  await sleep(2500);

  const views = () =>
    app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return w.contentView.children.map((v) => v.getBounds());
    });

  // 1. Icon toolbar: every toolbar button has a name and a tooltip, no visible words.
  const tb = await ui.$$eval(".nav > .tb:not([hidden]), .tabrow .tb", (els) => els.map((e) => ({ id: e.id, label: e.getAttribute("aria-label"), title: e.title, text: e.textContent.trim() })));
  check("toolbar buttons are icons with a name and tooltip", tb.length >= 9 && tb.every((b) => b.label && b.title && !/[a-z]{3}/i.test(b.text)), tb.map((b) => `${b.id}="${b.title}"`).join(" | "));
  const mosaicTip = await ui.getAttribute("#layout-btn", "title");
  check("tooltip carries the shortcut", /M\)$/.test(mosaicTip), mosaicTip);
  shoot("01-normal");

  // 2. Widget collapses: the page widens; the toolbar button shows the count.
  let before = (await views())[0];
  await ui.click("#suggest-collapse");
  await sleep(300);
  let after = (await views())[0];
  check("collapsing the widget widens the page", after.width > before.width + 300, `${before.width} → ${after.width}`);
  check("rail hidden when collapsed", await ui.$eval("#rail", (e) => e.hidden));
  check("focus moves to the toolbar toggle", await ui.evaluate(() => document.activeElement?.id === "suggest-toggle"));
  log("toggle tooltip when collapsed:", await ui.getAttribute("#suggest-toggle", "title"));
  shoot("02-collapsed");
  await ui.click("#suggest-toggle");
  await sleep(300);
  after = (await views())[0];
  check("expanding gives the space back", after.width === before.width, `${after.width}`);
  await ui.click("#ask-btn");
  check("widget tab Ask shows the Ask pane", await ui.$eval("#ask-pane", (e) => !e.hidden));
  await ui.click("#suggest-tab");
  check("widget tab Suggest returns", await ui.$eval("#suggest-pane", (e) => !e.hidden));
  check("Settings and Trail are no longer in the widget", !(await ui.$("#rail #sources-btn")) && !(await ui.$("#rail #trail-btn")));

  // 3. Menu overlay: page views hidden, page picture behind, Esc closes and returns focus.
  await ui.click("#menu-btn");
  await sleep(600);
  check("menu overlay open", await ui.$eval("#menu-overlay", (e) => !e.hidden));
  check("page views hidden under the menu", (await views()).length === 0);
  check("page picture behind the menu", (await ui.$$("#menu-shots img")).length === 1);
  check("focus inside the menu", await ui.evaluate(() => document.getElementById("menu-panel").contains(document.activeElement)));
  shoot("03-menu-library");
  await ui.click("#sources-btn");
  await sleep(400);
  check("Settings section shows the sources pane", await ui.$eval("#sources-pane", (e) => !e.hidden));
  shoot("04-menu-settings");
  await ui.click("#trail-btn");
  await sleep(300);
  check("Trail section shows the trail", await ui.$eval("#trail-pane", (e) => !e.hidden));
  await ui.keyboard.press("Escape");
  await sleep(300);
  check("Esc closes the menu", await ui.$eval("#menu-overlay", (e) => e.hidden));
  check("focus back on the menu button", await ui.evaluate(() => document.activeElement?.id === "menu-btn"));
  check("page views back", (await views()).length === 1);

  // 4. Capture menu actions reach the existing tools (native menu itself not clickable here).
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("ui:command", { cmd: "capture", action: "shot" }));
  await sleep(1500);
  check("Capture → Screenshot opens the Library in the menu", await ui.$eval("#menu-overlay", (e) => !e.hidden) && (await ui.textContent("#shelf-title")) === "Library");
  check("screenshot saved", (await ui.$$("#library-list .poster")).length >= 1);
  await ui.click("#menu-close");
  await sleep(300);

  // 5. Full screen: toolbar hides, page fills the window, returns at the top edge.
  await app.evaluate(({ BrowserWindow, screen }) => {
    globalThis.__cursor = { x: 700, y: 500 };
    screen.getCursorScreenPoint = () => globalThis.__cursor;
    BrowserWindow.getAllWindows()[0].emit("enter-full-screen");
  });
  await sleep(300);
  check("hint shown on entering full screen", await ui.$eval("#chrome-hint", (e) => !e.hidden && e.textContent.length > 10));
  await sleep(2200);
  let v = (await views())[0];
  check("toolbar hidden: page starts at the top", v.y === 0, JSON.stringify(v));
  check("renderer marks the toolbar hidden", await ui.evaluate(() => document.body.classList.contains("chrome-hidden")));
  shoot("05-fullscreen-hidden");
  await app.evaluate(({ BrowserWindow }) => {
    const b = BrowserWindow.getAllWindows()[0].getContentBounds();
    globalThis.__cursor = { x: b.x + 600, y: b.y + 1 };
  });
  await sleep(400);
  v = (await views())[0];
  check("pointer at the top edge shows the toolbar", v.y === 96, JSON.stringify(v));
  shoot("06-fullscreen-revealed");
  await app.evaluate(({ BrowserWindow }) => {
    const b = BrowserWindow.getAllWindows()[0].getContentBounds();
    globalThis.__cursor = { x: b.x + 600, y: b.y + 500 };
  });
  await sleep(900);
  check("pointer moving down hides it again", (await views())[0].y === 0);
  await ui.evaluate(() => window.scout.holdChrome(true));
  await sleep(300);
  check("address bar in use keeps the toolbar", (await views())[0].y === 96);
  await ui.evaluate(() => window.scout.holdChrome(false));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit("leave-full-screen"));
  await sleep(300);
  check("leaving full screen restores the layout", (await views())[0].y === 96 && !(await ui.evaluate(() => document.body.classList.contains("immersive"))));

  await app.close();
  console.log(failed ? `${failed} checks failed` : "all checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
