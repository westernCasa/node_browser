// Talk (core/talk.js): address cleaning, what is never looked up, and the
// Hacker News and Bluesky answers turned into rows (fake answers in the real
// shapes of the two APIs).
const assert = require("assert");
const Talk = require("../core/talk");

assert.strictEqual(Talk.cleanUrl("https://www.example.com/a/b/?utm_source=x&id=3&fbclid=y#top"), "https://www.example.com/a/b?id=3");
assert.strictEqual(Talk.cleanUrl("https://example.com/"), "https://example.com/");
console.log("ok   cleans tracking parameters, fragments and trailing slashes");
for (const [u, rule, off] of [
  ["https://en.wikipedia.org/wiki/Bioluminescence", {}, false],
  ["https://accounts.google.com/signin", {}, true],
  ["https://bank.example/login", {}, true],
  ["http://localhost:3000/", {}, true],
  ["http://192.168.0.10/", {}, true],
  ["file:///Users/me/notes.html", {}, true],
  ["https://news.example/story", { suggest: false }, true],
  ["https://news.example/story", { talk: false }, true],
]) {
  const why = Talk.whyNot(u, rule);
  console.log(`${Boolean(why) === off ? "ok  " : "FAIL"} ${why ? "not looked up" : "looked up    "} ${u} ${JSON.stringify(rule)}`);
  assert.strictEqual(Boolean(why), off);
}

const answers = {
  "hn.algolia.com": { hits: [
    { objectID: "41", title: "How deep-sea animals make light", url: "https://abyssal.example/article?utm_source=hn", points: 312, num_comments: 140, author: "mara", created_at_i: 1760000000 },
    { objectID: "42", title: "Unrelated story that mentions the address", url: "https://other.example/abyssal.example-article", points: 5, num_comments: 1, author: "x", created_at_i: 1760000000 },
  ] },
  "api.bsky.app": { posts: [
    { uri: "at://did:plc:abc/app.bsky.feed.post/3kxyz", author: { handle: "reef.bsky.social", displayName: "Reef Lab" }, record: { text: "Great long read on bioluminescence" }, likeCount: 12, replyCount: 3, indexedAt: "2026-10-01T10:00:00Z" },
  ] },
};
const asked = [];
const getJson = async (url) => (asked.push(url), answers[new URL(url).hostname]);
(async () => {
  const r = await Talk.discussions("https://abyssal.example/article#intro", { getJson });
  console.log("hn:", JSON.stringify(r.hn.map((h) => [h.title, h.url, h.comments])));
  console.log("bluesky:", JSON.stringify(r.bluesky.map((b) => [b.author, b.url])));
  console.log("reddit:", r.reddit);
  assert.strictEqual(r.hn.length, 1, "keeps only stories about this page");
  assert.strictEqual(r.bluesky[0].url, "https://bsky.app/profile/reef.bsky.social/post/3kxyz");
  assert.ok(asked.every((u) => !u.includes("intro")), "fragment not sent");
  const failing = await Talk.discussions("https://abyssal.example/article", { getJson: async (u) => { if (u.includes("bsky")) throw new Error("HTTP 403"); return answers["hn.algolia.com"]; } });
  assert.strictEqual(failing.hn.length, 1);
  assert.strictEqual(failing.errors.bluesky, "Bluesky search is not available right now.");
  const none = [];
  await Talk.discussions("https://bank.example/login", { getJson: async (u) => none.push(u) });
  assert.strictEqual(none.length, 0, "a private page sends nothing");
  console.log("ok   one source failing leaves the other; private pages send nothing");
})();
