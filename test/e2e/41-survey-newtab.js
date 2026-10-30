// Beta survey card on the new tab page (B75): shown once NODE has been used on
// 3 different days, shares its answer with the widget's prompt (B65), Later
// waits for another day of use, Take survey opens the survey in the same tab
// and ends both prompts, Esc counts as Later, and a custom new tab page is left
// alone.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path"), fs = require("fs"), os = require("os");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "node-e2e-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(ok ? "✓" : "✗", name, detail ? `(${detail})` : "");
};
const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
const usageFile = path.join(userData, "usage.json");
const setDays = (days) => {
  const saved = fs.existsSync(usageFile) ? JSON.parse(fs.readFileSync(usageFile, "utf8")) : { counts: {}, days: [] };
  saved.days = [...new Set([...days, ...(saved.days || [])])].sort();
  fs.writeFileSync(usageFile, JSON.stringify(saved));
};

async function launch() {
  const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")] });
  await app.evaluate(() => {
    const o = globalThis.fetch;
    globalThis.fetch = async (u, opt) => (/duckduckgo|brave\.com|wikipedia|forms\.gle/.test(String(u)) ? new Response("", { status: 200 }) : o(u, opt));
  });
  const ui = await app.firstWindow();
  await sleep(2500);
  return { app, ui };
}

// Opens a new tab the way Cmd/Ctrl+T does and returns its webContents id.
async function newTab(app, ui) {
  const before = await app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.id));
  await ui.evaluate(() => window.scout.createTab());
  await sleep(2000);
  return app.evaluate(({ webContents }, before) => {
    const w = webContents.getAllWebContents().find((x) => !before.includes(x.id) && /start\.html/.test(x.getURL()));
    return w ? w.id : null;
  }, before);
}
const inTab = (app, id, js) => app.evaluate(({ webContents }, [id, js]) => webContents.fromId(id).executeJavaScript(js), [id, js]);
const urlOf = (app, id) => app.evaluate(({ webContents }, id) => webContents.fromId(id).getURL(), id);
const card = (app, id) =>
  inTab(app, id, `(() => { const c = document.querySelector('.survey'); return c ? { text: c.textContent, buttons: [...c.querySelectorAll('button')].map((b) => b.textContent), focused: document.activeElement?.textContent || '' } : null; })()`);
const windowSurvey = (ui) => ui.evaluate(() => JSON.parse(localStorage.getItem("node.survey") || "null"));

(async () => {
  // First run: only 1 day of use. No card.
  let { app, ui } = await launch();
  let id = await newTab(app, ui);
  check("new tab opens the start page", Boolean(id));
  check("no survey card before 3 days of use", (await card(app, id)) === null);
  await app.evaluate(({ app }) => app.quit());
  await sleep(1500);

  // Three days of use: the card appears on a new tab.
  setDays(["2026-10-20", "2026-10-21"]);
  ({ app, ui } = await launch());
  id = await newTab(app, ui);
  let c = await card(app, id);
  check("survey card on the new tab page after 3 days", Boolean(c) && /used it on [34] days/.test(c.text) && /4 minutes/.test(c.text), c ? c.text.slice(0, 90) : "none");
  check("card choices: Take survey, Later, Don't ask again", c && c.buttons.join("|") === "Take survey|Later|Don't ask again", c && c.buttons.join("|"));
  check("Take survey has the focus", c && c.focused === "Take survey", c && c.focused);
  // Later: the page comes back without the card, and the window keeps the answer.
  await inTab(app, id, `document.querySelector('[data-act="later"]').click()`);
  await sleep(1500);
  check("Later shows the start page again without the card", /start\.html/.test(await urlOf(app, id)) && (await card(app, id)) === null);
  const later = await windowSurvey(ui);
  check("Later is saved in the window (node.survey)", later && later.state === "ask" && later.laterDays >= 3, JSON.stringify(later));
  check("the widget's survey prompt is not showing after Later", await ui.$eval("#notice", (e) => e.hidden || !/survey/i.test(e.textContent)));
  id = await newTab(app, ui);
  check("Later: no card on another new tab the same day", (await card(app, id)) === null);
  await app.evaluate(({ app }) => app.quit());
  await sleep(1500);

  // Same day, after a restart: still no card.
  ({ app, ui } = await launch());
  id = await newTab(app, ui);
  check("Later holds after a restart the same day", (await card(app, id)) === null);
  await app.evaluate(({ app }) => app.quit());
  await sleep(1500);

  // Another day of use: the card is back. Esc counts as Later.
  setDays(["2026-10-19"]);
  ({ app, ui } = await launch());
  id = await newTab(app, ui);
  check("asked again on the next day of use", (await card(app, id)) !== null);
  await inTab(app, id, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(1500);
  check("Esc closes the card like Later", (await card(app, id)) === null && (await windowSurvey(ui))?.state === "ask");
  await app.evaluate(({ app }) => app.quit());
  await sleep(1500);

  // One more day: Take survey opens the survey in the same tab and ends both prompts.
  setDays(["2026-10-18"]);
  ({ app, ui } = await launch());
  id = await newTab(app, ui);
  check("card shown again on the following day", (await card(app, id)) !== null);
  await inTab(app, id, `document.querySelector('[data-act="take"]').click()`);
  let u = "";
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    u = decodeURIComponent(await urlOf(app, id));
    if (/forms/.test(u)) break;
  }
  // Without a network the tab shows NODE's error page for the survey address instead.
  const survey = /^https:\/\/(forms\.gle\/XuMGZUzScNYPyP319|docs\.google\.com\/forms\/d\/e\/)/.test(u) || /error\.html\?.*u=https:\/\/forms\.gle\/XuMGZUzScNYPyP319/.test(u);
  check("Take survey opens the survey in the same tab", survey, /error\.html/.test(u) ? "no network: error page for the survey address" : u.slice(0, 60));
  check("Take survey is saved in the window", (await windowSurvey(ui))?.state === "done");
  await app.evaluate(({ app }) => app.quit());
  await sleep(1500);
  check("the answer is kept in survey.json", JSON.parse(fs.readFileSync(path.join(userData, "survey.json"), "utf8")).state === "done");

  setDays(["2026-10-17"]);
  ({ app, ui } = await launch());
  id = await newTab(app, ui);
  check("after Take survey: no card", (await card(app, id)) === null);
  await sleep(8000);
  check("after Take survey: no prompt in the widget either", await ui.$eval("#notice", (e) => e.hidden || !/survey/i.test(e.textContent)));
  await app.evaluate(({ app }) => app.quit());

  console.log(failed ? `${failed} checks failed` : "all checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
