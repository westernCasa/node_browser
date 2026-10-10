// Checks the AI query client with fake servers (no network, no model needed).
const ai = require("../core/ai.js");

const answers = [
  '{"queries": ["sourdough starter temperature", "lactobacillus sourdough microbiology", "Tartine Bakery levain method"]}',
  'Here are some ideas:\n```json\n{"queries": ["rye flour amylase", "site:reddit.com \\"starter\\" fails"]}\n```',
  "1. sourdough hydration ratio\n2. levain vs starter difference\n3. rye",
  "I cannot help with that.",
];
for (const a of answers) console.log("parse:", JSON.stringify(ai.parseQueries(a)));

const fakeFetch = (status, content, seen) => async (url, opts) => {
  seen.push({ url, auth: opts?.headers?.Authorization || "", body: opts?.body ? JSON.parse(opts.body) : null });
  if (url.endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "grok-a" }, { id: "grok-b" }] }), { status });
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
};

(async () => {
  const input = { pinned: ["sourdough"], keywords: ["starter", "rye", "temperature"], title: "Why sourdough starters fail | Bread Lab" };
  const seen = [];
  const local = { enabled: true, provider: "local", local: { url: "http://localhost:11434/v1/", model: "llama3.2" } };
  console.log("local:", await ai.expand(input, local, { fetch: fakeFetch(200, answers[0], seen) }), seen[0].url, "| auth:", seen[0].auth || "none");
  console.log("prompt sent:", JSON.stringify(seen[0].body.messages[1].content));
  const grok = { enabled: true, provider: "grok", grok: { key: "xai-test", model: "grok-a" } };
  seen.length = 0;
  console.log("grok:", await ai.expand(input, grok, { fetch: fakeFetch(200, answers[1], seen) }), seen[0].url, "| auth:", seen[0].auth);
  console.log("grok models:", await ai.listModels(grok, { fetch: fakeFetch(200, "", []) }));
  console.log("ready checks:", ai.ready(local), ai.ready({ ...grok, grok: { key: "", model: "x" } }), ai.ready({ ...local, enabled: false }));
  for (const status of [401, 404]) {
    try { await ai.expand(input, grok, { fetch: fakeFetch(status, "", []) }); } catch (e) { console.log(`grok HTTP ${status}:`, e.message); }
  }
  try { await ai.expand(input, local, { fetch: async () => { throw new TypeError("fetch failed"); } }); } catch (e) { console.log("local down:", e.message); }
})();
