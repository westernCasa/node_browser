// Clicking media scrolls it to the middle of the view (site rule "center"),
// and "Sound: all" makes every playing tab audible.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path");
const fs = require("fs");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(require("os").tmpdir(), "scout-e2e-"));
const BASE = "http://127.0.0.1:8765";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);

(async () => {
  const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
  fs.writeFileSync(
    path.join(userData, "rules.json"),
    JSON.stringify({ rules: [{ match: "*", autoplay: "on" }, { name: "No centering", match: "127.0.0.1/center-off", center: false }] })
  );
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

  const tabRun = (code, match = "center") =>
    app.evaluate(({ webContents }, [code, match]) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().includes(match));
      return wc.executeJavaScript(code);
    }, [code, match]);
  // Scroll so the element's top edge is near the bottom of the view, then click it.
  const clickAt = async (id, match) => {
    const r = await tabRun(`(() => { const el = document.getElementById(${JSON.stringify(id)}); window.scrollBy(0, el.getBoundingClientRect().top - innerHeight + 60); const b = el.getBoundingClientRect(); return { x: Math.round(b.left + Math.min(b.width, 200) / 2), y: Math.round(b.top + 20) }; })()`, match);
    await sleep(300);
    await app.evaluate(({ webContents }, [r, match]) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().includes(match));
      wc.sendInputEvent({ type: "mouseDown", x: r.x, y: r.y, button: "left", clickCount: 1 });
      wc.sendInputEvent({ type: "mouseUp", x: r.x, y: r.y, button: "left", clickCount: 1 });
    }, [r, match]);
    await sleep(1500);
  };
  const offCenter = (id, match) =>
    tabRun(`(() => { const b = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return Math.round(b.top + b.height / 2 - innerHeight / 2); })()`, match);

  await ui.fill("#omni", `${BASE}/center.html`);
  await ui.press("#omni", "Enter");
  await sleep(2500);
  await clickAt("v1", "center.html");
  log(`video (clicked at the bottom edge of the view), after click: ${await offCenter("v1", "center.html")} px from the middle`);
  await clickAt("ov", "center.html");
  log(`video under a player overlay, after click: ${await offCenter("v2", "center.html")} px from the middle`);
  await clickAt("icon", "center.html");
  log(`32 px icon, after click: ${await offCenter("icon", "center.html")} px from the middle (not centered)`);
  await clickAt("emb", "center.html");
  log(`embedded player (iframe), after click: ${await offCenter("emb", "center.html")} px from the middle`);

  await ui.fill("#omni", `${BASE}/center-off.html`);
  await ui.press("#omni", "Enter");
  await sleep(2500);
  await clickAt("v1", "center-off");
  log(`site rule center=false, video after click: ${await offCenter("v1", "center-off")} px from the middle (not centered)`);

  // Sound from all tabs.
  await ui.fill("#omni", `${BASE}/video-main.html?n=1`);
  await ui.press("#omni", "Enter");
  await sleep(2000);
  await ui.click("#new-tab");
  await sleep(800);
  await ui.fill("#omni", `${BASE}/video-main.html?n=2`);
  await ui.press("#omni", "Enter");
  await sleep(2000);
  const muted = () =>
    app.evaluate(({ webContents }) =>
      webContents.getAllWebContents().filter((w) => w.getURL().includes("video-main")).sort((a, b) => a.id - b.id).map((w) => w.isAudioMuted())
    );
  log("Sound: one — muted per video tab:", JSON.stringify(await muted()), "| button:", await ui.getAttribute("#sound-btn", "aria-label"));
  await ui.click("#sound-btn");
  await sleep(600);
  log("Sound: all — muted per video tab:", JSON.stringify(await muted()), "| button:", await ui.getAttribute("#sound-btn", "aria-label"));
  await ui.click("#sound-btn");
  await sleep(600);
  log("back to Sound: one — muted per video tab:", JSON.stringify(await muted()));

  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
