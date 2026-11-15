// AI consent, demo answers and the report email. Run: npm test (in mobile/).
const assert = require("assert");
const P = require("../src/aiPolicy");

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`ok ${passed} - ${name}`);
};

const PAGE = {
  url: "https://en.wikipedia.org/wiki/Sourdough",
  title: "Sourdough",
  text:
    "Sourdough is bread made by the fermentation of dough using wild yeast and lactic acid bacteria. " +
    "The lactic acid produced by the bacteria gives sourdough its sour taste and improves its keeping qualities. " +
    "Sourdough was the main way of leavening bread until baker's yeast became common in the 19th century. " +
    "In 1849 the California Gold Rush made sourdough a staple of miners in San Francisco. " +
    "A sourdough starter is fed regularly with flour and water to keep the yeast and bacteria alive. " +
    "Rye flour is often used in starters because it ferments quickly.",
};

test("consent is per provider; the demo needs none", () => {
  assert.strictEqual(P.hasConsent({ provider: "grok" }, {}), false);
  assert.strictEqual(P.hasConsent({ provider: "grok" }, { grok: 1 }), true);
  assert.strictEqual(P.hasConsent({ provider: "local" }, { grok: 1 }), false, "consent to Grok is not consent to another server");
  assert.strictEqual(P.hasConsent({ provider: "demo" }, {}), true);
  assert.strictEqual(P.consentText({ provider: "demo" }), null);
  const g = P.consentText({ provider: "grok" });
  assert.match(g.title, /Grok \(xAI\)/);
  assert.ok(g.lines.some((l) => /address, title and text/.test(l)));
  assert.ok(g.lines.some((l) => /withdraw/.test(l)));
});

test("AI query ideas only run with consent, never for the demo", () => {
  const ai = { enabled: true, provider: "grok" };
  assert.strictEqual(P.aiForQueries(ai, {}).enabled, false);
  assert.strictEqual(P.aiForQueries(ai, { grok: 1 }).enabled, true);
  assert.strictEqual(P.aiForQueries({ enabled: true, provider: "demo" }, {}).enabled, false);
  assert.strictEqual(P.aiForQueries({ enabled: false, provider: "grok" }, { grok: 1 }).enabled, false);
});

test("demo answers come from the page and say so", () => {
  const sum = P.demoAnswer("Summarize this page in 5 bullet points.", PAGE);
  assert.ok(sum.includes("• Sourdough is bread made by the fermentation"));
  assert.ok(sum.endsWith(P.DEMO_NOTE));
  const facts = P.demoAnswer("What are the key facts, names and dates on this page?", PAGE);
  assert.ok(facts.includes("1849"));
  const q = P.demoAnswer("Why use rye flour?", PAGE);
  assert.ok(q.includes("Rye flour is often used"));
  const none = P.demoAnswer("quantum chromodynamics?", PAGE);
  assert.ok(none.startsWith("No sentence on this page matches"));
  assert.ok(P.demoAnswer("x", { text: "" }).startsWith("This page has no readable text"));
  // Every line of a demo answer that isn't the note is a sentence from the page.
  for (const line of sum.split("\n").filter((l) => l.startsWith("• "))) assert.ok(PAGE.text.includes(line.slice(2)));
});

test("report email carries the answer, not the key", () => {
  const m = P.reportMailto({ to: "reports@example.org", provider: "Grok (xAI)", model: "grok-4.3", question: "Q?", answer: "A.", url: PAGE.url, version: "1.0.0" });
  assert.ok(m.startsWith("mailto:reports%40example.org?subject=NODE%3A%20report%20an%20AI%20answer&body="));
  const body = decodeURIComponent(m.split("body=")[1]);
  assert.ok(body.includes("Provider: Grok (xAI) (grok-4.3)") && body.includes("Answer:\nA.") && body.includes("App version: 1.0.0"));
  assert.ok(!/key/i.test(body.replace("Answer", "")), "no keys in reports");
});

console.log(`\n${passed} passed`);
