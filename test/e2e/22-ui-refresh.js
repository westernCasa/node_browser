// UI refresh: icon toolbar, collapsible suggestions widget, menu overlay,
// Capture menu, and (since B103) the sidebar sliding over the page at the
// left edge, in full screen too.
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

  // Positions of the page view, sampled every 10 ms in the main process (motion 09).
  const startSampling = () =>
    app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      globalThis.__ys = [];
      clearInterval(globalThis.__sampler);
      globalThis.__sampler = setInterval(() => globalThis.__ys.push(w.contentView.children[0]?.getBounds().y), 10);
    });
  const stopSampling = () =>
    app.evaluate(() => {
      clearInterval(globalThis.__sampler);
      return globalThis.__ys;
    });
  // Distinct positions between start and end, and whether they only go one way.
  const slide = (ys, from, to) => {
    const between = [...new Set(ys.filter((y) => y > Math.min(from, to) && y < Math.max(from, to)))];
    const oneWay = ys.every((y, i) => i === 0 || (to > from ? y >= ys[i - 1] : y <= ys[i - 1]));
    return { steps: between.length, oneWay, end: ys[ys.length - 1] };
  };

  // 1. Icon toolbar: every toolbar button has a name and a tooltip, no visible words.
  const tb = await ui.$$eval(".sb-addr-row .tb:not([hidden]), .sb-tools .tb, .sb-tabs-head .tb", (els) => els.map((e) => ({ id: e.id, label: e.getAttribute("aria-label"), title: e.title, text: e.textContent.trim() })));
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

  // 5. The sidebar over the page (B103), in full screen too: the page fills the
  // window and never moves; the sidebar is a layer above it that slides in
  // from the left edge and back out. The pointer comes from a stand-in for
  // screen.getCursorScreenPoint.
  const pageView = () => app.evaluate(({ BrowserWindow, webContents }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const ov = webContents.getAllWebContents().find((c) => c.getURL().endsWith("chrome-overlay.html"));
    const kids = w.contentView.children;
    const layer = kids.find((v) => v.webContents === ov);
    return { page: kids.find((v) => v !== layer)?.getBounds(), layer: layer ? layer.getBounds() : null, layerOnTop: Boolean(layer) && kids[kids.length - 1] === layer, h: w.getContentSize()[1] };
  });
  const inLayer = (js) => app.evaluate(({ webContents }, code) => webContents.getAllWebContents().find((c) => c.getURL().endsWith("chrome-overlay.html"))?.executeJavaScript(code), js);
  const pointer = (x, y) => app.evaluate(({ BrowserWindow }, [x, y]) => {
    const b = BrowserWindow.getAllWindows()[0].getContentBounds();
    globalThis.__cursor = { x: b.x + x, y: b.y + y };
  }, [x, y]);
  await app.evaluate(({ screen }) => {
    globalThis.__cursor = { x: 700, y: 500 };
    screen.getCursorScreenPoint = () => globalThis.__cursor;
  });
  await pointer(700, 400);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit("enter-full-screen"));
  await sleep(600);
  let st = await pageView();
  check("full screen: the page fills the window, no toolbar and no sidebar on it", st.page.x === 0 && st.page.y === 0 && st.page.height === st.h && !st.layerOnTop, JSON.stringify(st));
  await pointer(3, 400);
  await sleep(120);
  const midway = await inLayer("new DOMMatrix(getComputedStyle(document.getElementById('bar')).transform).m41");
  await sleep(400);
  st = await pageView();
  check("pointer at the left edge: the sidebar slides in over the page", st.layerOnTop && st.layer.x === 0 && st.layer.width === 300 && st.layer.height === st.h, JSON.stringify(st));
  check("partway it is still coming in", midway < 0 && midway > -300, `at ${Math.round(midway)}px`);
  const curve = await inLayer("getComputedStyle(document.getElementById('bar')).transitionTimingFunction");
  check("it comes in on the --ease-enter cubic-bezier", String(curve).startsWith("cubic-bezier(0, 0, 0.2, 1)"), curve);
  check("the page stays where it is", st.page.x === 0 && st.page.y === 0, JSON.stringify(st.page));
  check("the layer shows a copy of the sidebar", (await inLayer("document.body.classList.contains('shown') && !!document.querySelector('#bar #omni') && !!document.querySelector('#bar #menu-btn')")) === true);
  shoot("05-sidebar-over-page");
  // A button in the layer reaches the real one.
  const panelBefore = await ui.$eval("#suggest-toggle", (e) => e.getAttribute("aria-pressed"));
  await inLayer("document.querySelector('#bar #suggest-toggle').click()");
  await sleep(700);
  const panelAfter = await ui.$eval("#suggest-toggle", (e) => e.getAttribute("aria-pressed"));
  check("a button in the layer works (suggestions toggle)", panelBefore !== panelAfter, `${panelBefore} → ${panelAfter}`);
  check("the layer shows the new state", (await inLayer("document.querySelector('#bar #suggest-toggle').getAttribute('aria-pressed')")) === panelAfter);
  await inLayer("document.querySelector('#bar #suggest-toggle').click()");
  await sleep(500);
  await pointer(150, 400);
  await sleep(500);
  check("the pointer over the sidebar keeps it", (await pageView()).layerOnTop);
  await pointer(700, 400);
  await sleep(700);
  check("the pointer leaves: it slides away after 250 ms and the layer is removed", (await pageView()).layer === null);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit("leave-full-screen"));
  await sleep(300);
  st = await pageView();
  check("leaving full screen: the page still fills the window", st.page.x === 0 && st.page.y === 0 && st.layer === null && !(await ui.evaluate(() => document.body.classList.contains("immersive"))), JSON.stringify(st));

  await app.close();
  console.log(failed ? `${failed} checks failed` : "all checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
