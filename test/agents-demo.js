// Address checks for the agent tools (agents.js) and the MCP handshake
// (agent-server.js), without Electron.
const assert = require("assert");
const { checkAddress, isPrivateHost } = require("../agents");
const { createAgentServer } = require("../agent-server");

const refused = (url, opts) => {
  try {
    checkAddress(url, opts);
    return "";
  } catch (e) {
    return e.message;
  }
};
const cases = [
  ["https://en.wikipedia.org/wiki/Sourdough", false],
  ["https://scholar.google.com/scholar?q=x", false],
  ["https://accounts.google.com/signin", true],
  ["https://example.com/login", true],
  ["https://example.com/account/settings", true],
  ["https://shop.example/checkout?step=2", true],
  ["https://www.chase.com/bank", true],
  ["file:///etc/passwd", true],
  ["javascript:alert(1)", true],
  ["http://localhost:3000/", true],
  ["http://127.0.0.1:8765/", true],
  ["http://192.168.1.1/", true],
  ["http://10.0.0.5/", true],
  ["http://169.254.169.254/latest/meta-data", true],
  ["http://[::1]/", true],
  ["http://printer.local/", true],
  ["https://blog.example/accountability-in-science", false],
  // Found in the MCP test (B66): GitHub's sign-in endpoint and X's passkey page.
  ["https://github.com/session", true],
  ["https://x.com/i/flow/passkey", true],
  ["https://example.org/conference/session/3", false],
];
for (const [url, want] of cases) {
  const why = refused(url);
  console.log(`${Boolean(why) === want ? "ok  " : "FAIL"} ${why ? "refused" : "allowed"} ${url}${why ? `  (${why})` : ""}`);
  assert.strictEqual(Boolean(why), want, url);
}
assert.ok(!refused("http://127.0.0.1:8765/", { allowPrivate: true }), "test mode allows this computer");
assert.ok(refused("http://192.168.1.1/", { allowPrivate: true }), "test mode still blocks the network");
assert.ok(isPrivateHost("172.20.1.1") && !isPrivateHost("172.32.1.1"));
console.log("ok   test mode opens only 127.0.0.1 and localhost");

(async () => {
  const srv = createAgentServer({
    getConfig: () => ({ token: "x".repeat(32), port: 0 }),
    tools: [{ name: "echo", description: "e", inputSchema: { type: "object" }, perMinute: 2, run: async (a) => ({ text: a.say }) }],
    resources: { list: () => [], read: () => ({ text: "" }) },
  });
  const init = await srv.dispatch({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } });
  assert.strictEqual(init.result.protocolVersion, "2025-11-25");
  const r1 = await srv.dispatch({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "echo", arguments: { say: "hi" } } });
  assert.strictEqual(r1.result.content[0].text, "hi");
  await srv.dispatch({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { say: "hi" } } });
  const r3 = await srv.dispatch({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "echo", arguments: { say: "hi" } } });
  assert.ok(r3.result.isError && /Rate limit/.test(r3.result.content[0].text));
  const r4 = await srv.dispatch({ jsonrpc: "2.0", id: 5, method: "nope" });
  assert.strictEqual(r4.error.code, -32601);
  console.log("ok   handshake, tool call, rate limit, unknown method");
})();
