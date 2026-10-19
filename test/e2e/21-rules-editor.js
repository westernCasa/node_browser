// Visual site rules editor: the list, a rule for the current site, saving,
// the rule taking effect, editing, moving, deleting, invalid input refused,
// fields written by hand kept.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path"), fs = require("fs"), os = require("os");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "scout-e2e-"));
const BASE = "http://127.0.0.1:8765";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);
(async () => {
  const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
  const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")] });
  await app.evaluate(() => {
    const real = globalThis.fetch;
    globalThis.fetch = async (u, o) => (/wikipedia|duckduckgo/.test(String(u)) ? new Response("{}", { status: 200 }) : real(u, o));
  });
  const ui = await app.firstWindow();
  await sleep(1500);
  await ui.fill("#omni", BASE + "/media.html");
  await ui.press("#omni", "Enter");
  await sleep(2500);
  const rulesFile = path.join(userData, "rules.json");
  const fileRules = () => JSON.parse(fs.readFileSync(rulesFile, "utf8")).rules;
  const playing = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().find((w) => w.getURL().includes("media.html")).executeJavaScript(`[...document.querySelectorAll("video,audio")].some((m) => !m.paused)`));
  log("media playing before any rule:", await playing());

  await ui.evaluate(() => document.querySelector('#sources-btn').click()); // in the menu overlay or the hidden Capture actions
  await sleep(800);
  log("rules listed:", await ui.$$eval("#rules-list .rn", (e) => e.map((x) => x.textContent)).then((l) => l.join(" | ")));
  log("summary of the sign-in rule:", await ui.$$eval("#rules-list .rs", (e) => e.at(-1).textContent));

  // A rule for this site: no autoplay, keep out of Mosaic.
  await ui.click("#rule-this-site");
  await sleep(300);
  log("form prefilled with:", await ui.$eval("#rf-match", (e) => e.value));
  await ui.selectOption("#rf-autoplay", "off");
  await ui.selectOption("#rf-mosaic", "false");
  await ui.fill("#rf-skip", "#comments, .sidebar");
  await ui.click("#rf-save");
  await sleep(800);
  const added = fileRules().at(-1);
  log("saved to rules.json:", JSON.stringify(added));
  log("list now ends with:", await ui.$$eval("#rules-list .rs", (e) => e.at(-1).textContent));
  await ui.click("#reload");
  await sleep(2500);
  log("media playing after reload with the rule:", await playing(), "| rule line:", await ui.textContent("#rule-line").catch(() => ""));

  // Invalid input is refused and nothing is written.
  const before = fs.readFileSync(rulesFile, "utf8");
  await ui.click("#rule-add");
  await ui.fill("#rf-match", "/[unclosed/");
  await ui.click("#rf-save");
  await sleep(500);
  log("invalid pattern:", await ui.textContent("#rf-errors"), "| file unchanged:", fs.readFileSync(rulesFile, "utf8") === before);
  await ui.click("#rf-cancel");

  // Fields written by hand are kept when the rule is edited in the form.
  const list = fileRules();
  list.at(-1).custom = "kept";
  fs.writeFileSync(rulesFile, JSON.stringify({ rules: list }, null, 2));
  await sleep(1200);
  const count = await ui.$$eval("#rules-list li", (e) => e.length);
  await ui.click(`#rules-list li:nth-child(${count}) .rb button:first-child`);
  await ui.selectOption("#rf-autoplay", "muted");
  await ui.click("#rf-save");
  await sleep(800);
  log("edited rule:", JSON.stringify(fileRules().at(-1)));

  // Move up, then delete.
  await ui.click(`#rules-list li:nth-child(${count}) .rb button[title^="Move up"]`);
  await sleep(600);
  log("after Move up, second to last:", fileRules().at(-2).match);
  await ui.click(`#rules-list li:nth-child(${count - 1}) .rb button:last-child`);
  await sleep(600);
  log("after Delete:", fileRules().length, "rules; 127.0.0.1 rule gone:", !fileRules().some((r) => r.match === "127.0.0.1"));
  await ui.screenshot({ path: path.join(OUT, "rules-editor.png") });
  await app.close();
  process.exit(0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
