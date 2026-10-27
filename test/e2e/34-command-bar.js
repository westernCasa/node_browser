// CommandBar (sidebar layout): ⌘L and ⌘T open it over a dimmed picture of the
// window; open tabs, trails, ask, agent, search and history; keys.
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
fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ firstRunDone: true, chromeLayout: "side" }));

(async () => {
  const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")] });
  await app.evaluate(() => {
    const o = globalThis.fetch;
    globalThis.fetch = async (u, opt) => (/wikipedia|duckduckgo|brave\.com|x\.ai|11434/.test(String(u)) ? new Response("{}", { status: 200 }) : o(u, opt));
  });
  const ui = await app.firstWindow();
  await sleep(1800);
  const menuItem = (label) => app.evaluate(({ Menu }, l) => Menu.getApplicationMenu().items.flatMap((m) => m.submenu?.items || []).find((i) => i.label === l).click(), label);
  const tabsNow = () => ui.evaluate(() => tabs.map((t) => ({ id: t.id, url: t.url, title: t.title })));
  const active = () => ui.evaluate(() => tabs.find((t) => t.id === activeId)?.url || "");
  const pagesShown = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter((v) => v.webContents && !/chrome-overlay/.test(v.webContents.getURL()) && v.getBounds().width > 0).length);
  const rows = () => ui.$$eval("#cmd-list .cmd-row", (r) => r.map((x) => ({ t: x.querySelector(".t").textContent, k: x.querySelector(".k").textContent, sel: x.getAttribute("aria-selected") === "true" })));
  const type = async (q) => {
    await ui.fill("#cmd-input", q);
    await sleep(500);
  };

  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/article.html`);
  await sleep(1200);
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/other.html?n=1`);
  await sleep(1500);
  check("sidebar layout on", await ui.evaluate(() => document.body.classList.contains("side")));

  // ⌘L
  await menuItem("Open Location");
  await sleep(800);
  check("⌘L opens the CommandBar", await ui.evaluate(() => cmdOpen && !document.getElementById("cmdbar").hidden));
  check("it starts with the current address, selected", (await ui.inputValue("#cmd-input")).includes("other.html?n=1") && (await ui.evaluate(() => document.activeElement.id === "cmd-input" && document.activeElement.selectionEnd - document.activeElement.selectionStart > 5)));
  check("the pages are hidden behind a picture", (await pagesShown()) === 0 && (await ui.$$eval("#cmd-shots img", (i) => i.length)) >= 1);
  check("the panel is a labelled dialog", (await ui.$eval(".cmd-panel", (p) => p.getAttribute("role") + "|" + p.getAttribute("aria-label"))) === "dialog|Go to, search or ask");
  await ui.keyboard.press("Escape");
  await sleep(500);
  check("Esc closes it and the pages come back", !(await ui.evaluate(() => cmdOpen)) && (await pagesShown()) === 1);

  // Switch to an open tab by typing its title.
  await menuItem("Open Location");
  await sleep(700);
  await type("why sourdough");
  let r = await rows();
  check("Open tabs: the matching tab, selected", r[0]?.t.startsWith("Why sourdough") && r[0].sel, JSON.stringify(r[0]));
  check("Ask, agent and search rows for words", r.some((x) => /^Ask about this page/.test(x.t)) && r.some((x) => /research agent/.test(x.t)) && r.some((x) => /^Search for/.test(x.t)));
  await ui.press("#cmd-input", "Enter");
  await sleep(900);
  check("Enter switches to that tab", (await active()).endsWith("article.html"), await active());

  // An address: Go to, in this tab; Shift+Enter in a new tab.
  await menuItem("Open Location");
  await sleep(700);
  await type(`127.0.0.1:8765/other.html?n=7`);
  r = await rows();
  check("an address selects Go to", r.find((x) => x.sel)?.t.startsWith("Go to 127.0.0.1:8765/other.html?n=7"), JSON.stringify(r.find((x) => x.sel)));
  check("no Ask rows for an address", !r.some((x) => /^Ask about/.test(x.t)));
  const before = (await tabsNow()).length;
  await ui.press("#cmd-input", "Enter");
  await sleep(1500);
  check("Enter opens it in this tab", (await active()).endsWith("other.html?n=7") && (await tabsNow()).length === before, await active());
  await menuItem("Open Location");
  await sleep(700);
  await type(`127.0.0.1:8765/other.html?n=8`);
  await ui.press("#cmd-input", "Shift+Enter");
  await sleep(1500);
  check("Shift+Enter opens it in a new tab", (await tabsNow()).length === before + 1 && (await active()).endsWith("other.html?n=8"));

  // ⌘T: new-tab mode.
  await menuItem("New Tab");
  await sleep(800);
  check("⌘T opens the CommandBar in new-tab mode, empty", (await ui.evaluate(() => cmdOpen && cmdNewTab)) && (await ui.inputValue("#cmd-input")) === "" && !(await ui.$eval("#cmd-mode", (m) => m.hidden)));
  await ui.keyboard.press("Escape");
  await sleep(500);
  check("Esc in new-tab mode opens nothing", (await tabsNow()).length === before + 1);
  await ui.click("#sidebar #new-tab");
  await sleep(800);
  check("the sidebar's New tab opens it too", await ui.evaluate(() => cmdOpen && cmdNewTab));
  const was = await active();
  await ui.press("#cmd-input", "Enter");
  await sleep(1000);
  check("Enter with nothing typed opens a blank tab", (await tabsNow()).length === before + 2 && (await active()) !== was, await active());
  await ui.evaluate((i) => window.scout.closeTab(i), (await ui.evaluate(() => activeId)));
  await sleep(800);
  await ui.click("#sidebar #new-tab");
  await sleep(800);
  await type(`127.0.0.1:8765/other.html?n=9`);
  await ui.press("#cmd-input", "Enter");
  await sleep(1500);
  check("Enter in new-tab mode opens a new tab", (await tabsNow()).length === before + 2 && (await active()).endsWith("other.html?n=9"));

  // History: a page visited before, closed now.
  const n9 = (await tabsNow()).find((t) => t.url.endsWith("n=9")).id;
  await ui.evaluate((i) => window.scout.closeTab(i), n9);
  await sleep(800);
  await menuItem("Open Location");
  await sleep(700);
  await type("Bread Lab");
  r = await rows();
  check("history rows for pages not open", r.some((x) => x.k === "History"), r.map((x) => x.k).join(","));
  // Arrow keys move the selection.
  const sel0 = r.findIndex((x) => x.sel);
  await ui.press("#cmd-input", "ArrowDown");
  await sleep(150);
  check("↓ moves the selection", (await rows()).findIndex((x) => x.sel) === (sel0 + 1) % r.length);
  await ui.keyboard.press("Escape");
  await sleep(400);

  // Trails: ⌥↵ starts one; typing its name switches back to it.
  const first = (await ui.evaluate(() => window.scout.researchGet())).name;
  await menuItem("Open Location");
  await sleep(700);
  await type("Hydration notes");
  await ui.press("#cmd-input", "Alt+Enter");
  await sleep(900);
  check("⌥↵ starts a new trail with that name", (await ui.evaluate(() => window.scout.researchGet())).name === "Hydration notes");
  await menuItem("Open Location");
  await sleep(700);
  await type(first);
  r = await rows();
  const ti = r.findIndex((x) => x.t === first && /switch trail/.test(x.k));
  check("Trails: the other trail is listed", ti >= 0, JSON.stringify(r.slice(0, 6)));
  for (let i = r.findIndex((x) => x.sel); i !== ti; i = (i + 1) % r.length) await ui.press("#cmd-input", "ArrowDown");
  await ui.press("#cmd-input", "Enter");
  await sleep(900);
  check("Enter on a trail switches to it", (await ui.evaluate(() => window.scout.researchGet())).name === first);

  // Tab asks; ⌘↵ starts the agent.
  await menuItem("Open Location");
  await sleep(700);
  await type("what temperature is best");
  await ui.press("#cmd-input", "Tab");
  await sleep(1200);
  check("Tab asks about the page in the Ask tab", (await ui.evaluate(() => !document.getElementById("ask-pane").hidden)) && (await ui.evaluate(() => ask.messages.some((m) => m.role === "user" && m.content === "what temperature is best"))));
  await menuItem("Open Location");
  await sleep(700);
  await type("history of rye bread");
  await ui.press("#cmd-input", process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
  await sleep(1200);
  check("⌘↵ runs the research agent on it", (await ui.evaluate(() => !document.getElementById("agent-pane").hidden)) && (await ui.inputValue("#agent-input")) === "history of rye bread");

  // The top bar keeps its own address bar.
  await ui.evaluate(async () => {
    await window.scout.setSettings({ chromeLayout: "top" });
    applyChromeLayout("top");
  });
  await sleep(600);
  await menuItem("Open Location");
  await sleep(500);
  check("top bar: ⌘L focuses the address bar, no CommandBar", !(await ui.evaluate(() => cmdOpen)) && (await ui.evaluate(() => document.activeElement.id)) === "omni");

  await app.close();
  if (failed) console.log(`::error::34-command-bar: ${failed} check(s) failed`);
  console.log(failed ? `${failed} checks failed` : "all checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
