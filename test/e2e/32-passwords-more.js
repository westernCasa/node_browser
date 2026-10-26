// Passwords part 2 (B47): strong passwords on sign-up forms, change-password
// forms, sign-in forms in a frame from another site, importing a passwords
// file, and showing or copying a saved password after a check.
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
const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ firstRunDone: true }));

(async () => {
  const app = await electron.launch({
    executablePath: require("electron"),
    args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")],
    env: { ...process.env, NODE_TEST_PLAIN_PASSWORDS: "1" },
  });
  await app.evaluate(() => {
    const o = globalThis.fetch;
    globalThis.fetch = async (u, opt) => (/wikipedia|duckduckgo|brave\.com/.test(String(u)) ? new Response("{}", { status: 200 }) : o(u, opt));
  });
  const ui = await app.firstWindow();
  await sleep(1500);
  await app.evaluate(() => (global.nodeTest.noPopup = true));
  const ask = (answer) => app.evaluate(({}, a) => { global.nodeTest.lastPasswordAsk = null; global.nodeTest.setPasswordAsk(a); }, answer);
  const asked = () => app.evaluate(() => global.nodeTest.lastPasswordAsk);
  const menu = () => app.evaluate(() => global.nodeTest.loginMenuLabels || []);
  const pick = (n) => app.evaluate(({}, i) => global.nodeTest.loginMenuRun(i), n);
  const shown = () => app.evaluate(() => global.nodeTest.loginMenuShown || 0);
  const list = () => ui.evaluate(() => window.scout.passwordsList());
  // The page view on screen; frame: run in the first frame inside it.
  const inView = (fn, arg) =>
    app.evaluate(({ BrowserWindow }, [src, a]) => {
      const v = BrowserWindow.getAllWindows()[0].contentView.children.filter((x) => x.webContents && /:8765\//.test(x.webContents.getURL())).find((x) => x.getBounds().width > 0);
      return new Function("v", "a", src)(v, a);
    }, [fn, arg]);
  const page = (code, frame = false) => inView(`const f = ${frame} ? v.webContents.mainFrame.frames[0] : v.webContents.mainFrame; return f.executeJavaScript(a);`, code);
  const input = (events) => inView(`for (const e of a) v.webContents.sendInputEvent(e);`, events);
  // Simulated input from Electron does not reach a frame from another site
  // (a real mouse does), so in the frame the events are made inside it.
  const clickOn = async (sel, frame = false) => {
    if (frame) {
      await page(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); el.focus(); })()`, true);
      await sleep(400);
      return;
    }
    const r = await page(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.x + 8), y: Math.round(r.y + r.height / 2) }; })()`);
    await input([{ type: "mouseDown", ...r, button: "left", clickCount: 1 }, { type: "mouseUp", ...r, button: "left", clickCount: 1 }]);
    await sleep(400);
  };
  const enterInFrame = () => page(`document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`, true);
  const enter = () => input([{ type: "keyDown", keyCode: "Enter" }, { type: "char", keyCode: "\r" }, { type: "keyUp", keyCode: "Enter" }]);
  const open = async (url) => {
    await ui.fill("#omni", url);
    await ui.press("#omni", "Enter");
    await sleep(1500);
  };
  const type = (sel, v, frame = false) => page(`document.querySelector(${JSON.stringify(sel)}).value = ${JSON.stringify(v)}`, frame);

  // 1. Sign-up form: Use Strong Password fills both fields; NODE asks to save it.
  await open(`${BASE}/signup2.html`);
  await type("#user", "new@example.com");
  await clickOn("#p1");
  check("a sign-up field offers a strong password", (await menu()).join() === "Use Strong Password", (await menu()).join());
  await pick(0);
  await sleep(300);
  const [p1, p2] = await page(`[document.getElementById("p1").value, document.getElementById("p2").value]`);
  check("the strong password fills both fields", /^[A-Za-z0-9]{5}(-[A-Za-z0-9]{5}){3}$/.test(p1) && p1 === p2, p1);
  await ask(0);
  await clickOn("#p2");
  await enter();
  await sleep(1000);
  check("sending the form asks to save it", /new@example\.com/.test((await asked())?.detail || ""));
  let l = await list();
  check("the strong password is saved", l.logins.length === 1);

  // 2. Change-password form: the current password field is left alone.
  await open(`${BASE}/change.html`);
  await type("#cur", "old-one");
  await clickOn("#new1");
  check("a new-password field offers a strong password", (await menu()).includes("Use Strong Password"));
  await pick(0);
  await sleep(300);
  const v = await page(`[document.getElementById("cur").value, document.getElementById("new1").value, document.getElementById("new2").value]`);
  check("current password kept; new and confirm filled", v[0] === "old-one" && v[1] && v[1] === v[2], v.join(" | "));

  // 3. A sign-in form in a frame from another site.
  await open(`${BASE}/frame-host.html`);
  await sleep(1000);
  await type("#user", "fay@example.com", true);
  await type("#pass", "frame-pw", true);
  await ask(0);
  await clickOn("#pass", true);
  await enterInFrame();
  await sleep(1200);
  check("a sign-in in a frame asks, for the frame's site", /localhost:8765/.test((await asked())?.message || ""), (await asked())?.message);
  l = await list();
  check("saved under the frame's site", l.logins.some((x) => x.site === "http://localhost:8765" && x.username === "fay@example.com"));
  await open(`${BASE}/frame-host.html`);
  await sleep(1200);
  const before = await shown();
  await clickOn("#user", true);
  check("clicking the field in the frame offers the login", (await shown()) === before + 1 && (await menu()).includes("fay@example.com"), (await menu()).join());
  await pick((await menu()).indexOf("fay@example.com"));
  await sleep(400);
  check("the frame's fields are filled", (await page(`document.getElementById("pass").value`, true)) === "frame-pw");
  check("the page around the frame gets nothing", (await page(`document.body.innerText.includes("frame-pw")`)) === false);

  // 4. Import a file exported from Chrome; move it to the Trash is offered.
  const csv = path.join(OUT, "Chrome Passwords.csv");
  fs.writeFileSync(csv, "name,url,username,password,note\n127.0.0.1,http://127.0.0.1:8765/login.html,ana@example.com,imp-1,\njstor,https://www.jstor.org/,gus,imp-2,\n,,,\n");
  await ask(0);
  const r = await app.evaluate(({}, f) => global.nodeTest.importPasswords(f), csv);
  check("import: 2 new logins", r.added === 2 && r.updated === 0, JSON.stringify(r));
  check("asked before moving the file to the Trash", /Trash/.test((await asked())?.message || ""));
  l = await list();
  check("imported logins are listed", l.logins.some((x) => x.site === "jstor.org" && x.username === "gus"));
  await ask(1);
  if (!fs.existsSync(csv)) fs.writeFileSync(csv, "name,url,username,password,note\nx,https://www.jstor.org/,gus,imp-3,\n");
  const r2 = await app.evaluate(({}, f) => global.nodeTest.importPasswords(f), csv);
  check("Cancel imports nothing", r2.cancelled === true);
  const bad = path.join(OUT, "notes.csv");
  fs.writeFileSync(bad, "a,b\n1,2\n");
  check("not a passwords file: says so", /not a passwords file/.test((await app.evaluate(({}, f) => global.nodeTest.importPasswords(f), bad)).error || ""));

  // 5. Show and Copy ask first; a no shows nothing.
  await ui.evaluate(() => openMenu("settings"));
  await sleep(800);
  const gus = (await list()).logins.find((x) => x.username === "gus").id;
  await app.evaluate(() => global.nodeTest.setPasswordAuth(false));
  check("refused check: nothing shown", (await ui.evaluate((i) => window.scout.passwordsReveal(i), gus)) === null);
  await app.evaluate(() => global.nodeTest.setPasswordAuth(true));
  check("after the check: the password", (await ui.evaluate((i) => window.scout.passwordsReveal(i), gus)) === "imp-2");
  await app.evaluate(() => (global.nodeTest.clipMs = 1500));
  check("Copy puts it on the clipboard", (await ui.evaluate((i) => window.scout.passwordsCopy(i), gus)) && (await app.evaluate(({ clipboard }) => clipboard.readText())) === "imp-2");
  await sleep(2000);
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
  check("the clipboard is cleared after the wait", clip === "", JSON.stringify(clip));
  await ui.evaluate(() => renderPasswords());
  await sleep(300);
  const row = await ui.$$eval("#passwords-list li", (els) => els.map((e) => e.textContent).join(" / "));
  check("Settings rows hide passwords", !/imp-2|frame-pw/.test(row) && row.includes("••••••••"));
  check("Settings has Show, Copy and Remove", (await ui.$$eval("#passwords-list li:first-child button", (b) => b.map((x) => x.textContent).join())) === "Show,Copy,Remove");

  await app.close();
  if (failed) console.log(`::error::32-passwords-more: ${failed} check(s) failed`);
  console.log(failed ? `${failed} checks failed` : "all checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
