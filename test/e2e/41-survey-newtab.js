// Beta survey on new tabs (B98). Since B102 every new tab is the trail canvas,
// so the survey is a section of the canvas under its search bar (not a
// pop-up: nothing is covered and the search bar keeps the focus), shown once
// NODE has been used on 3 different days. It shares its answer with the
// widget's prompt (B65); Later waits for another day of use; Take survey opens
// the survey in a new tab and ends both prompts.
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

// A new tab, the way Cmd/Ctrl+T opens one: the trail canvas, search bar focused.
async function newTab(app, ui) {
  await app.evaluate(({ Menu, BrowserWindow }) => {
    const find = (items) => {
      for (const it of items) {
        if (it.label === "New Tab") return it;
        const sub = it.submenu && find(it.submenu.items);
        if (sub) return sub;
      }
    };
    find(Menu.getApplicationMenu().items).click(undefined, BrowserWindow.getAllWindows()[0]);
  });
  await sleep(1200);
  return ui.evaluate(() => !document.getElementById("canvas").hidden);
}
const card = (ui) =>
  ui.evaluate(() => {
    const c = document.querySelector("#canvas .cv-survey:not([hidden])");
    if (!c) return null;
    let fixed = false;
    for (let e = c; e; e = e.parentElement) if (getComputedStyle(e).position === "fixed" || e.getAttribute("role") === "dialog") fixed = true;
    return {
      text: c.textContent,
      buttons: [...c.querySelectorAll("button")].map((b) => b.textContent),
      focused: Boolean(document.activeElement?.closest(".cv-search")),
      overlay: fixed,
      below: c.getBoundingClientRect().top >= document.querySelector("#canvas .cv-search").getBoundingClientRect().bottom,
    };
  });
const click = (ui, act) => ui.click(`#canvas .cv-survey [data-act="${act}"]`);
const windowSurvey = (ui) => ui.evaluate(() => JSON.parse(localStorage.getItem("node.survey") || "null"));

(async () => {
  // First run: only 1 day of use. No card.
  let { app, ui } = await launch();
  let id = await newTab(app, ui);
  check("a new tab is the trail canvas", id);
  check("no survey card before 3 days of use", (await card(ui)) === null);
  await app.evaluate(({ app }) => app.quit());
  await sleep(1500);

  // Three days of use: the card appears on a new tab.
  setDays(["2026-10-20", "2026-10-21"]);
  ({ app, ui } = await launch());
  id = await newTab(app, ui);
  let c = await card(ui);
  check("survey section on the canvas after 3 days", Boolean(c) && /used NODE on [34] days/.test(c.text) && /4 minutes/.test(c.text), c ? c.text.slice(0, 90) : "none");
  check("card choices: Take survey, Later, Don't ask again", c && c.buttons.join("|") === "Take survey|Later|Don't ask again", c && c.buttons.join("|"));
  check("not a pop-up: no overlay, and the search box keeps the focus", c && !c.overlay && c.focused, c && JSON.stringify({ overlay: c.overlay, focused: c.focused }));
  check("it sits on the canvas under the search bar", c && c.below);
  // Later: the page comes back without the card, and the window keeps the answer.
  await click(ui, "later");
  await sleep(1000);
  check("Later hides the section", (await card(ui)) === null);
  const later = await windowSurvey(ui);
  check("Later is saved in the window (node.survey)", later && later.state === "ask" && later.laterDays >= 3, JSON.stringify(later));
  check("the widget's survey prompt is not showing after Later", await ui.$eval("#notice", (e) => e.hidden || !/survey/i.test(e.textContent)));
  id = await newTab(app, ui);
  check("Later: no card on another new tab the same day", (await card(ui)) === null);
  await app.evaluate(({ app }) => app.quit());
  await sleep(1500);

  // Same day, after a restart: still no card.
  ({ app, ui } = await launch());
  id = await newTab(app, ui);
  check("Later holds after a restart the same day", (await card(ui)) === null);
  await app.evaluate(({ app }) => app.quit());
  await sleep(1500);

  // Another day of use: the prompt is back; Later again.
  setDays(["2026-10-19"]);
  ({ app, ui } = await launch());
  id = await newTab(app, ui);
  check("asked again on the next day of use", (await card(ui)) !== null);
  await click(ui, "later");
  await sleep(1000);
  check("Later again hides it until the next day", (await card(ui)) === null && (await windowSurvey(ui))?.state === "ask");
  await app.evaluate(({ app }) => app.quit());
  await sleep(1500);

  // One more day: Take survey opens the survey in a new tab and ends both prompts.
  setDays(["2026-10-18"]);
  ({ app, ui } = await launch());
  id = await newTab(app, ui);
  check("card shown again on the following day", (await card(ui)) !== null);
  await click(ui, "take");
  let u = "";
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    u = decodeURIComponent(await app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.getURL()).find((x) => /forms/.test(decodeURIComponent(x))) || ""));
    if (/forms/.test(u)) break;
  }
  // Without a network the tab shows NODE's error page for the survey address instead.
  const survey = /^https:\/\/(forms\.gle\/XuMGZUzScNYPyP319|docs\.google\.com\/forms\/d\/e\/)/.test(u) || /error\.html\?.*u=https:\/\/forms\.gle\/XuMGZUzScNYPyP319/.test(u);
  check("Take survey opens the survey in a new tab", survey, /error\.html/.test(u) ? "no network: error page for the survey address" : u.slice(0, 60));
  check("Take survey is saved in the window", (await windowSurvey(ui))?.state === "done");
  await app.evaluate(({ app }) => app.quit());
  await sleep(1500);
  check("the answer is kept in survey.json", JSON.parse(fs.readFileSync(path.join(userData, "survey.json"), "utf8")).state === "done");

  setDays(["2026-10-17"]);
  ({ app, ui } = await launch());
  id = await newTab(app, ui);
  check("after Take survey: no card", (await card(ui)) === null);
  await sleep(8000);
  check("after Take survey: no prompt in the widget either", await ui.$eval("#notice", (e) => e.hidden || !/survey/i.test(e.textContent)));
  await app.evaluate(({ app }) => app.quit());

  console.log(failed ? `${failed} checks failed` : "all checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
