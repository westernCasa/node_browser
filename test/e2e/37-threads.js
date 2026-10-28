// Threads and notes in a trail (B82): the display name is asked the first
// time; threads take replies and answers to replies, resolve with a
// conclusion, reopen, take tags and the current page; keyword threads are
// offered; pages take notes; the sidebar counts threads; all is kept.
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

async function launch() {
  const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")] });
  await app.evaluate(() => {
    const o = globalThis.fetch;
    globalThis.fetch = async (u, opt) => (/wikipedia|duckduckgo|brave\.com/.test(String(u)) ? new Response("{}", { status: 200 }) : o(u, opt));
  });
  const ui = await app.firstWindow();
  await sleep(1800);
  return { app, ui };
}
const threadsNow = (ui) => ui.evaluate(async () => (await window.scout.researchGet()).threadList || []);

(async () => {
  let { app, ui } = await launch();
  // Two pages with a shared keyword, so a keyword thread is offered.
  await ui.evaluate(() => window.scout.researchVisit("https://example.com/starters", "Starters", ["hydration", "starter"]));
  await ui.evaluate(() => window.scout.researchVisit("https://example.com/rye", "Rye", ["hydration", "rye"]));
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/other.html?n=page`);
  await sleep(1200);
  await ui.evaluate(() => openMenu("trail"));
  await sleep(800);

  await ui.fill("#thread-title", "Why do starters fail in winter?");
  await ui.click("#thread-new button[type=submit]");
  await sleep(500);
  check("the first time, NODE asks for a display name", await ui.isVisible("#name-ask"));
  check("no thread is made before the name is given", (await threadsNow(ui)).length === 0);
  await ui.fill("#name-ask-input", "Sven");
  await ui.click("#name-ask-save");
  await sleep(800);
  let list = await threadsNow(ui);
  check("then the thread is made, with the name", list.length === 1 && list[0].by === "Sven" && list[0].status === "open", JSON.stringify(list));
  check("the name is saved in Settings → Sharing", (await ui.evaluate(async () => (await window.scout.getSettings()).displayName)) === "Sven");
  check("the name box hides and the title field clears", !(await ui.isVisible("#name-ask")) && (await ui.inputValue("#thread-title")) === "");

  // Reply, then answer the reply.
  const thread = ui.locator(".thread").first();
  check("a new thread opens folded out", (await thread.locator(".thread-head").getAttribute("aria-expanded")) === "true");
  await thread.locator(".thread-actions .chip", { hasText: "Reply" }).click();
  await thread.locator(".thread-actions textarea").fill("Below 24 °C it goes dormant.");
  await thread.locator(".thread-actions .inline-form .chip", { hasText: "Post" }).click();
  await sleep(700);
  await ui.locator(".thread .reply .link-btn", { hasText: "Reply" }).first().click();
  await ui.locator(".thread .reply .inline-form textarea").fill("Rye flour helps.");
  await ui.keyboard.press("Control+Enter");
  await sleep(700);
  list = await threadsNow(ui);
  check("a reply, and an answer to it, sit in place", list[0].replies[0]?.text === "Below 24 °C it goes dormant." && list[0].replies[0].replies[0]?.text === "Rye flour helps." && list[0].replies[0].replies[0].by === "Sven", JSON.stringify(list[0].replies));
  check("answers show indented under the reply", (await ui.locator(".thread .replies .replies .reply-text").first().textContent()) === "Rye flour helps.");
  check("the thread line counts every reply", /2 replies/.test(await ui.locator(".thread .thread-meta").first().textContent()));

  // The page in the current tab, tags, resolve and reopen.
  await ui.locator(".thread-actions .chip", { hasText: "Add This Page" }).click();
  await sleep(600);
  list = await threadsNow(ui);
  check("Add This Page links the current tab's page", list[0].pages.some((u) => /other\.html\?n=page/.test(u)), JSON.stringify(list[0].pages));
  await ui.locator(".thread-actions .chip", { hasText: "Tags…" }).click();
  await ui.locator(".thread-actions .inline-form input").fill("temperature, #methods");
  await ui.keyboard.press("Enter");
  await sleep(600);
  list = await threadsNow(ui);
  check("tags are saved, without #", list[0].tags.join() === "temperature,methods", list[0].tags.join());
  await ui.locator(".thread-actions .chip", { hasText: "Resolve…" }).click();
  await ui.locator(".thread-actions .inline-form input").fill("Keep it above 24 °C.");
  await ui.keyboard.press("Enter");
  await sleep(600);
  list = await threadsNow(ui);
  check("resolve with a conclusion", list[0].status === "resolved" && list[0].conclusion === "Keep it above 24 °C.");
  check("the conclusion shows in the thread", /Keep it above 24/.test(await ui.locator(".thread-conclusion").textContent()));
  await ui.locator(".thread-actions .chip", { hasText: "Reopen" }).click();
  await sleep(600);
  check("reopen", (await threadsNow(ui))[0].status === "open");

  // A keyword shared by two pages is offered as a thread.
  const offer = ui.locator("#thread-suggest .link-btn", { hasText: "hydration" });
  check("a recurring keyword is offered as a thread", (await offer.count()) === 1);
  await offer.click();
  await sleep(700);
  list = await threadsNow(ui);
  const kw = list.find((t) => t.title === "hydration");
  check("the keyword thread takes the pages that share it", kw && kw.pages.length === 2 && kw.tags.join() === "hydration", JSON.stringify(kw));
  check("and it is no longer offered", (await ui.locator("#thread-suggest .link-btn", { hasText: "hydration" }).count()) === 0);

  // Notes on a page.
  const row = ui.locator(".trail-row", { hasText: "Starters" });
  await row.locator(".link-btn", { hasText: "Add note" }).click();
  await row.locator("textarea").fill("Good overview.");
  await row.locator(".chip", { hasText: "Save Note" }).click();
  await sleep(600);
  const snap = await ui.evaluate(() => window.scout.researchGet());
  const note = snap.trail.find((r) => r.url === "https://example.com/starters").notes?.[0];
  check("a note goes on the page with the name", note?.text === "Good overview." && note.by === "Sven");
  check("the note shows under the page", /Sven.*Good overview/.test(await ui.locator(".trail-row", { hasText: "Starters" }).locator(".note").textContent()));

  // Remove asks once more.
  const remove = ui.locator(".thread", { hasText: "hydration" }).locator(".thread-actions .chip", { hasText: "Remove" });
  await remove.click();
  await sleep(200);
  check("Remove asks to confirm first", (await threadsNow(ui)).length === 2 && /Remove thread and replies\?/.test(await ui.locator(".thread", { hasText: "hydration" }).locator(".thread-actions").textContent()));
  await ui.locator(".thread", { hasText: "hydration" }).locator(".chip", { hasText: "Remove thread" }).click();
  await sleep(600);
  check("then removes the thread", (await threadsNow(ui)).length === 1);

  await ui.evaluate(() => closeMenu());
  await sleep(4500);
  check("the sidebar's trail line counts threads", /1 THREAD\b/.test(await ui.textContent("#sb-trail-meta")), await ui.textContent("#sb-trail-meta"));

  // Kept across a restart.
  await app.close();
  ({ app, ui } = await launch());
  list = await threadsNow(ui);
  check("threads, replies and the conclusion are kept after a restart", list.length === 1 && list[0].replies[0].replies[0].text === "Rye flour helps." && list[0].conclusion === "Keep it above 24 °C.");
  await app.close();
  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
