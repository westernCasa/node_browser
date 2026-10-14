// NODE's MCP bridge for apps that start MCP servers as a program and talk to
// them over stdin/stdout (the Claude desktop app, and others). It passes each
// message to NODE's own MCP server on this computer (agent-server.js) and
// writes the answers back. NODE must be running with Agents on.
//
// Run with Electron as plain Node (ELECTRON_RUN_AS_NODE=1), so no separate
// Node.js install is needed. Settings → Agents writes the config for you.
//   NODE_MCP_URL    http://127.0.0.1:<port>/mcp
//   NODE_MCP_TOKEN  the token shown in Settings

const http = require("http");

const url = new URL(process.env.NODE_MCP_URL || "http://127.0.0.1:47615/mcp");
const token = process.env.NODE_MCP_TOKEN || "";
let sessionId = "";

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function failFor(msg, text) {
  if (msg && msg.id !== undefined && msg.id !== null) send({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: text } });
}

function post(msg) {
  return new Promise((resolve) => {
    const body = JSON.stringify(msg);
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "content-length": Buffer.byteLength(body),
      authorization: `Bearer ${token}`,
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: "POST", headers, timeout: 60000 }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (res.headers["mcp-session-id"]) sessionId = String(res.headers["mcp-session-id"]);
        if (res.statusCode === 202 || !data) return resolve();
        if (res.statusCode === 401) {
          failFor(msg, "NODE refused the token. Copy the setup again from NODE's Settings → Agents.");
          return resolve();
        }
        try {
          send(JSON.parse(data));
        } catch (_) {
          failFor(msg, `NODE answered with HTTP ${res.statusCode}.`);
        }
        resolve();
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => {
      failFor(msg, "Could not reach NODE. Open NODE and turn on Agents (Settings → Agents).");
      resolve();
    });
    req.end(body);
  });
}

// Messages arrive one JSON object per line; handle them in order.
let buffer = "";
let chain = Promise.resolve();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (_) {
      continue;
    }
    chain = chain.then(() => post(msg));
  }
});
process.stdin.on("end", () => chain.then(() => process.exit(0)));
