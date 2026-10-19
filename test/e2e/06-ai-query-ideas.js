// B20 checks: AI query ideas with a fake local model server and a fake Grok API.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path"), fs = require("fs");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(require("os").tmpdir(), "scout-e2e-"));
const BASE = "http://127.0.0.1:8765";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);

(async () => {
  const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
  const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")] });
  await app.evaluate(() => {
    globalThis.__ai = { calls: [], localUp: true };
    const o = globalThis.fetch;
    const json = (v, status = 200) => new Response(JSON.stringify(v), { status });
    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      const q = (() => { try { const x = new URL(u); return x.searchParams.get("gsrsearch") || x.searchParams.get("q"); } catch { return ""; } })();
      if (u.includes("wikipedia.org/w/api.php")) {
        const pages = {};
        for (let i = 0; i < 2; i++) pages[i] = { index: i, title: `Wiki ${i + 1}: ${q}`, fullurl: `http://127.0.0.1:8765/other.html?w=${encodeURIComponent(q)}&i=${i}`, extract: "stub" };
        return json({ query: { pages } });
      }
      if (u.includes("duckduckgo")) return new Response(`<a class="result__a" href="http://127.0.0.1:8765/other.html?d=${encodeURIComponent(q)}">Web: ${q}</a><a class="result__snippet">s</a>`, { status: 200 });
      if (u.startsWith("http://localhost:11434/v1")) {
        if (!globalThis.__ai.localUp) throw new TypeError("fetch failed");
        globalThis.__ai.calls.push({ who: "local", url: u, body: opts?.body || "" });
        if (u.endsWith("/models")) return json({ data: [{ id: "llama3.2" }, { id: "qwen2.5" }] });
        return json({ choices: [{ message: { content: '{"queries": ["levain fermentation microbiology", "rye starter amylase enzymes"]}' } }] });
      }
      if (u.startsWith("https://api.x.ai/v1")) {
        const auth = opts?.headers?.Authorization || "";
        globalThis.__ai.calls.push({ who: "grok", url: u, auth, body: opts?.body || "" });
        if (auth !== "Bearer xai-good") return json({ error: "bad key" }, 401);
        if (u.endsWith("/models")) return json({ data: [{ id: "grok-fast" }] });
        return json({ choices: [{ message: { content: 'Sure!\n```json\n{"queries": ["sourdough starter troubleshooting guide", "wild yeast temperature range"]}\n```' } }] });
      }
      return o(url, opts);
    };
  });
  const ui = await app.firstWindow();
  await sleep(1500);
  const go = async (url) => { await ui.fill("#omni", url); await ui.press("#omni", "Enter"); };
  const waitStatus = async (must = "") => { const t0 = Date.now(); while (Date.now() - t0 < 20000) { const s = await ui.textContent("#suggest-status"); if (/^\d+ results/.test(s) && s.includes(must)) return s; await sleep(200); } return await ui.textContent("#suggest-status"); };

  await go(BASE + "/article.html");
  log("AI off:", await waitStatus());

  await ui.evaluate(() => document.querySelector('#sources-btn').click()); // in the menu overlay or the hidden Capture actions
  await sleep(600);
  await ui.check("#ai-enabled");
  await ui.click("#ai-test");
  await sleep(1500);
  log("local Test:", await ui.textContent("#ai-state"));
  log("models offered:", (await ui.$$eval("#ai-models option", (o) => o.map((x) => x.value))).join(", "));
  await ui.click("#sources-save");
  await sleep(300);
  await ui.click("#refresh-suggest");
  log("with local AI:", await waitStatus());
  log("AI-sourced cards:", await ui.$$eval("#results .card .q", (e) => e.filter((x) => /microbiology|amylase/.test(x.textContent)).length));
  const sent = await app.evaluate(() => globalThis.__ai.calls.filter((c) => c.url.endsWith("/chat/completions")).map((c) => c.body).at(-1));
  const msg = JSON.parse(sent).messages[1].content;
  log("what the model received:", JSON.stringify(msg));
  log("page text or address sent:", /Wild yeast and lactobacillus|127\.0\.0\.1/.test(sent));

  // Grok: bad key, then good key with a wrong model name, then the right model.
  await ui.evaluate(() => document.querySelector('#sources-btn').click()); // in the menu overlay or the hidden Capture actions
  await sleep(600);
  await ui.selectOption("#ai-provider", "grok");
  await ui.fill("#ai-grok-key", "xai-bad");
  await ui.click("#ai-test");
  await sleep(1200);
  log("Grok bad key:", await ui.textContent("#ai-state"));
  await ui.fill("#ai-grok-key", "xai-good");
  await ui.click("#ai-test");
  await sleep(1200);
  log("Grok default model:", await ui.textContent("#ai-state"));
  await ui.fill("#ai-grok-model", "grok-fast");
  await ui.click("#ai-test");
  await sleep(1200);
  log("Grok grok-fast:", await ui.textContent("#ai-state"));
  await ui.screenshot({ path: path.join(OUT, "ai-settings.png") });
  await ui.click("#sources-save");
  await sleep(300);
  await go(BASE + "/other.html?ai=1");
  log("with Grok:", await waitStatus());

  // Local server down: search still works, with a note.
  await ui.evaluate(() => document.querySelector('#sources-btn').click()); // in the menu overlay or the hidden Capture actions
  await sleep(500);
  await ui.selectOption("#ai-provider", "local");
  await ui.click("#sources-save");
  await app.evaluate(() => { globalThis.__ai.localUp = false; });
  await go(BASE + "/media.html");
  log("local model down:", await waitStatus("recordings"));
  process.exit(0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
