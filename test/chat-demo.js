// Unit checks for Ask AI across several pages (B49): numbered sources, the
// shared text budget, citations, and the session summary.
const C = require("../core/chat");
let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(ok ? "✓" : "✗", name, detail); };
const settings = { enabled: false, provider: "local", local: { url: "http://localhost:11434/v1", model: "llama3" }, grok: { model: "", key: "" } };
let sent = null;
const fakeFetch = (reply) => async (url, opt) => {
  sent = JSON.parse(opt.body);
  return new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), { status: 200 });
};
const sources = [
  { title: "Levain hydration", url: "https://a.example/levain", text: "A stiff levain at 50% ferments slower. ".repeat(800) },
  { title: "Rye enzymes", url: "https://b.example/rye", text: "Rye has more amylase than wheat." },
  { title: "Starter temperature", url: "https://c.example/temp", text: "Keep the starter at 24 to 28 C." },
];

(async () => {
  const msg = C.sourcesMessage(sources);
  check("sources are numbered from 1", /^\[1\] Levain hydration/.test(msg) && msg.includes("[2] Rye enzymes") && msg.includes("[3] Starter temperature"));
  check("a long page gets only its share of the budget", msg.length < C.SOURCES_CHARS + 1000, String(msg.length));
  const many = Array.from({ length: 14 }, (_, i) => ({ title: `P${i + 1}`, url: `https://x.example/${i}`, text: "t" }));
  check(`at most ${C.MAX_SOURCES} sources`, !C.sourcesMessage(many).includes("[11]"));
  check("citations: in order, no repeats, only real numbers", JSON.stringify(C.citations("Rye ferments faster [2][1]. Also [9] and [2].", 3)) === "[2,1]");

  const answer = await C.askSources({ question: "Which ferments faster?", sources, history: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }] }, settings, { fetch: fakeFetch("Rye ferments faster [2], and warmth speeds it up [3].") });
  check("askSources returns the model's answer", /Rye ferments faster \[2\]/.test(answer));
  check("the system message asks for numbered citations", /square brackets/.test(sent.messages[0].content));
  check("the sources and the question are sent", /\[3\] Starter temperature/.test(sent.messages[1].content) && sent.messages.at(-1).content === "Which ferments faster?");
  check("earlier questions are kept", sent.messages.some((m) => m.content === "hello"));

  const md = await C.summarizeSources({ name: "Sourdough", sources }, settings, { fetch: fakeFetch("## Key findings\n\n- Rye ferments faster [2].\n\n## Where sources disagree\n\nNothing found.\n\n## Open questions\n\n- How warm is too warm? [3]") });
  check("the summary has a title, the sections and a Sources list", /^# Sourdough: summary/.test(md) && /## Key findings/.test(md) && /## Sources\n\n1\. \[Levain hydration\]\(https:\/\/a\.example\/levain\)/.test(md));
  let err = "";
  try { await C.askSources({ question: "x", sources: [] }, settings, { fetch: fakeFetch("") }); } catch (e) { err = e.message; }
  check("no sources: a plain error", /Open some pages first/.test(err), err);
  console.log(failed ? `${failed} failed` : "all chat checks passed");
  process.exit(failed ? 1 : 0);
})();
