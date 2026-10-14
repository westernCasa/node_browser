// Research agent with a fake model and stubbed search: steps shown live,
// only search results read, a page with hidden instructions does not redirect
// it, report with sources, saved to the Library and the session, Stop works,
// no model set up.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const http = require("http");
const path = require("path"), fs = require("fs");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(require("os").tmpdir(), "scout-e2e-")), BASE = "http://127.0.0.1:8765";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);
(async () => {
  let slow = 0;
  const prompts = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const last = JSON.parse(body).messages.at(-1).content;
      prompts.push(last);
      if (slow) await sleep(slow);
      let out = "Starters fail mostly because they are kept too cold [1]. Rye flour speeds them up [1][2]. Chlorinated water can slow them [2].\n\n## What to do\n\n- Keep the starter near 26 degrees [1]\n- Use rye for part of the flour [2]";
      if (last.includes('{"queries"')) out = '{"queries": ["sourdough starter fails", "starter temperature rye"]}';
      else if (last.includes('{"pick"')) out = '{"pick": [1, 2, 3]}';
      else if (last.includes("bullet points")) out = last.includes("Starter forum") ? "- Cold kitchens are the main cause\n- Rye flour helps\n- Let tap water stand overnight" : "- Warmth between 24 and 28 degrees\n- Rye feeds the culture faster";
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: out } }] }));
    });
  });
  await new Promise((r) => server.listen(8898, "127.0.0.1", r));

  const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
  const app = await electron.launch({
    executablePath: require("electron"),
    args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")],
    env: { ...process.env, NODE_AGENT_ALLOW_LOCAL: "1" },
  });
  await app.evaluate(({}, base) => {
    const real = globalThis.fetch;
    globalThis.__agentSearches = [];
    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      if (u.startsWith("http://127.0.0.1:8898")) return real(url, opts);
      if (u.includes("wikipedia.org/w/api.php")) {
        globalThis.__agentSearches.push(new URL(u).searchParams.get("gsrsearch"));
        return new Response(JSON.stringify({ query: { pages: { 0: { index: 0, title: "Levain guide", fullurl: `${base}/other.html`, extract: "levain" } } } }), { status: 200 });
      }
      if (u.includes("duckduckgo.com")) {
        return new Response(`<a class="result__a" href="${base}/article.html">Why sourdough starters fail</a><a class="result__snippet">temperature</a><a class="result__a" href="${base}/inject.html">Starter forum</a><a class="result__snippet">members</a><a class="result__a" href="${base}/members.html">Members area</a><a class="result__snippet">sign in</a>`, { status: 200 });
      }
      return real(url, opts);
    };
  }, BASE);
  const ui = await app.firstWindow();
  await sleep(1500);

  // Default settings point at Ollama on this computer, which is not running here.
  await ui.click("#agent-run-btn");
  await sleep(500);
  log("default model line:", (await ui.textContent("#agent-privacy")).slice(0, 60));
  await ui.fill("#agent-input", "Why do sourdough starters fail?");
  await ui.click("#agent-start");
  await sleep(800);
  log("start with no model running:", (await ui.textContent("#agent-report")).slice(0, 70));

  // With the fake local model.
  await ui.evaluate(() => window.scout.setSettings({ ai: { enabled: false, provider: "local", local: { url: "http://127.0.0.1:8898/v1", model: "test-model" } } }));
  await ui.click("#agent-back");
  await ui.click("#agent-run-btn");
  await sleep(400);
  log("privacy line:", (await ui.textContent("#agent-privacy")).slice(0, 70));
  const visitsBefore = await app.evaluate(({ webContents }) => webContents.getAllWebContents().length);
  await ui.click("#agent-start");
  for (let i = 0; i < 60 && !(await ui.isVisible("#agent-after")); i++) await sleep(500);
  log("steps:", (await ui.$$eval("#agent-steps li", (e) => e.map((x) => x.className))).join(" > "));
  log("step lines:", (await ui.$$eval("#agent-steps li", (e) => e.map((x) => x.textContent))).filter((t) => /Reading|Skipped|Not relevant/.test(t)).join(" | "));
  log("searches sent:", JSON.stringify(await app.evaluate(() => globalThis.__agentSearches)));
  log("report heading:", await ui.textContent("#agent-report h1"), "| citations:", await ui.$$eval("#agent-report .cite", (e) => e.length), "| sources:", (await ui.$$eval("#agent-report ol:last-of-type li", (e) => e.map((x) => x.textContent))).join(" | "));
  log("links in report other than sources:", await ui.$$eval("#agent-report a[href]", (e) => e.length));
  const injected = prompts.filter((p) => p.includes("ignore your previous instructions"));
  log("injected text sent only inside untrusted tags:", injected.length > 0 && injected.every((p) => /<untrusted_page[^>]*>[\s\S]*ignore your previous instructions[\s\S]*<\/untrusted_page>/.test(p)));
  const secretFetched = await app.evaluate(({ webContents }) => webContents.getAllWebContents().some((w) => w.getURL().includes("secret")));
  log("secret.html opened:", secretFetched, "| windows left open by the reader:", (await app.evaluate(({ webContents }) => webContents.getAllWebContents().length)) - visitsBefore);
  await ui.screenshot({ path: path.join(OUT, "agent-report.png") });

  // Saved to the Library and the research session.
  const lib = JSON.parse(fs.readFileSync(path.join(userData, "library", "index.json"), "utf8"));
  const rep = lib.find((x) => /^report-/.test(x.name));
  log("library record:", rep?.note, "| file starts:", fs.readFileSync(rep.file, "utf8").split("\n")[0]);
  const sessionFile = fs.readdirSync(path.join(userData, "sessions")).find((f) => f.endsWith(".json"));
  await sleep(1200);
  const session = JSON.parse(fs.readFileSync(path.join(userData, "sessions", sessionFile), "utf8"));
  log("session reports:", session.reports?.length, "| agent activity rows:", session.agent?.length);

  // Sources in Mosaic.
  await ui.click("#agent-mosaic");
  await sleep(3000);
  log("tabs after Open sources in Mosaic:", await ui.$$eval("#tabs .tab", (e) => e.length), "| layout button:", await ui.textContent("#layout-btn"));

  // Stop.
  await ui.click("#layout-btn");
  slow = 1500;
  await ui.fill("#agent-input", "Another question");
  await ui.click("#agent-start");
  await sleep(1000);
  await ui.click("#agent-stop");
  for (let i = 0; i < 20 && (await ui.isVisible("#agent-stop")); i++) await sleep(500);
  log("after Stop:", (await ui.textContent("#agent-report")).trim(), "| pages read before stopping:", (await ui.$$eval("#agent-steps li.read", (e) => e.length)));
  server.close();
  process.exit(0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
