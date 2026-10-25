// Research sessions keep sign-in, account, payment and banking pages out of
// the trail (B66), and take them out of sessions saved before 0.9.1.
//   node test/research-demo.js
const assert = require("assert");
const { ResearchStore } = require("../core/research");

function memoryStorage(files = {}) {
  return { read: (n) => (n in files ? files[n] : null), write: (n, t) => (files[n] = t), list: () => Object.keys(files), files };
}

const store = new ResearchStore(memoryStorage());
store.visit("https://en.wikipedia.org/wiki/Bioluminescence", "Bioluminescence", ["light"]);
store.visit("https://github.com/session", "Sign in to GitHub");
store.visit("https://x.com/i/flow/passkey", "X");
store.visit("https://shop.example/checkout?step=2", "Checkout");
store.opened({ url: "https://accounts.google.com/signin", title: "Sign in" });
store.capture({ libraryId: "1", kind: "shot", url: "https://example.com/login", title: "Log in" });
store.capture({ libraryId: "2", kind: "shot", url: "https://example.org/reef", title: "Reef" });
const urls = store.current.trail.map((r) => r.url);
console.log("trail:", urls.join(" | "));
assert.deepStrictEqual(urls, ["https://en.wikipedia.org/wiki/Bioluminescence", "https://example.org/reef"]);
assert.strictEqual(store.current.opened.length, 0, "sign-in page not recorded as opened");
assert.strictEqual(store.current.captures.length, 1, "capture of a sign-in page not linked");
console.log("ok   sign-in, passkey and checkout pages are not recorded");

// A session saved by an older version, with sign-in pages in it.
const old = { id: "old", name: "Before 0.9.1", started: 1, updated: 1, pins: [], opened: [{ url: "https://github.com/session" }], dismissed: [], captures: [],
  trail: [{ url: "https://en.wikipedia.org/wiki/Squid", title: "Squid", keywords: [] }, { url: "https://github.com/session", title: "GitHub", keywords: [] }, { url: "https://x.com/i/flow/login", title: "X", keywords: [] }] };
const files = { "current.txt": "old", "old.json": JSON.stringify(old) };
const reopened = new ResearchStore(memoryStorage(files));
assert.deepStrictEqual(reopened.current.trail.map((r) => r.url), ["https://en.wikipedia.org/wiki/Squid"]);
assert.ok(!files["old.json"].includes("github.com/session"), "the saved file is cleaned too");
console.log("ok   an older session loses its sign-in pages when opened, on disk too");
