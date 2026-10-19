// MCP server checks: off by default, token and Origin checks, tools (search,
// shared tabs, logged-out page reader), hard blocks, research sessions as
// resources, sharing ends on a new site, stop switch.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path"), fs = require("fs");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(require("os").tmpdir(), "scout-e2e-")), BASE = "http://127.0.0.1:8765";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);
const PORT = 47699;
(async () => {
  const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
  const app = await electron.launch({
    executablePath: require("electron"),
    args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")],
    env: { ...process.env, NODE_AGENT_ALLOW_LOCAL: "1" },
  });
  await app.evaluate(({}, base) => {
    const orig = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes("wikipedia.org/w/api.php")) {
        const q = new URL(u).searchParams.get("gsrsearch");
        return new Response(JSON.stringify({ query: { pages: { 0: { index: 0, title: `Wiki: ${q}`, fullurl: `${base}/other.html?w=1`, extract: "Stub extract" } } } }), { status: 200 });
      }
      if (u.includes("duckduckgo.com")) return new Response(`<a class="result__a" href="${base}/article.html">Why sourdough starters fail</a><a class="result__snippet">Temperature and hydration</a>`, { status: 200 });
      return orig(url, opts);
    };
  }, BASE);
  const ui = await app.firstWindow();
  await sleep(1500);
  await ui.fill("#omni", BASE + "/article.html");
  await ui.press("#omni", "Enter");
  await sleep(3000);

  let token = "";
  let sid = 0;
  const rpc = async (method, params = {}, headers = {}) => {
    const r = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++sid, method, params }),
    });
    const body = await r.text();
    return { status: r.status, json: body ? JSON.parse(body) : null };
  };
  const call = async (name, args = {}) => {
    const r = await rpc("tools/call", { name, arguments: args });
    const res = r.json.result;
    return { error: Boolean(res.isError), text: res.content[0].text };
  };

  // 1. Off by default.
  let st = await ui.evaluate(() => window.scout.agentsStatus());
  log("off by default:", !st.enabled && !st.running, "| toolbar buttons hidden:", await ui.$eval("#agent-btn", (e) => e.hidden));
  await fetch(`http://127.0.0.1:${PORT}/mcp`).then(() => log("port open while off: true"), () => log("port open while off: false"));

  // 2. Turn on.
  await ui.evaluate((port) => window.scout.setSettings({ agents: { port } }), PORT);
  st = await ui.evaluate(() => window.scout.setAgents(true));
  token = st.token;
  await sleep(300);
  log("on:", st.running, "|", st.url, "| token length:", token.length, "| toolbar shows:", await ui.$eval("#agent-btn", (e) => !e.hidden && e.getAttribute("aria-label")));

  // 3. Access checks.
  log("no token:", (await rpc("ping", {}, { authorization: "" })).status, "| wrong token:", (await rpc("ping", {}, { authorization: "Bearer nope-nope-nope-nope" })).status, "| from a web page (Origin):", (await rpc("ping", {}, { origin: "https://evil.example" })).status);

  // 4. Handshake and tool list.
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
  log("initialize:", init.json.result.serverInfo.name, init.json.result.protocolVersion, "| tools cap:", Boolean(init.json.result.capabilities.tools));
  const notif = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  log("notification answered with:", notif.status);
  log("tools:", (await rpc("tools/list")).json.result.tools.map((t) => t.name).join(", "));

  // 5. Tools.
  const s = await call("search_web", { query: "sourdough starter" });
  log("search_web:", s.text.split("\n").slice(0, 3).join(" / "));
  log("shared tabs before sharing:", (await call("list_shared_tabs")).text.slice(0, 40));
  const tabId = await app.evaluate(({ webContents }) => null);
  const ids = await ui.evaluate(() => [...document.querySelectorAll("#tabs .tab")].map((e) => e.dataset.id));
  await ui.click("#agent-share-btn");
  await sleep(500);
  log("share button after click:", await ui.$eval("#agent-share-btn", (e) => e.getAttribute("aria-label")), "| tab mark:", await ui.$$eval("#tabs .agent-mark", (e) => e.length));
  const list = await call("list_shared_tabs");
  log("shared tabs:", list.text.replace(/\n\s*/g, " "));
  const rt = await call("read_tab", { tab_id: ids[0] });
  log("read_tab:", rt.error ? "ERROR " + rt.text : rt.text.split("\n").filter(Boolean).slice(0, 5).join(" / "));
  const fp = await call("fetch_page", { url: BASE + "/other.html" });
  log("fetch_page:", fp.error ? "ERROR " + fp.text : fp.text.split("\n").filter(Boolean).slice(0, 2).join(" / "));
  const cookies = await app.evaluate(async ({ session }) => (await session.fromPartition("node-agent").cookies.get({})).length + " cookies in agent session; user session separate: " + (session.fromPartition("node-agent") !== session.defaultSession));
  log("agent session:", cookies);

  // 6. Hard blocks.
  for (const u of ["https://accounts.google.com/signin", "file:///etc/passwd", "http://192.168.1.1/", BASE + "/members.html", "https://shop.example/checkout"]) {
    const r = await call("fetch_page", { url: u });
    log(`fetch_page ${u}:`, r.error ? "refused: " + r.text : "READ (unexpected)");
  }

  // 7. Research sessions.
  const res = (await rpc("resources/list")).json.result.resources.map((r) => r.uri);
  log("resources:", res.join(", "));
  const cur = (await rpc("resources/read", { uri: "node://sessions/current" })).json.result.contents[0].text;
  log("current session has pages and agent activity:", /## Pages read/.test(cur), /## Agent activity/.test(cur));
  log("get_research_session:", (await call("get_research_session")).text.split("\n")[0]);

  // 8. Sharing ends on another site; activity log in Settings.
  await ui.fill("#omni", "http://localhost:8765/other.html");
  await ui.press("#omni", "Enter");
  await sleep(2000);
  log("shared tabs after going to another site:", (await call("list_shared_tabs")).text.slice(0, 30));
  await ui.evaluate(() => document.querySelector('#sources-btn').click()); // in the menu overlay or the hidden Capture actions
  await sleep(800);
  log("settings shows:", await ui.$eval("#agents-state", (e) => e.textContent), "| log rows:", await ui.$$eval("#agents-log div", (e) => e.length));
  log("command:", (await ui.$eval("#agents-cmd", (e) => e.value)).replace(token, "<token>"));
  await ui.evaluate(() => document.getElementById("agents-box").scrollIntoView());
  await ui.screenshot({ path: path.join(OUT, "agents-settings.png") });

  // 8b. The Claude desktop app's bridge (mcp-bridge.js, stdio): NODE's own
  // Electron runs it as Node, as the config written by "Add to Claude app" does.
  const entry = await app.evaluate(() => global.nodeTest.claudeDesktopEntry());
  const bridged = await new Promise((resolve) => {
    const child = require("child_process").spawn(entry.command, entry.args, { env: { ...process.env, ...entry.env } });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    const msgs = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-desktop-test", version: "1" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_research_sessions", arguments: {} } },
    ];
    child.stdin.write(msgs.map((m) => JSON.stringify(m)).join("\n") + "\n");
    child.stdin.end();
    child.on("exit", () => resolve(out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))));
    setTimeout(() => child.kill(), 15000);
  });
  log("Claude app bridge:", bridged.map((m) => (m.id === 1 ? `initialize ${m.result?.serverInfo?.name}` : m.id === 2 ? `${m.result?.tools?.length} tools` : m.id === 3 ? `call ok ${!m.result?.isError}` : "?")).join(" | "));
  const cfg = await ui.evaluate(() => window.scout.claudeDesktop("config"));
  log("Claude app config file:", cfg.file.replace(require("os").homedir(), "~"), "| entry runs NODE as Node:", JSON.parse(cfg.config).mcpServers.node.env.ELECTRON_RUN_AS_NODE === "1");

  // 9. Stop switch.
  await ui.click("#agent-btn");
  await sleep(500);
  await fetch(`http://127.0.0.1:${PORT}/mcp`).then(() => log("server after Stop: still answering"), () => log("server after Stop: closed"));
  const saved = JSON.parse(fs.readFileSync(path.join(userData, "settings.json"), "utf8")).agents;
  log("settings saved:", JSON.stringify({ enabled: saved.enabled, port: saved.port, tokenStored: Boolean(saved.token?.enc || saved.token?.plain) }));
  process.exit(0);
})().catch((e) => { console.error("TEST ERROR", e); process.exit(1); });
