// Desktop gestures: two-finger swipe back and forward, no swipe inside a
// sideways-scrolling area, mouse side buttons, middle-click on a link and on a
// tab, double-click on the tab bar, drag to reorder tabs.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path");
const fs = require("fs");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(require("os").tmpdir(), "scout-e2e-"));
const BASE = "http://127.0.0.1:8765";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);

(async () => {
  const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
  const app = await electron.launch({
    executablePath: require("electron"),
    args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
  });
  await app.evaluate(({ app: a }, ud) => {
    a.setPath("userData", ud);
    globalThis.fetch = async (url) =>
      String(url).includes("wikipedia.org/w/api.php")
        ? new Response(JSON.stringify({ query: { pages: {} } }), { status: 200 })
        : new Response("", { status: 200 });
  }, userData);
  const ui = await app.firstWindow();
  await ui.waitForLoadState("domcontentloaded");
  await sleep(1500);

  const go = async (url) => {
    await ui.fill("#omni", url);
    await ui.press("#omni", "Enter");
    await sleep(1500);
  };
  // The active tab's page (the one with bounds on screen).
  const activeUrl = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.getURL());
  const send = (events) =>
    app.evaluate(({ BrowserWindow }, events) => {
      const v = BrowserWindow.getAllWindows()[0].contentView.children[0];
      for (const ev of events) v.webContents.sendInputEvent(ev);
    }, events);
  const swipe = async (dx, x = 300, y = 500) => {
    const evs = [];
    for (let i = 0; i < 12; i++) evs.push({ type: "mouseWheel", x, y, deltaX: dx, deltaY: 0, canScroll: true });
    await send(evs);
    await sleep(1200);
  };

  await go(`${BASE}/gestures.html`);
  await go(`${BASE}/other.html?n=2`);
  // Which sign Electron's synthetic wheel uses: find the one that goes back.
  await swipe(40);
  let url = await activeUrl();
  let backSign = 40;
  if (!url.includes("gestures")) {
    await swipe(-40);
    url = await activeUrl();
    backSign = -40;
  }
  log("two-finger swipe toward back:", url.includes("gestures") ? "went back" : "did not go back", `(${url.replace(BASE, "")})`);
  await swipe(-backSign);
  log("two-finger swipe the other way:", (await activeUrl()).includes("other.html") ? "went forward" : "did not go forward");
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.goBack());
  await sleep(1200);
  // Inside the sideways-scrolling strip (scrolled to the middle): no navigation.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.executeJavaScript("document.getElementById('strip').scrollLeft = 300"));
  const strip = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.executeJavaScript("(() => { const b = document.getElementById('strip').getBoundingClientRect(); return { x: Math.round(b.left + 100), y: Math.round(b.top + 50) }; })()")
  );
  await swipe(backSign, strip.x, strip.y);
  log("same swipe over a sideways-scrolling area:", (await activeUrl()).includes("gestures") ? "stayed (the area scrolled)" : "navigated (wrong)");

  // Mouse side buttons.
  await go(`${BASE}/other.html?n=3`);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.executeJavaScript("window.dispatchEvent(new MouseEvent('mouseup', { button: 3 }))")
  );
  await sleep(1200);
  log("mouse back button:", (await activeUrl()).includes("gestures") ? "went back" : "did not go back");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.executeJavaScript("window.dispatchEvent(new MouseEvent('mouseup', { button: 4 }))")
  );
  await sleep(1200);
  log("mouse forward button:", (await activeUrl()).includes("n=3") ? "went forward" : "did not go forward");
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.goBack());
  await sleep(1200);

  // Middle-click a link: opens a new tab in the background.
  const tabCount = () => ui.$$eval("#tabs .tab", (e) => e.length);
  const link = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.executeJavaScript("(() => { const b = document.getElementById('link').getBoundingClientRect(); return { x: Math.round(b.left + 5), y: Math.round(b.top + 5) }; })()")
  );
  await send([
    { type: "mouseDown", x: link.x, y: link.y, button: "middle", clickCount: 1 },
    { type: "mouseUp", x: link.x, y: link.y, button: "middle", clickCount: 1 },
  ]);
  await sleep(1500);
  log("middle-click on a link: tabs", await tabCount(), "| still on:", (await activeUrl()).replace(BASE, ""));

  // Double-click the empty tab bar: new tab.
  const bar = await ui.$eval("#tabs", (e) => { const r = e.getBoundingClientRect(); return { x: r.right - 5, y: r.top + r.height / 2 }; });
  await ui.mouse.dblclick(bar.x, bar.y);
  await sleep(1200);
  log("double-click on the empty tab bar: tabs", await tabCount());

  // Drag the last tab to the front.
  const titles = () => ui.$$eval("#tabs .tab span", (e) => e.map((x) => x.textContent));
  log("tab order before drag:", (await titles()).join(" | "));
  await ui.dragAndDrop("#tabs .tab:last-child", "#tabs .tab:first-child", { targetPosition: { x: 3, y: 8 } });
  await sleep(1200);
  log("after dragging the last tab to the front:", (await titles()).join(" | "));

  // Middle-click a tab: closes it.
  await ui.click("#tabs .tab:first-child", { button: "middle" });
  await sleep(1200);
  log("middle-click on the first tab: tabs", await tabCount(), "|", (await titles()).join(" | "));

  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
