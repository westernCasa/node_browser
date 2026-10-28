// Threads people write in a trail, and page notes (B82).
//   node test/threads-demo.js
const assert = require("assert");
const { ResearchStore } = require("../core/research");
const T = require("../core/trail-file");

const files = {};
const storage = { read: (n) => (n in files ? files[n] : null), write: (n, t) => (files[n] = t), list: () => Object.keys(files) };
const store = new ResearchStore(storage);
const ok = (name) => console.log("ok  ", name);

store.visit("https://example.com/starters", "Starters", ["starter", "temperature"]);
store.visit("https://example.com/rye", "Rye", ["rye", "temperature"]);

assert.strictEqual(store.addThread({ title: "   " }), null);
const t = store.addThread({ title: "Why do starters fail in winter?", by: "Sven", text: "Mine stopped rising.", tags: ["#temperature", "temperature", ""], pages: ["https://example.com/starters", "https://accounts.google.com/signin"] });
assert.ok(t && t.status === "open" && t.replies.length === 1 && t.replies[0].text === "Mine stopped rising.");
assert.deepStrictEqual(t.tags, ["temperature"]);
assert.deepStrictEqual(t.pages, ["https://example.com/starters"]);
ok("a thread starts with its first message, clean tags and no sign-in pages");

const r1 = store.reply(t.id, { by: "Sven", text: "Below 24 °C it goes dormant." });
const r2 = store.reply(t.id, { parentId: r1.id, by: "Alex", text: "Mine died at 19 °C." });
assert.ok(r2 && store.findReply(t, r2.id) === r2 && t.replies[1].replies[0] === r2);
assert.strictEqual(store.reply(t.id, { parentId: "nope", text: "x" }), null);
assert.strictEqual(store.reply(t.id, { text: "  " }), null);
ok("replies and answers to replies sit in place; empty ones are refused");

store.resolveThread(t.id, "Keep it above 24 °C.");
assert.ok(t.status === "resolved" && t.conclusion === "Keep it above 24 °C.");
store.reopenThread(t.id);
assert.ok(t.status === "open" && t.conclusion === "Keep it above 24 °C.");
ok("resolve with a conclusion; reopen keeps the conclusion");

const sug = store.threadSuggestions().map((k) => k.term);
assert.ok(!sug.includes("temperature"), JSON.stringify(sug));
store.editThread(t.id, { tags: ["winter"] });
assert.ok(store.threadSuggestions().some((k) => k.term === "temperature"));
ok("recurring keywords with no thread are suggested");

const n = store.addNote("https://example.com/starters", { by: "Sven", text: "Good overview." });
assert.ok(n && store.addNote("https://nowhere.example/", { text: "x" }) === null);
ok("notes go on pages in the trail");

store.saveNow();
const again = new ResearchStore(storage);
assert.strictEqual(again.findThread(t.id).replies[1].replies[0].text, "Mine died at 19 °C.");
ok("threads and notes are saved with the session");

const trail = T.fromSession(again.current, { by: "Sven" });
const back = T.fromMarkdown(T.toMarkdown(trail, { by: "Sven" }));
assert.strictEqual(back.threads[0].replies[1].replies[0].by, "Alex");
assert.strictEqual(back.pages.find((p) => p.url === "https://example.com/starters").notes[0].text, "Good overview.");
ok("the trail file carries threads, nested replies and notes");

assert.ok(again.removeThread(t.id) && again.threadList().length === 0);
assert.ok(again.removeNote("https://example.com/starters", n.id));
ok("threads and notes can be removed");
