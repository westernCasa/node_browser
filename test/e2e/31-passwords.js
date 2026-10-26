// Passwords (B47): NODE offers to save a password after a sign-in, offers the
// saved login when a sign-in field gets focus, and fills it only when picked.
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
  const shown = () => app.evaluate(() => global.nodeTest.loginMenuShown || 0);
  const activeTab = () => ui.evaluate(() => activeId);
  // Run code in the active page.
  const page = (code) =>
    app.evaluate(({ BrowserWindow }, c) => {
      const v = BrowserWindow.getAllWindows()[0].contentView.children.filter((x) => x.webContents && /:8765\//.test(x.webContents.getURL())).find((x) => x.getBounds().width > 0);
      return v.webContents.executeJavaScript(c);
    }, code);
  // Real input: a click on an element, or a key.
  const input = (events) =>
    app.evaluate(({ BrowserWindow }, ev) => {
      const v = BrowserWindow.getAllWindows()[0].contentView.children.filter((x) => x.webContents && /:8765\//.test(x.webContents.getURL())).find((x) => x.getBounds().width > 0);
      for (const e of ev) v.webContents.sendInputEvent(e);
    }, events);
  const clickOn = async (sel) => {
    const r = await page(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.x + 8), y: Math.round(r.y + r.height / 2) }; })()`);
    await input([{ type: "mouseDown", ...r, button: "left", clickCount: 1 }, { type: "mouseUp", ...r, button: "left", clickCount: 1 }]);
    await sleep(300);
  };
  const enter = () => input([{ type: "keyDown", keyCode: "Enter" }, { type: "char", keyCode: "\r" }, { type: "keyUp", keyCode: "Enter" }]);
  const open = async (url) => {
    await ui.fill("#omni", url);
    await ui.press("#omni", "Enter");
    await sleep(1500);
  };
  const type = (sel, v) => page(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.value = ${JSON.stringify(v)}; })()`);
  const list = () => ui.evaluate(() => window.scout.passwordsList());

  // 1. Sign in; NODE asks; Save.
  await open(`${BASE}/login.html`);
  await type("#user", "ana@example.com");
  await type("#pass", "hunter2-secret");
  await ask(0);
  await clickOn("#show");
  check("a Show password button does not count as signing in", (await asked()) === null);
  await clickOn("#pass");
  await enter();
  await sleep(1200);
  const a1 = await asked();
  check("asks to save after signing in", /Save the password for http:\/\/127\.0\.0\.1:8765\?/.test(a1?.message || ""), a1?.message);
  check("the question names the username", /ana@example\.com/.test(a1?.detail || ""));
  let l = await list();
  check("login saved", l.available && l.logins.length === 1 && l.logins[0].username === "ana@example.com", JSON.stringify(l.logins));
  check("the list has no password", !JSON.stringify(l).includes("hunter2"));
  check("the file has no plain password", !fs.readFileSync(path.join(userData, "passwords.json"), "utf8").includes("hunter2"));

  // 2. Come back: focus offers the login; nothing is filled until picked.
  await open(`${BASE}/login.html`);
  await sleep(1200);
  const before = await shown();
  await page(`document.getElementById("user").focus()`);
  await sleep(300);
  check("focus without a click or key press offers nothing", (await shown()) === before);
  await clickOn("#user");
  check("clicking the username field offers the saved login", (await shown()) === before + 1);
  const id = await activeTab();
  check("the menu lists the username", (await app.evaluate(({}, i) => global.nodeTest.loginMenu(i), id)).join() === "ana@example.com");
  check("nothing filled before picking", (await page(`document.getElementById("pass").value`)) === "");
  const n = await shown();
  await clickOn("#search");
  check("a search box does not offer logins", (await shown()) === n);
  await clickOn("#user");
  check("offered once per field", (await shown()) === n);
  check("picking fills", await app.evaluate(({}, i) => global.nodeTest.fillLogin(i), id));
  await sleep(300);
  check("username and password filled", (await page(`[document.getElementById("user").value, document.getElementById("pass").value].join("|")`)) === "ana@example.com|hunter2-secret");
  check("the page saw the input (frameworks like React)", (await page(`window.seen.user + "|" + window.seen.pass`)) === "ana@example.com|hunter2-secret");

  // 3. The same login again asks nothing; a new password asks to update.
  await ask(0);
  await clickOn("#pass");
  await enter();
  await sleep(1000);
  check("same login: no question", (await asked()) === null);
  await open(`${BASE}/login.html`);
  await type("#user", "ana@example.com");
  await type("#pass", "new-pass-9");
  await ask(0);
  await clickOn("#go");
  await sleep(1000);
  check("new password: asks to update", /Update the saved password for ana@example\.com/.test((await asked())?.message || ""));
  l = await list();
  check("still one login", l.logins.length === 1);

  // 4. Two steps: username first, password on the next page.
  await open(`${BASE}/login-step1.html`);
  await type("#user", "ben@example.com");
  await clickOn("#user");
  await enter();
  await sleep(1500);
  await type("#pass", "two-step-pw");
  await ask(0);
  await clickOn("#pass");
  await enter();
  await sleep(1000);
  check("two-step sign-in: asks with the username from step 1", /ben@example\.com/.test((await asked())?.detail || ""));
  l = await list();
  check("two logins on the site", l.logins.length === 2, l.logins.map((x) => x.username).join());

  // 5. Never for this site (localhost is another site than 127.0.0.1).
  await open(`http://localhost:8765/signup.html`);
  await type("#user", "cy");
  await type("#p1", "made-up-1");
  await type("#p2", "made-up-1");
  await ask(1);
  await clickOn("#p2");
  await enter();
  await sleep(1000);
  check("sign-up form: asks", /localhost:8765/.test((await asked())?.message || ""));
  l = await list();
  check("Never for This Site is listed", l.never.length === 1 && l.logins.length === 2);
  await ask(0);
  await clickOn("#p2");
  await type("#p2", "made-up-1 ");
  await enter();
  await sleep(1000);
  check("never: no question next time", (await asked()) === null);

  // A page that sends a sign-in form by itself does not get to ask.
  await open(`${BASE}/login.html`);
  await sleep(11000);
  await ask(0);
  await page(`document.getElementById("user").value = "eve@example.com"; document.getElementById("pass").value = "auto"; document.getElementById("f").requestSubmit();`);
  await sleep(1000);
  check("a form sent by the page itself: no question", (await asked()) === null);

  // 6. Settings lists the logins; turning the offer off stops the questions.
  await ui.evaluate(() => window.scout.setSettings({ passwordsOffer: false }));
  await open(`${BASE}/login.html`);
  await type("#user", "dee@example.com");
  await type("#pass", "x1");
  await ask(0);
  await clickOn("#pass");
  await enter();
  await sleep(1000);
  check("offer off: no question", (await asked()) === null);
  await ui.evaluate(() => openMenu("settings"));
  await sleep(800);
  check("Settings lists 2 logins", (await ui.$$eval("#passwords-list li", (e) => e.length)) === 2);
  check("Settings shows the offer switch off", !(await ui.$eval("#passwords-offer", (e) => e.checked)));
  await ui.click("#passwords-list li button");
  await sleep(500);
  check("Remove deletes a login", (await list()).logins.length === 1);

  await app.close();
  if (failed) console.log(`::error::31-passwords: ${failed} check(s) failed`);
  console.log(failed ? `${failed} checks failed` : "all checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
