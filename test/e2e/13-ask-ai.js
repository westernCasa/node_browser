// Ask AI about the current page, with a fake local model server: what is sent,
// the answer shown, follow-up questions, no model set up, server down.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const http = require("http");
const path = require("path");
const fs = require("fs");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(require("os").tmpdir(), "scout-e2e-"));
const BASE = "http://127.0.0.1:8765";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);

(async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const msg = JSON.parse(body || "{}");
      seen.push(msg);
      const last = msg.messages?.at(-1)?.content || "";
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: `Answer to: ${last}` } }] }));
    });
  });
  await new Promise((r) => server.listen(8899, "127.0.0.1", r));

  const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
  const app = await electron.launch({
    executablePath: require("electron"),
    args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
  });
  await app.evaluate(({ app: a }, ud) => {
    a.setPath("userData", ud);
    const real = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      if (u.startsWith("http://127.0.0.1:8899")) return real(url, opts);
      if (u.includes("localhost:11434")) throw new TypeError("fetch failed"); // no Ollama running
      if (u.includes("wikipedia.org/w/api.php")) return new Response(JSON.stringify({ query: { pages: {} } }), { status: 200 });
      return new Response("", { status: 200 });
    };
  }, userData);
  const ui = await app.firstWindow();
  await ui.waitForLoadState("domcontentloaded");
  await sleep(1500);
  await ui.fill("#omni", `${BASE}/article.html`);
  await ui.press("#omni", "Enter");
  await sleep(2500);

  // Default settings point at Ollama on this computer, which is not running here.
  await ui.click("#ask-btn");
  await sleep(500);
  log("default (Ollama, not running):", (await ui.textContent("#ask-privacy")).slice(0, 60));
  await ui.fill("#ask-input", "What is this page about?");
  await ui.press("#ask-input", "Enter");
  await sleep(800);
  log("answer with Ollama not running:", (await ui.textContent("#ask-log")).slice(-90));

  // Local model at the fake server (AI query ideas left off: chat does not need them).
  await ui.evaluate(() => window.scout.setSettings({ ai: { enabled: false, provider: "local", local: { url: "http://127.0.0.1:8899/v1", model: "test-model" } } }));
  await ui.click("#ask-clear");
  await ui.click("#ask-back");
  await ui.click("#ask-btn");
  await sleep(500);
  log("privacy line:", await ui.textContent("#ask-privacy"));
  await ui.click('#ask-quick [data-q^="Summarize"]');
  await sleep(1500);
  const first = seen.at(-1);
  const pageMsg = first.messages.find((m) => m.content.startsWith("Page title:")).content;
  log("sent to the model: model", first.model, "| title line:", pageMsg.split("\n")[0], "| page text chars:", pageMsg.length, "| has article words:", /starter/i.test(pageMsg), "| has footer/nav:", /Privacy policy|Home \| About/i.test(pageMsg));
  log("answer shown:", await ui.$$eval("#ask-log .ask-msg.assistant", (e) => e.map((x) => x.textContent).join(" / ")));
  await ui.fill("#ask-input", "Who is mentioned?");
  await ui.press("#ask-input", "Enter");
  await sleep(1500);
  const second = seen.at(-1);
  log("follow-up carries the earlier exchange:", second.messages.some((m) => m.role === "assistant" && m.content.startsWith("Answer to: Summarize")), "| messages sent:", second.messages.length);

  // Page changes: conversation starts over.
  await ui.click("#ask-back");
  await ui.fill("#omni", `${BASE}/other.html`);
  await ui.press("#omni", "Enter");
  await sleep(2000);
  await ui.click("#ask-btn");
  await sleep(500);
  log("after opening another page, messages shown:", await ui.$$eval("#ask-log .ask-msg", (e) => e.length));

  // Model server down.
  server.close();
  await sleep(300);
  await ui.fill("#ask-input", "Anything?");
  await ui.press("#ask-input", "Enter");
  await sleep(2500);
  log("server down:", await ui.$$eval("#ask-log .ask-msg.error", (e) => e.map((x) => x.textContent).join(" ")));

  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
