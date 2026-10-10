const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path");
const fs = require("fs");
const OUT = process.argv[2] || require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "scout-e2e-"));
const BASE = "http://127.0.0.1:8765";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);

(async () => {
  const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
  const app = await electron.launch({
    executablePath: require("electron"),
    args: ["--no-sandbox", `--user-data-dir=${userData}`, require("path").join(__dirname, "..", "..")],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
  });
  // Stub providers and dialogs inside the main process.
  await app.evaluate(({ dialog, app: a }, ud) => {
    a.setPath("userData", ud);
    globalThis.__dialogs = [];
    globalThis.__fetched = [];
    dialog.showMessageBox = async (_w, o) => {
      globalThis.__dialogs.push(o.message);
      return { response: 0, checkboxChecked: true };
    };
    const orig = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      globalThis.__fetched.push(u);
      if (u.includes("wikipedia.org/w/api.php")) {
        const q = new URL(u).searchParams.get("gsrsearch");
        const pages = {};
        for (let i = 0; i < 3; i++) pages[i] = { index: i, title: `Wiki: ${q} #${i + 1}`, fullurl: `http://127.0.0.1:8765/other.html?w=${encodeURIComponent(q)}&i=${i}`, extract: "Stub extract for " + q };
        return new Response(JSON.stringify({ query: { pages } }), { status: 200 });
      }
      if (u.includes("duckduckgo.com")) {
        const q = new URL(u).searchParams.get("q");
        const html = [0, 1].map((i) => `<a class="result__a" href="http://127.0.0.1:8765/other.html?d=${encodeURIComponent(q)}&i=${i}">Web: ${q} #${i + 1}</a><a class="result__snippet">snippet ${i}</a>`).join("");
        return new Response(html, { status: 200 });
      }
      return orig(url, opts);
    };
  }, userData);

  const ui = await app.firstWindow();
  await ui.waitForLoadState("domcontentloaded");
  await sleep(1500);

  // Navigate the first tab to the article.
  await ui.fill("#omni", BASE + "/article.html");
  await ui.press("#omni", "Enter");
  await sleep(5000);
  const chips = await ui.$$eval("#keys .key", (els) => els.map((e) => e.textContent.replace("×", "").trim()));
  log("keyword chips:", chips.join(" | "));
  log("status:", await ui.textContent("#suggest-status"));
  log("result cards:", await ui.$$eval("#results .card", (els) => els.length));
  log("notice (popup):", (await ui.textContent("#notice")).trim().slice(0, 90), "| hidden:", await ui.$eval("#notice", (e) => e.hidden));
  await ui.screenshot({ path: path.join(OUT, "ui-1.png") });

  // Pin the 2nd chip, hide the 3rd.
  await ui.click("#keys .key:nth-child(2)");
  await sleep(1500);
  await ui.click("#keys .key:nth-child(4) button");
  const t0 = Date.now();
  while ((await ui.textContent("#suggest-status")).startsWith("Searching") && Date.now() - t0 < 30000) await sleep(250);
  log("search finished after", Date.now() - t0, "ms");
  log("after pin + hide:", (await ui.$$eval("#keys .key", (els) => els.map((e) => e.textContent.replace("×", "").trim()))).join(" | "));
  log("hidden row:", (await ui.textContent("#hidden-keys")).trim());
  log("status:", await ui.textContent("#suggest-status"));

  // Gesture-backed popup: real mouse click on the target=_blank link.
  const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length);
  await app.evaluate(async ({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children[0];
    const r = await v.webContents.executeJavaScript("(() => { const b = document.getElementById('pop').getBoundingClientRect(); return {x: b.x + 5, y: b.y + 5}; })()");
    v.webContents.sendInputEvent({ type: "mouseDown", x: Math.round(r.x), y: Math.round(r.y), button: "left", clickCount: 1 });
    v.webContents.sendInputEvent({ type: "mouseUp", x: Math.round(r.x), y: Math.round(r.y), button: "left", clickCount: 1 });
  });
  await sleep(2500);
  const after = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length);
  log(`tabs before click ${before}, after click ${after}`);
  log("tab titles:", (await ui.$$eval("#tabs .tab span", (els) => els.map((e) => e.textContent))).join(" | "));
  const audio = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.map((v) => v.webContents.isAudioMuted()));
  log("muted per tab (active is the new one):", JSON.stringify(audio));

  // Back to first tab; press plain S inside the page -> screenshot.
  await ui.click("#tabs .tab:nth-child(1)");
  await sleep(800);
  await app.evaluate(({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children[0];
    v.webContents.focus();
    v.webContents.sendInputEvent({ type: "keyDown", keyCode: "S" });
    v.webContents.sendInputEvent({ type: "char", keyCode: "s" });
    v.webContents.sendInputEvent({ type: "keyUp", keyCode: "S" });
  });
  await sleep(2000);
  log("library open after S:", !(await ui.$eval("#shelf", (e) => e.hidden)), "| items:", await ui.$$eval("#library-list .poster", (els) => els.length));
  await ui.screenshot({ path: path.join(OUT, "ui-library.png") });
  await ui.click("#library-close");
  await sleep(500);

  // Select text in the page -> selection-driven search within ~5 s.
  await app.evaluate(({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children[0];
    v.webContents.executeJavaScript("(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('p3')); getSelection().removeAllRanges(); getSelection().addRange(r); })()");
  });
  await sleep(9000);
  log("after selecting the flour paragraph:", (await ui.$$eval("#keys .key", (els) => els.map((e) => e.textContent.replace("×", "").trim()))).join(" | "));
  log("status:", await ui.textContent("#suggest-status"));

  // Permissions.
  await ui.fill("#omni", BASE + "/perm.html");
  await ui.press("#omni", "Enter");
  await sleep(3000);
  const perm = await app.evaluate(async ({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children[0];
    return { page: await v.webContents.executeJavaScript("window.result"), dialogs: globalThis.__dialogs };
  });
  log("permission results:", JSON.stringify(perm));
  const n = (await app.evaluate(() => globalThis.__fetched.filter((u) => /wikipedia|duckduckgo/.test(u)).length));
  log("provider requests during whole run:", n);

  // Full-window capture including the tab view.
  await ui.fill("#omni", BASE + "/article.html");
  await ui.press("#omni", "Enter");
  await sleep(4000);
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const v = w.contentView.children[0];
    return (await v.webContents.capturePage()).toPNG().toString("base64");
  });
  fs.writeFileSync(path.join(OUT, "tab.png"), Buffer.from(png, "base64"));
  await ui.screenshot({ path: path.join(OUT, "ui-2.png") });
  await app.close();
})().catch((e) => {
  console.error("TEST ERROR", e);
  process.exit(1);
});
