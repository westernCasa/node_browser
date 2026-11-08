// Saved copies (B87): "Save a Copy of This Page" (File menu, right-click) and
// "Save a copy" on a page card save the page as an MHTML file named by its
// SHA-256, with its text, on this computer. The card says so and opens the
// copy after checking its hash. "Keep copies" in a trail's … menu saves one
// for each page that becomes a card. Sharing sends copies only when ticked,
// in a folder beside the file; opening the file checks each one.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path"), fs = require("fs"), os = require("os"), crypto = require("crypto");
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
const copies = path.join(userData, "copies");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

(async () => {
  const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")] });
  await app.evaluate(() => {
    const o = globalThis.fetch;
    globalThis.fetch = async (u, opt) => (/wikipedia|duckduckgo|brave\.com|x\.ai|11434/.test(String(u)) ? new Response("{}", { status: 200 }) : o(u, opt));
  });
  const ui = await app.firstWindow();
  await sleep(1800);
  const menuItem = (label) => app.evaluate(({ Menu }, l) => Menu.getApplicationMenu().items.flatMap((m) => m.submenu?.items || []).find((i) => i.label === l).click(), label);
  const cards = async () => (await ui.evaluate(() => window.scout.trailGet())).cards;
  const cardOf = async (re) => (await cards()).find((c) => c.kind === "page" && re.test(c.url));
  const tabUrls = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.getURL()));
  await ui.evaluate(() => window.scout.trailRename("Bread notes"));

  // File → Save a Copy of This Page.
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/article.html`);
  await sleep(1800);
  await menuItem("Save a Copy of This Page");
  await sleep(2500);
  let art = await cardOf(/article\.html/);
  const c1 = art?.copies?.[0];
  check("the page became a card with a saved copy", c1 && /^[0-9a-f]{64}$/.test(c1.sha256) && c1.bytes > 1000 && c1.here === true, JSON.stringify(c1));
  const file1 = c1 && path.join(copies, `${c1.sha256}.mhtml`);
  check("the copy is an MHTML file named by its SHA-256", file1 && fs.existsSync(file1) && sha(file1) === c1.sha256 && /^From: <Saved by Blink>|MIME-Version/m.test(fs.readFileSync(file1, "utf8").slice(0, 2000)));
  check("with the page's text beside it, for search", c1 && /starter/i.test(fs.readFileSync(path.join(copies, `${c1.sha256}.txt`), "utf8")));
  await menuItem("Save a Copy of This Page");
  await sleep(2000);
  art = await cardOf(/article\.html/);
  check("saving again an unchanged page keeps one copy", art.copies.length === 1, String(art.copies.length));

  // A sign-in page is never saved (B66).
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/login.html`);
  await sleep(1500);
  await menuItem("Save a Copy of This Page");
  await sleep(1500);
  check("a sign-in page is never saved", !(await cards()).some((c) => /login\.html/.test(c.url || "")) && fs.readdirSync(copies).filter((f) => f.endsWith(".mhtml")).length === 1);

  // The card: Copy · <time>, which opens the copy.
  await menuItem("Tab 1");
  await sleep(1500);
  await ui.evaluate((id) => trailCanvas.select(id, { reveal: true }), art.id);
  await sleep(500);
  const line = await ui.evaluate((id) => {
    const b = document.querySelector(`#canvas .cv-card[data-id="${id}"] .cv-card-copy`);
    return b && { text: b.textContent, title: b.title };
  }, art.id);
  check("the card says a copy was saved, with its SHA-256", line && /^Copy · \d{1,2} [A-Z][a-z]{2} \d\d:\d\d$/.test(line.text) && line.title === `SHA-256 ${c1.sha256}`, JSON.stringify(line));
  await ui.screenshot({ path: path.join(OUT, "53-card.png") });
  await ui.click(`#canvas .cv-card[data-id="${art.id}"] .cv-card-copy`);
  await sleep(1800);
  check("clicking it opens the copy in a tab", (await tabUrls()).some((u) => u.startsWith("file://") && u.endsWith(`${c1.sha256}.mhtml`)));
  // A copy that changed on disk is not opened.
  const good = fs.readFileSync(file1);
  fs.writeFileSync(file1, Buffer.concat([good, Buffer.from("\nchanged")]));
  const before = (await tabUrls()).length;
  const r = await ui.evaluate((h) => window.scout.trailCopyOpen(h), c1.sha256);
  check("a copy that changed since it was saved is not opened", r.changed === true && (await tabUrls()).length === before, JSON.stringify(r));
  fs.writeFileSync(file1, good);

  // "Save a copy" on a card with no tab: loads it out of sight.
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/seealso.html`);
  await sleep(1500);
  await menuItem("Save a Copy of This Page"); // makes it a card (and a copy)
  await sleep(2000);
  const see = await cardOf(/seealso/);
  const tabId = await ui.evaluate(() => activeId);
  await ui.evaluate((id) => window.scout.closeTab(id), tabId);
  await sleep(800);
  await menuItem("Tab 1");
  await sleep(1200);
  await ui.evaluate((id) => trailCanvas.select(id, { reveal: true }), see.id);
  await sleep(400);
  const bar = await ui.evaluate(() => [...document.querySelectorAll("#canvas .cv-selbar button")].filter((b) => !b.hidden).map((b) => b.textContent));
  check("a selected page card offers Save a copy", bar.includes("Save a copy"), bar.join());
  // Make the page different so the copy is new.
  await ui.evaluate(() => [...document.querySelectorAll("#canvas .cv-selbar button")].find((b) => b.textContent === "Save a copy").click());
  await sleep(5000);
  const see2 = await cardOf(/seealso/);
  check("it saves a copy without opening a tab", see2.copies.length >= 1 && !(await tabUrls()).some((u) => /seealso/.test(u)), JSON.stringify(see2.copies));

  // Keep copies: each page that becomes a card gets one.
  await ui.click("#sb-switch-name");
  await sleep(300);
  await ui.evaluate(() => [...document.querySelectorAll("#sb-switch-menu .sb-menu-row")].find((r) => r.querySelector(".nm").textContent === "Bread notes").querySelector(".sb-menu-more").click());
  await sleep(300);
  const keep = await ui.evaluate(() => [...document.querySelectorAll("#sb-switch-menu .chip")].find((b) => /^Keep copies/.test(b.textContent)));
  check("the trail's … menu has Keep copies: Off", Boolean(keep) && (await ui.evaluate(() => [...document.querySelectorAll("#sb-switch-menu .chip")].find((b) => /^Keep copies/.test(b.textContent)).textContent)) === "Keep copies: Off");
  await ui.evaluate(() => [...document.querySelectorAll("#sb-switch-menu .chip")].find((b) => /^Keep copies/.test(b.textContent)).click());
  await sleep(500);
  check("clicking turns it on", (await ui.evaluate(() => window.scout.trailList().then((l) => l.find((t) => t.current).keepCopies))) === true);
  await ui.evaluate(() => closeSwitchMenu());
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/other.html?n=kept`);
  await sleep(1500);
  const trailId = (await ui.evaluate(() => window.scout.trailGet())).trail.id;
  await ui.evaluate(() => window.scout.researchNew("Elsewhere")); // the open page becomes a card
  await sleep(4000);
  await ui.evaluate((id) => window.scout.trailSwitch(id), trailId);
  await sleep(1500);
  const kept = await cardOf(/n=kept/);
  check("with Keep copies on, a page that becomes a card gets a copy", kept?.copies?.length === 1, JSON.stringify(kept?.copies));

  // Share: copies only when ticked, in a folder beside the file.
  const shareDir = fs.mkdtempSync(path.join(OUT, "share-"));
  const plain = path.join(shareDir, "Plain.trail.md");
  await app.evaluate((_e, f) => global.nodeTest.setTrailSavePath(f), plain);
  const r1 = await ui.evaluate(() => window.scout.trailShareSave({}));
  check("without the choice: copies are listed, not sent", r1.ok && !r1.copies && /Copy: .* · SHA-256 [0-9a-f]{64}\n/.test(fs.readFileSync(plain, "utf8")) && !fs.existsSync(path.join(shareDir, "Plain copies")));
  const withCopies = path.join(shareDir, "Bread notes.trail.md");
  await app.evaluate((_e, f) => global.nodeTest.setTrailSavePath(f), withCopies);
  const r2 = await ui.evaluate(() => window.scout.trailShareSave({ copies: true }));
  const dir = path.join(shareDir, "Bread notes copies");
  const sent = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  check("ticked: the copies go in “<name> copies” beside the file", r2.ok && r2.copies === sent.length && sent.length >= 3 && sent.every((f) => sha(path.join(dir, f)) === f.replace(".mhtml", "")), JSON.stringify({ r2, sent }));
  check("and the file links to them", fs.readFileSync(withCopies, "utf8").includes(`[saved copy](Bread%20notes%20copies/${c1.sha256}.mhtml)`));

  // Opening it: matching copies come in; a changed one is marked.
  fs.rmSync(file1);
  const other = sent.find((f) => f !== `${c1.sha256}.mhtml`);
  fs.appendFileSync(path.join(dir, other), "\nedited by someone");
  await app.evaluate((_e, f) => global.nodeTest.openSharedTrail(f), withCopies);
  await sleep(2500);
  const opened = await ui.evaluate(() => window.scout.trailGet());
  check("the file opens read only", opened.trail.readonly === true);
  const oc = opened.cards.find((c) => /article\.html/.test(c.url || ""));
  check("a copy that matches its SHA-256 comes onto this computer", fs.existsSync(file1) && oc.copies[0].here === true && !oc.copies[0].changed);
  const changed = opened.cards.flatMap((c) => c.copies || []).filter((x) => x.changed);
  check("a copy that doesn't match is marked changed", changed.length === 1 && `${changed[0].sha256}.mhtml` === other, JSON.stringify(changed));
  await menuItem("Tab 1").catch(() => {});
  await sleep(1200);
  const texts = await ui.evaluate(() => [...document.querySelectorAll("#canvas .cv-card-copy")].map((b) => b.textContent));
  check("its card says so", texts.some((t) => /changed/.test(t)), JSON.stringify(texts));
  await ui.screenshot({ path: path.join(OUT, "53-opened.png") });

  await app.close();
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
