// Picture-in-picture, bookmarks, and ad and tracker blocking (with a small
// test filter list cached in userData, so no network is needed).
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path");
const fs = require("fs");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(require("os").tmpdir(), "scout-e2e-"));
const BASE = "http://127.0.0.1:8765";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);

(async () => {
  const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
  // Test filter list: blocks any address containing "/adbanner.".
  const { ElectronBlocker } = require("@ghostery/adblocker-electron");
  fs.writeFileSync(path.join(userData, "adblock.bin"), ElectronBlocker.parse("/adbanner.\n||tracker.test^").serialize());
  fs.writeFileSync(
    path.join(userData, "rules.json"),
    JSON.stringify({ rules: [{ match: "*", autoplay: "on" }, { name: "Allow ads here", match: "127.0.0.1/ads-allowed", adblock: false }] })
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
  await sleep(2000);

  const page = (code) =>
    app.evaluate(({ BrowserWindow }, code) => BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.executeJavaScript(code), code);
  const go = async (url) => {
    await ui.fill("#omni", url);
    await ui.press("#omni", "Enter");
    await sleep(2500);
  };
  const imgs = () => page(`(() => ({ ad: document.getElementById("ad").naturalWidth > 0, photo: document.getElementById("ok").naturalWidth > 0 }))()`);

  // Ad and tracker blocking.
  await go(`${BASE}/ads.html`);
  log("ads on: ad image loaded / photo loaded:", JSON.stringify(await imgs()));
  const st = await ui.evaluate(() => window.scout.getSettings());
  log("Settings: adblock", st.adblock, "| status:", st.adblockStats.status, "| blocked:", st.adblockStats.blocked);
  await go(`${BASE}/ads-allowed.html`);
  log("site rule adblock=false: ad image loaded:", (await imgs()).ad);
  await ui.evaluate(() => window.scout.setSettings({ adblock: false }));
  await go(`${BASE}/ads.html?again=1`);
  log("blocking turned off in Settings: ad image loaded:", (await imgs()).ad);
  await ui.evaluate(() => window.scout.setSettings({ adblock: true }));

  // Bookmarks.
  await go(`${BASE}/other.html?bm=1`);
  log("star before:", await ui.getAttribute("#star-btn", "aria-label"));
  await ui.click("#star-btn");
  await sleep(600);
  log("star after click:", await ui.getAttribute("#star-btn", "aria-label"), "| saved:", JSON.stringify((await ui.evaluate(() => window.scout.bookmarkSearch("", 10))).map((b) => b.title)));
  await ui.fill("#omni", "levain");
  await ui.dispatchEvent("#omni", "input");
  await sleep(600);
  log("address-bar suggestions:", JSON.stringify(await ui.$$eval("#history-list option", (o) => o.map((x) => x.label))));
  await ui.press("#omni", "Escape");
  await ui.evaluate(() => {
    document.querySelector('.mnav[data-section="bookmarks"]').click();
  });
  await sleep(800);
  log("Bookmarks shelf rows:", await ui.$$eval("#library-list .history-row .t", (e) => e.map((x) => x.textContent).join(" | ")));
  await ui.click("#menu-close");
  await sleep(500);
  const prefs = JSON.parse(fs.readFileSync(path.join(userData, "bookmarks.json"), "utf8"));
  log("bookmarks.json entries:", prefs.length);

  // Picture-in-picture.
  await go(`${BASE}/video-main.html?pip=1`);
  await ui.evaluate(() => document.querySelector('#pip-btn').click()); // in the menu overlay or the hidden Capture actions
  await sleep(1200);
  log("after PiP button: video in picture-in-picture:", await page(`!!document.pictureInPictureElement && document.pictureInPictureElement.id`));
  await ui.evaluate(() => document.querySelector('#pip-btn').click()); // in the menu overlay or the hidden Capture actions
  await sleep(800);
  log("after second click: picture-in-picture closed:", await page(`!document.pictureInPictureElement`));

  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
