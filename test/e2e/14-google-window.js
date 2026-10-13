// B52 checks: Google account pages open in the Google window (a separate
// Chromium-based browser started by NODE), the NODE tab shows a placeholder,
// the NODE extension connects back, visits reach NODE's history, and opening
// an address that is already open there does not open it twice.
// Needs NODE_GOOGLE_BROWSER (a Chromium binary); the test sets it to
// Playwright's Chromium when it is not given.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path"), fs = require("fs");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(require("os").tmpdir(), "scout-e2e-")), BASE = "http://127.0.0.1:8765";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);
const CHROMIUM = process.env.NODE_GOOGLE_BROWSER || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const DEBUG_PORT = 9339;
(async () => {
  const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
  const app = await electron.launch({
    executablePath: require("electron"),
    args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")],
    env: { ...process.env, NODE_GOOGLE_BROWSER: CHROMIUM, NODE_GOOGLE_EXTRA_ARGS: `--remote-debugging-port=${DEBUG_PORT} --no-sandbox` },
  });
  const ui = await app.firstWindow();
  await sleep(1500);
  const companionTabs = async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      return (await r.json()).filter((t) => t.type === "page").map((t) => t.url);
    } catch (_) {
      return null;
    }
  };

  // 1. Typing a Google sign-in address: the NODE tab shows the placeholder.
  await ui.fill("#omni", "https://accounts.google.com/signin");
  await ui.press("#omni", "Enter");
  await sleep(4000);
  log("address bar shows:", await ui.$eval("#omni", (e) => e.value));
  const tabUrl = await app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.getURL()).find((u) => u.includes("google-tab.html")) || "none");
  log("NODE tab is the placeholder:", tabUrl.includes("google-tab.html"));
  log("notice:", (await ui.textContent("#notice").catch(() => "")).slice(0, 60));
  await ui.screenshot({ path: path.join(OUT, "google-placeholder.png") });

  // 2. The companion window started and the NODE extension connected.
  let st = null;
  for (let i = 0; i < 20; i++) {
    st = await app.evaluate(() => global.nodeCompanion.status());
    if (st.link === "linked") break;
    await sleep(500);
  }
  log("companion status:", JSON.stringify({ browser: st.browser, link: st.link, error: st.error }));
  log("companion tabs:", JSON.stringify(await companionTabs()));
  const profile = path.join(userData, "google-window", "profile");
  log("own profile folder created:", fs.existsSync(profile));

  // 3. A page opened in the companion is recorded in NODE's history.
  await app.evaluate((_e, u) => global.nodeCompanion.open(u), BASE + "/article.html");
  await sleep(4000);
  const hits = await ui.evaluate(() => window.scout.historySearch("sourdough", 5));
  log("history has the companion visit:", hits.some((h) => h.url.includes("/article.html")));

  // 4. Opening the same address again shows the open tab instead of a new one.
  const before = (await companionTabs()) || [];
  await app.evaluate((_e, u) => global.nodeCompanion.open(u), BASE + "/article.html");
  await sleep(3000);
  const after = (await companionTabs()) || [];
  const count = (l) => l.filter((u) => u.includes("/article.html")).length;
  log("article tabs before / after second open:", count(before), "/", count(after), "| helper tabs left:", after.filter((u) => u.includes("/node/open")).length);

  // 5. A link to Gmail inside a normal page goes to the Google window and the page stays.
  await ui.fill("#omni", BASE + "/other.html");
  await ui.press("#omni", "Enter");
  await sleep(1500);
  await app.evaluate(({ webContents }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes("/other.html"));
    wc.executeJavaScript(`location.href = "https://mail.google.com/mail/u/0/"`);
  });
  await sleep(2500);
  log("page after Gmail link:", await ui.$eval("#omni", (e) => e.value));
  log("companion has Gmail:", ((await companionTabs()) || []).some((u) => u.includes("mail.google.com") || u.includes("accounts.google.com") || u.includes("/node/open")));

  // 6. Mode "off": Google pages stay in NODE.
  await ui.evaluate(() => window.scout.setSettings({ google: { mode: "off", browser: "" } }));
  await ui.fill("#omni", "https://accounts.google.com/x");
  await ui.press("#omni", "Enter");
  await sleep(1500);
  const loaded = await app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.getURL()));
  log("mode off loads in NODE:", loaded.some((u) => u.startsWith("https://accounts.google.com/x")) || loaded.some((u) => u.includes("accounts.google.com")));
  const settings = JSON.parse(fs.readFileSync(path.join(userData, "settings.json"), "utf8"));
  log("settings saved:", JSON.stringify(settings.google));

  // Close the companion browser.
  try {
    const v = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json();
    const ws = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    ws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
    await sleep(500);
  } catch (_) {}
  process.exit(0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
