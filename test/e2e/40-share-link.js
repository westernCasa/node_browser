// Share links (B82 phase 2), against the real Worker on a local server:
// Create Link uploads an encrypted trail and lists it; the server holds no
// readable text; the link opens in another NODE (pasted in the address bar,
// or from the web page's Open in NODE) and in a plain browser; Stop Sharing
// removes it for everyone; a link without its key is refused.
const { _electron: electron, chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path"), fs = require("fs"), os = require("os");
const { start } = require("../share-server");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "node-e2e-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(ok ? "✓" : "✗", name, detail ? `(${detail})` : "");
};

async function launch(name, srv, userData = fs.mkdtempSync(path.join(OUT, "ud-"))) {
  if (!fs.existsSync(path.join(userData, "settings.json"))) fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ firstRunDone: true, displayName: name }));
  const app = await electron.launch({
    executablePath: require("electron"),
    args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")],
    env: { ...process.env, NODE_SHARE_API: srv.url, NODE_SHARE_LINK_BASE: srv.url },
  });
  await app.evaluate(() => {
    const o = globalThis.fetch;
    globalThis.fetch = async (u, opt) => (/wikipedia|duckduckgo|brave\.com/.test(String(u)) ? new Response("{}", { status: 200 }) : o(u, opt));
  });
  const ui = await app.firstWindow();
  await sleep(1800);
  return { app, ui, userData };
}

(async () => {
  const srv = await start(8790);

  // Sven makes a link.
  let { app, ui, userData: svenDir } = await launch("Sven", srv);
  await ui.evaluate(async () => {
    const s = window.scout;
    await s.researchRename("Sourdough secrets");
    await s.researchVisit("https://example.com/starters", "Why starters fail", ["hydration"]);
    const snap = await s.threadAdd({ title: "Why do starters fail in winter?" });
    await s.threadReply(snap.threadList[0].id, "", "Below 24 °C it sleeps.");
  });
  await ui.evaluate(() => openShareSheet());
  await sleep(800);
  await ui.click("#share-link");
  await sleep(1500);
  const link = await ui.inputValue("#link-text");
  check("Create Link makes a link with the key after #", new RegExp(`^${srv.url}/t/[A-Za-z0-9]{16}#k=[A-Za-z0-9_-]{43}$`).test(link), link);
  check("it says how long it works", /works until/.test(await ui.textContent("#link-note")));
  check("the link is listed under Your shared links", (await ui.isVisible("#links-box")) && /Sourdough secrets/.test(await ui.textContent("#links-list")));
  const stored = [...srv.env.TRAILS.items.values()];
  const raw = Buffer.from(stored[0].bytes).toString("latin1");
  check("the server holds one item, with no readable text", stored.length === 1 && !/Sourdough|starters|Sven|hydration/.test(raw) && raw.startsWith("NT1"));
  await app.close();

  // Alex opens it by pasting it in the address bar.
  ({ app, ui } = await launch("Alex", srv));
  await ui.evaluate((l) => window.scout.navigate(tabs.find((t) => t.id === activeId).id, l), link);
  await sleep(1500);
  check("a pasted link shows the shared-trail preview", (await ui.isVisible("#shared-sheet")) && /Sourdough secrets.*from Sven/.test(await ui.textContent("#shared-title")), await ui.textContent("#shared-title"));
  check("the preview counts what is in it", /1 page, 1 thread with 1 reply/.test(await ui.textContent("#shared-summary")));
  await ui.click("#shared-open-new");
  await sleep(1200);
  const s = await ui.evaluate(() => window.scout.researchGet());
  check("Open as New Trail works from a link", s.name === "Sourdough secrets" && s.threadList[0].replies[0].by === "Sven");

  // The web page's Open in NODE address.
  await app.evaluate((_e, l) => global.nodeTest.openShareLink(`noderesearch://open?link=${encodeURIComponent(l)}`), link);
  await sleep(1200);
  check("noderesearch://open?link=… opens the preview too", (await ui.isVisible("#shared-sheet")) && /from Sven/.test(await ui.textContent("#shared-title")));
  await ui.click("#shared-cancel");

  // A link without its key.
  await ui.evaluate((l) => window.scout.linkOpen(l.split("#")[0]), link);
  await sleep(900);
  check("a link without its key is refused with a reason", /missing its key/.test(await ui.textContent("#shared-summary")));

  // In a plain web browser.
  // (The Windows runner has no separate Chromium installed: skipped there.)
  const browser = await chromium.launch().catch(() => null);
  const page = browser && (await browser.newPage());
  if (page) {
    await page.goto(link);
    await page.waitForTimeout(1200);
    check("the web page decrypts and shows the trail", (await page.textContent("h1")) === "Sourdough secrets" && /Below 24 °C it sleeps\./.test(await page.textContent("#out")));
    check("its Open in NODE button carries the link", (await page.getAttribute("#open", "href")) === `noderesearch://open?link=${encodeURIComponent(link)}`);
  } else console.log("• web page checks skipped: no Chromium for Playwright here");
  await app.close();

  // Sven stops sharing: the link stops working for everyone.
  ({ app, ui } = await launch("Sven", srv, svenDir));
  await ui.evaluate(() => openShareSheet());
  await sleep(800);
  check("the link is still listed after a restart", /Sourdough secrets/.test(await ui.textContent("#links-list")));
  await ui.click("#links-list .link-btn:has-text('Stop Sharing')");
  check("Stop Sharing asks once more", (await ui.locator("#links-list .link-btn", { hasText: "stops working for everyone" }).count()) === 1 && srv.env.TRAILS.items.size === 1);
  await ui.click("#links-list .link-btn:has-text('stops working')");
  await sleep(1000);
  check("then removes it from the server and the list", srv.env.TRAILS.items.size === 0 && !(await ui.isVisible("#links-box")));
  if (page) {
    await page.reload();
    await page.waitForTimeout(800);
    check("the web page then says the link was removed", /expired or was removed/.test(await page.textContent("#out")));
  }
  await app.close();
  await browser?.close();
  srv.server.close();
  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
