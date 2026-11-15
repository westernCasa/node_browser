// The WebView bridge accepts only known, well-formed messages. Run: npm test.
const assert = require("assert");
const { checkMessage, MAX_RAW } = require("../src/pageMessages");

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`ok ${passed} - ${name}`);
};
const pending = new Map([["7", "tabA"], ["cap1", "tabA"]]);
const ctx = (tabId) => ({ tabId, pendingFor: (id) => pending.get(id) ?? null });
const J = JSON.stringify;

test("junk and unknown types are ignored", () => {
  for (const raw of ["", "not json", "[]", "null", "42", J({}), J({ type: "eval", code: "x" }), J({ type: "setKey", key: "k" }), "x".repeat(MAX_RAW + 1)]) assert.strictEqual(checkMessage(raw, ctx("tabA")), null, raw.slice(0, 30));
  assert.strictEqual(checkMessage({ type: "scroll" }, ctx("tabA")), null, "only strings");
});

test("answers only to NODE's own requests to the same tab", () => {
  assert.ok(checkMessage(J({ type: "extract", id: 7, data: { text: "t" } }), ctx("tabA")));
  assert.strictEqual(checkMessage(J({ type: "extract", id: 7, data: {} }), ctx("tabB")), null, "another tab can't answer");
  assert.strictEqual(checkMessage(J({ type: "extract", id: 99, data: {} }), ctx("tabA")), null, "no such request");
  assert.ok(checkMessage(J({ type: "capinfo", id: "ft:tabA", url: "https://a.org" }), ctx("tabA")));
  assert.strictEqual(checkMessage(J({ type: "capinfo", id: "ft:tabB", url: "https://a.org" }), ctx("tabA")), null);
});

test("fields are typed and trimmed", () => {
  const m = checkMessage(J({ type: "capinfo", id: "cap1", url: 5, title: "T".repeat(900), metas: [["citation_doi", "10.1/x"], "bad", ["a"]], links: Array(9).fill("https://doi.org/10.1/x"), extra: "dropped" }), ctx("tabA"));
  assert.strictEqual(m.url, "");
  assert.strictEqual(m.title.length, 500);
  assert.deepStrictEqual(m.metas, [["citation_doi", "10.1/x"]]);
  assert.strictEqual(m.links.length, 5);
  assert.ok(!("extra" in m));
  assert.deepStrictEqual(checkMessage(J({ type: "media", playing: "yes" }), ctx("tabA")), { type: "media", playing: false });
  assert.strictEqual(checkMessage(J({ type: "selection", text: "s".repeat(9000) }), ctx("tabA")).text.length, 5000);
});

console.log(`\n${passed} passed`);
