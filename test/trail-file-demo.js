// Trail sharing (B82): the Markdown trail file and merging.
const T = require("../core/trail-file");
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(ok ? "ok  " : "FAIL", name, detail);
};
const at = (s) => Date.parse(s);

const sven = {
  id: "trail-1",
  name: "Sourdough starters",
  pins: ["hydration", "rye"],
  tags: ["baking"],
  threads: [
    {
      id: "t1",
      title: "Why do starters fail in winter?",
      status: "open",
      conclusion: "",
      tags: ["temperature"],
      pages: ["https://example.com/starters"],
      by: "Sven",
      at: at("2026-10-27T14:00:00Z"),
      replies: [{ id: "r1", by: "Sven", at: at("2026-10-27T14:02:00Z"), text: "Below 24 °C the culture goes dormant.", replies: [{ id: "r2", by: "Sven", at: at("2026-10-27T14:05:00Z"), text: "Rye flour helps: more enzymes.", replies: [] }] }],
    },
  ],
  pages: [
    { id: "p1", url: "https://example.com/starters?utm_source=x&page=2", title: "Why sourdough starters fail [guide]", firstAt: at("2026-10-27T13:00:00Z"), lastAt: at("2026-10-28T09:00:00Z"), keywords: ["starter", "temperature"], tags: [], notes: [{ id: "n1", by: "Sven", at: at("2026-10-27T13:10:00Z"), text: "Good overview." }] },
    { id: "p2", url: "https://shop.example.com/cart?token=SECRET123&item=4", title: "A shop", firstAt: at("2026-10-27T12:00:00Z"), lastAt: at("2026-10-27T12:00:00Z"), keywords: [], tags: [], notes: [] },
  ],
  reports: [{ id: "rep1", title: "Summary", by: "Sven", at: at("2026-10-27T15:00:00Z"), text: "## Key findings\n\n- Temperature matters [1]." }],
};

// fromSession: sensitive pages out, private address parts out.
const session = { id: "s1", name: "S", pins: [], trail: [...sven.pages.map((p) => ({ ...p })), { url: "https://accounts.google.com/signin", title: "Sign in", keywords: [] }], threadList: sven.threads };
const exported = T.fromSession(session, { by: "Sven" });
check("sign-in pages are never exported", !exported.pages.some((p) => /accounts\.google/.test(p.url)));
check("private tokens are removed from addresses", !JSON.stringify(exported).includes("SECRET123") && exported.pages.some((p) => p.url === "https://shop.example.com/cart?item=4"));
check("tracking parameters are removed, the rest kept", exported.pages[0].url === "https://example.com/starters?page=2", exported.pages[0].url);
const onlyOne = T.fromSession(session, { pages: ["https://example.com/starters?utm_source=x&page=2"] });
check("unticked pages are left out", onlyOne.pages.length === 1);

