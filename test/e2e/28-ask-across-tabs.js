// Ask AI across several pages (B49): the scope switch, Mosaic tabs and the
// research session as numbered sources, citations that open the source, a
// session page read logged out after its tab was closed, sign-in pages left
// out, and the cited session summary saved to the Library.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path"), fs = require("fs"), os = require("os"), http = require("http");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "node-e2e-"));
const BASE = "http://127.0.0.1:8765";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(ok ? "✓" : "✗", name, detail ? `(${detail})` : "");
};

(async () => {
  // A fake model: answers with citations to the sources it was given, and says
  // which titles it saw.
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const msgs = JSON.parse(body).messages;
      const sources = msgs.find((m) => /^(Sources:|Research session:)/.test(m.content))?.content || "";
      const titles = [...sources.matchAll(/^\[(\d+)\] (.*)$/gm)].map((m) => `${m[1]}=${m[2]}`);
      seen.push(titles);
      const summary = /three sections/.test(msgs[0].content);
      const content = summary
        ? "## Key findings\n\n- Levain ferments slower when stiff [1].\n\n## Where sources disagree\n\nNothing found.\n\n## Open questions\n\n- Rye timing [2]."
        : `From the sources: first [1], second [2]. Seen: ${titles.join("; ")}`;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise((r) => server.listen(8898, "127.0.0.1", r));

  const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
  fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ firstRunDone: true }));
  const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")], env: { ...process.env, NODE_AGENT_ALLOW_LOCAL: "1" } });
  await app.evaluate(() => {
    const real = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      if (u.startsWith("http://127.0.0.1:8898") || u.startsWith("http://127.0.0.1:8765")) return real(url, opts);
      if (u.includes("wikipedia.org/w/api.php")) return new Response(JSON.stringify({ query: { pages: {} } }), { status: 200 });
      return new Response("", { status: 200 });
    };
  });
  const ui = await app.firstWindow();
  await sleep(1500);
  await ui.evaluate(() => window.scout.setSettings({ ai: { enabled: false, provider: "local", local: { url: "http://127.0.0.1:8898/v1", model: "test" } } }));
  const go = async (url) => { await ui.fill("#omni", url); await ui.press("#omni", "Enter"); await sleep(2500); };
  await go(`${BASE}/article.html`);
  for (const u of ["/other.html", "/big.html"]) { await ui.evaluate((x) => window.scout.createTab(x), BASE + u); await sleep(2500); }
  await ui.click("#layout-btn");
  await sleep(1200);

  // Ask about the tabs in Mosaic.
  await ui.click("#ask-btn");
  await sleep(600);
  check("the Ask tab has This page, Mosaic tabs and Session", (await ui.$$eval("#ask-scope [data-scope]", (b) => b.map((x) => x.textContent).join("|"))) === "This page|Mosaic tabs|Session");
  await ui.click('#ask-scope [data-scope="mosaic"]');
  await sleep(500);
  check("the privacy line says what Mosaic questions send", /tabs Mosaic shows/.test(await ui.textContent("#ask-privacy")), await ui.textContent("#ask-privacy"));
  await ui.click("#ask-quick button:has-text('Compare')");
  await sleep(4000);
  const last = seen.at(-1) || [];
  check("all three Mosaic tabs are sent as numbered sources", last.length === 3 && /Why sourdough/.test(last.join()) && /Levain guide/.test(last.join()), last.join("; "));
  const cites = await ui.$$eval("#ask-log .ask-msg.assistant .cite", (b) => b.map((x) => x.textContent));
  const listed = await ui.$$eval("#ask-log .ask-msg.assistant .ask-sources li button", (b) => b.map((x) => x.textContent));
  check("citations become buttons and the sources are listed", cites.join() === "1,2" && listed.length === 3, `${cites} | ${listed.join("; ")}`);
  const before = await ui.evaluate(() => activeId);
  await ui.click("#ask-log .ask-msg.assistant .cite >> nth=1");
  await sleep(800);
  const after = await ui.evaluate(() => ({ id: activeId, n: tabs.length }));
  check("clicking a citation opens that source's tab", after.id !== before && after.n === 3, JSON.stringify(after));

  // Session: close one tab first; its page is read again, logged out.
  await ui.evaluate(() => window.scout.closeTab(tabs.find((t) => /big\.html/.test(t.url)).id));
  await sleep(1000);
  await ui.click('#ask-scope [data-scope="session"]');
  await sleep(500);
  check("the conversation starts fresh for the session", (await ui.$$eval("#ask-log .ask-msg", (m) => m.length)) === 0);
  await ui.fill("#ask-input", "What did I read?");
  await ui.press("#ask-input", "Enter");
  await sleep(8000);
  const sess = seen.at(-1) || [];
  check("the session's pages are sent, the closed one read logged out", sess.length >= 3 && /Big Article/.test(sess.join()), sess.join("; "));

  await ui.click("#ask-quick button:has-text('Summarize session')");
  await sleep(9000);
  const msg = await ui.evaluate(() => { const m = [...document.querySelectorAll("#ask-log .ask-msg.assistant")].at(-1); return m ? m.textContent : ""; });
  check("Summarize session writes a cited summary", /Key findings/.test(msg) && /Saved to the Library: summary-/.test(msg), msg.slice(0, 120));
  const lib = fs.readdirSync(path.join(userData, "library", "saves")).filter((f) => /^summary-.*\.md$/.test(f));
  const text = lib.length ? fs.readFileSync(path.join(userData, "library", "saves", lib[0]), "utf8") : "";
  check("the summary is saved to the Library with its sources", /: summary/.test(text) && /## Sources\n\n1\. \[/.test(text), lib.join());

  // No model set up: a plain message.
  await ui.evaluate(() => window.scout.setSettings({ ai: { provider: "grok", grok: { key: "", model: "grok-test" } } }));
  await ui.fill("#ask-input", "anything");
  await ui.press("#ask-input", "Enter");
  await sleep(1500);
  check("without a model, Ask says how to set one up", /Set up a model first/.test(await ui.textContent("#ask-log")));

  await app.evaluate(({ app }) => app.quit());
  server.close();
  console.log(failed ? `${failed} checks failed` : "all checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