// Writing and reading back.
const md = T.toMarkdown({ ...sven, pages: exported.pages }, { by: "Sven", at: at("2026-10-28T10:00:00Z") });
check("the file starts with the node-trail front matter", /^---\nnode-trail: 1\n/.test(md) && T.isTrailFile(md));
check("threads, replies and pages read as Markdown", /### Why do starters fail in winter\?/.test(md) && /- \*\*Sven\*\* · 2026-10-27 14:02 UTC: Below 24/.test(md) && /\n  - \*\*Sven\*\*/.test(md) && /\[Why sourdough starters fail \\\[guide\\\]\]\(https:\/\/example\.com\/starters\?page=2\)/.test(md));
const back = T.fromMarkdown(md);
check("name, pins and tags come back", back.name === "Sourdough starters" && back.pins.join() === "hydration,rye" && back.tags.join() === "baking" && back.exportedBy === "Sven");
check("a thread comes back with its status, tags and pages", back.threads[0].id === "t1" && back.threads[0].status === "open" && back.threads[0].tags.join() === "temperature" && back.threads[0].pages[0] === "https://example.com/starters");
check("nested replies come back in place", back.threads[0].replies[0].id === "r1" && back.threads[0].replies[0].replies[0].text === "Rye flour helps: more enzymes." && back.threads[0].replies[0].at === at("2026-10-27T14:02:00Z"));
check("pages come back with title, dates, keywords and notes", back.pages[0].title === "Why sourdough starters fail [guide]" && back.pages[0].keywords.join() === "starter,temperature" && back.pages[0].notes[0].text === "Good overview." && back.pages[0].lastAt === at("2026-10-28T00:00:00Z"));
check("reports come back with their own headings", back.reports[0].id === "rep1" && /### Key findings/.test(back.reports[0].text) && /\[1\]/.test(back.reports[0].text));
check("writing what was read gives the same file", T.toMarkdown(back, { by: "Sven", at: at("2026-10-28T10:00:00Z") }) === md);

// What an AI (or a person) adds by hand: a reply without an id, a page, a section.
const edited = md
  .replace("Rye flour helps: more enzymes. <!-- id:r2 -->", "Rye flour helps: more enzymes. <!-- id:r2 -->\n    - **Claude** · 2026-10-28 11:00 UTC: Also keep it near the oven light.")
  .replace("## Pages\n", "## Pages\n\n- [Hydration guide](https://example.org/hydration)\n")
  .replace("## Reports", "## Questions to ask a baker\n\nWhat flour do you feed it?\n\n## Reports");
const ed = T.fromMarkdown(edited);
const ai = ed.threads[0].replies[0].replies[0].replies[0];
check("a reply added by hand is read, nested under the right reply", ai?.by === "Claude" && /oven light/.test(ai.text) && ai.id.startsWith("h"));
check("a page added by hand is read", ed.pages.some((p) => p.url === "https://example.org/hydration" && p.title === "Hydration guide"));
check("text NODE does not know is kept, not lost", ed.extra.some((x) => /What flour do you feed it/.test(x)));
check("an item without an id gets the same id every time", T.fromMarkdown(edited).threads[0].replies[0].replies[0].replies[0].id === ai.id);
const bare = T.fromMarkdown("---\nnode-trail: 1\nname: Bare\n---\n# Bare\n\n## Threads\n\n### A question\n\n- just a line with no author\n");
check("a reply with no author line says it was added in the file", bare.threads[0].replies[0].by === T.ADDED_IN_FILE);
let threw = "";
try {
  T.fromMarkdown("# Just notes\n");
} catch (e) {
  threw = e.message;
}
check("an ordinary Markdown file is refused with a reason", /not a NODE trail file/.test(threw));
try {
  T.fromMarkdown("---\nnode-trail: 9\n---\n");
} catch (e) {
  threw = e.message;
}
check("a newer format asks to update NODE", /newer NODE/.test(threw));

// Merging: Alex got Sven's trail, replied, resolved the thread, added a page and a tag.
const alex = JSON.parse(JSON.stringify(back));
alex.threads[0].replies[0].replies.push({ id: "r3", by: "Alex", at: at("2026-10-28T12:00:00Z"), text: "Agreed, mine died at 19 °C.", replies: [] });
alex.threads[0].status = "resolved";
alex.threads[0].conclusion = "Keep it above 24 °C.";
alex.threads[0].tags = ["temperature", "settled"];
alex.threads.push({ id: "t2", title: "Best flour?", status: "open", conclusion: "", tags: [], pages: [], by: "Alex", at: at("2026-10-28T12:30:00Z"), replies: [] });
alex.pages.push({ id: "p9", url: "https://alex.example/notes", title: "Alex's notes", firstAt: at("2026-10-28T12:00:00Z"), lastAt: at("2026-10-28T12:00:00Z"), keywords: ["flour"], tags: [], notes: [] });
alex.pages[0].notes.push({ id: "n2", by: "Alex", at: at("2026-10-28T12:10:00Z"), text: "See section 3." });
alex.pins = ["hydration", "rye", "flour"];

const plan = T.mergePlan(back, alex);
check("the plan counts what is new", plan.newPages === 1 && plan.newThreads === 1 && plan.newReplies === 1 && plan.newNotes === 1 && plan.combinedPages === 2, JSON.stringify(plan));
check("the plan asks about the thread's status", plan.questions.some((q) => q.kind === "status" && q.threadId === "t1" && q.ours === "open" && q.theirs === "resolved"));
check("the plan asks about tags and pinned keywords", plan.questions.some((q) => q.kind === "tags") && plan.questions.some((q) => q.kind === "pins"));

const m = T.merge(back, alex);
check("merge adds their reply in its place", m.threads[0].replies[0].replies.map((r) => r.id).join() === "r2,r3");
check("merge keeps our status unless asked", m.threads[0].status === "open");
check("their conclusion is added (ours was empty)", m.threads[0].conclusion === "Keep it above 24 °C.");
check("merge adds their thread, page and note; nothing is removed", m.threads.length === 2 && m.pages.length === 3 && m.pages[0].notes.length === 2 && m.reports.length === 1);
check("tags and pins: both, by default", m.threads[0].tags.join() === "temperature,settled" && m.pins.join() === "hydration,rye,flour");
const m2 = T.merge(back, alex, { status: { t1: "theirs" }, tags: "ours", pins: "ours" });
check("answers: take their status, keep our tags and pins", m2.threads[0].status === "resolved" && m2.threads[0].tags.join() === "temperature" && m2.pins.join() === "hydration,rye");
check("merging the same trail twice changes nothing the second time", JSON.stringify(T.merge(m, alex)) === JSON.stringify(m));
const plan2 = T.mergePlan(m, alex);
check("and the plan says there is nothing new", plan2.newPages + plan2.newThreads + plan2.newReplies + plan2.newNotes + plan2.newReports === 0);
// Same result whichever way round (as sets of ids), with "both" for tags and pins.
const ids = (t) => JSON.stringify({ pages: t.pages.map((p) => p.id).sort(), threads: t.threads.map((x) => x.id).sort(), replies: t.threads.flatMap((x) => (function f(l) { return (l || []).flatMap((r) => [r.id, ...f(r.replies)]); })(x.replies)).sort(), notes: t.pages.flatMap((p) => p.notes.map((n) => n.id)).sort(), pins: [...t.pins].sort() });
check("merging A into B or B into A gives the same items", ids(T.merge(back, alex)) === ids(T.merge(alex, back)));
// A merged trail written out and merged back by the first person.
const roundTrip = T.fromMarkdown(T.toMarkdown(m, { by: "Alex" }));
check("a merged trail survives the file and back", ids(roundTrip) === ids(m));

process.exit(failed ? 1 : 0);
