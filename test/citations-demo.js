// Citations (B91): reading a page's citation tags, the Cite line in trail
// files, and exporting a trail's page cards as CSL-JSON and BibTeX.
// Run: npm run test:cite
const assert = require("assert");
const C = require("../core/citations");
const { TrailStore } = require("../core/trail");
const { memoryStorage } = require("../core/storage");
const { toTrailMd, parseTrailMd } = require("../core/trail-file");

let n = 0;
const ok = (name) => console.log(`ok ${++n} - ${name}`);

// ---- reading the tags ----
const journal = {
  meta: [
    ["citation_title", "Lactic acid bacteria in rye sourdough"],
    ["citation_author", "Smith, Jane"],
    ["citation_author", "Ana María Pérez"],
    ["citation_publication_date", "2024/03/01"],
    ["citation_journal_title", "Journal of Cereal Science"],
    ["citation_volume", "12"],
    ["citation_issue", "3"],
    ["citation_firstpage", "45"],
    ["citation_lastpage", "67"],
    ["citation_doi", "doi:10.1016/j.jcs.2024.01.002"],
    ["citation_publisher", "Elsevier"],
    ["og:site_name", "ScienceDirect"],
  ],
  ld: [],
};
{
  const c = C.fromMeta(journal, { url: "https://example.org/paper" });
  assert.deepStrictEqual(c, {
    type: "article-journal",
    title: "Lactic acid bacteria in rye sourdough",
    authors: [{ family: "Smith", given: "Jane" }, { family: "Pérez", given: "Ana María" }],
    container: "Journal of Cereal Science",
    publisher: "Elsevier",
    date: "2024-03-01",
    doi: "10.1016/j.jcs.2024.01.002",
    volume: "12",
    issue: "3",
    pages: "45-67",
  });
  ok("Highwire citation_* tags (Google Scholar's) give a full journal article");
}
{
  const news = {
    meta: [["og:site_name", "The Bread Times"], ["og:title", "Why rye is back"]],
    ld: [JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "WebSite", name: "The Bread Times" }, { "@type": "NewsArticle", headline: "Why rye is back", author: [{ "@type": "Person", name: "Kim Lee" }, { "@type": "Person", name: "The Bread Times Staff" }], datePublished: "2025-11-02T08:00:00-05:00", publisher: { "@type": "Organization", name: "Bread Times Media" } }] }), "{ broken"],
  };
  const c = C.fromMeta(news);
  assert.strictEqual(c.type, "article-newspaper");
  assert.deepStrictEqual(c.authors, [{ family: "Lee", given: "Kim" }, { literal: "The Bread Times Staff" }]);
  assert.strictEqual(c.date, "2025-11-02");
  assert.strictEqual(c.container, "The Bread Times");
  assert.strictEqual(c.publisher, "Bread Times Media");
  ok("schema.org JSON-LD (in @graph) gives type, authors, date, site and publisher; a broken block is skipped");
}
{
  const blog = { meta: [["og:type", "article"], ["article:published_time", "2026-10-01"], ["article:author", "https://example.com/u/kim"], ["author", "Kim Lee"], ["og:site_name", "Kim bakes"]] };
  const c = C.fromMeta(blog, { title: "Feeding a starter" });
  assert.deepStrictEqual(c, { type: "post-weblog", title: "Feeding a starter", authors: [{ family: "Lee", given: "Kim" }], container: "Kim bakes", date: "2026-10-01" });
  const video = C.fromMeta({ meta: [["og:type", "video.other"], ["og:site_name", "YouTube"]] }, { title: "Shaping a rye boule" });
  assert.strictEqual(video.type, "motion_picture");
  const bare = C.fromMeta({}, { title: "Some page", url: "https://doi.org/10.1234/ABC.5" });
  assert.deepStrictEqual(bare, { type: "webpage", title: "Some page", doi: "10.1234/ABC.5" });
  assert.deepStrictEqual(C.fromMeta(null || {}), { type: "webpage" });
  ok("Open Graph and plain pages: a blog post, a video, a doi.org address; author links are not names");
}
{
  assert.strictEqual(C.cleanDate("March 5, 2024"), "2024-03-05");
  assert.strictEqual(C.cleanDate("5 Mar 2024"), "2024-03-05");
  assert.strictEqual(C.cleanDate("2024-3"), "2024-03");
  assert.strictEqual(C.cleanDate("1999"), "1999");
  assert.strictEqual(C.cleanDate("yesterday"), "");
  assert.deepStrictEqual(C.person("by Jane Q. Smith"), { family: "Smith", given: "Jane Q." });
  assert.deepStrictEqual(C.person("Cereal Research Institute"), { literal: "Cereal Research Institute" });
  assert.strictEqual(C.person("jane@example.org"), null);
  assert.strictEqual(C.cleanDoi("https://doi.org/10.5555/xyz)."), "10.5555/xyz");
  const two = C.fromMeta({ meta: [["dc.creator", "Smith, Jane; Doe, Al"], ["dc.date", "2020"], ["dc.identifier", "doi:10.1/2"]] });
  assert.deepStrictEqual(two.authors, [{ family: "Smith", given: "Jane" }, { family: "Doe", given: "Al" }]);
  assert.strictEqual(two.doi, undefined, "10.1/2 is not a DOI (prefix too short)");
  ok("dates, names and DOIs in the forms pages use; Dublin Core with two people in one tag");
}

// ---- the trail file ----
{
  const cite = C.fromMeta(journal);
  const line = C.citeLine(cite);
  assert.strictEqual(line, "Cite: article-journal · by Smith, Jane; Pérez, Ana María · 2024-03-01 · in Journal of Cereal Science · volume 12 · issue 3 · pages 45-67 · published by Elsevier · DOI 10.1016/j.jcs.2024.01.002");
  const back = C.parseCiteLine(line);
  delete cite.title; // the title is the card's own
  assert.deepStrictEqual(back, cite);
  assert.deepStrictEqual(C.parseCiteLine("Cite: webpage · in Kim · bakes · something new"), { type: "webpage", container: "Kim" }, "unknown parts are ignored");
  ok("the Cite line round-trips; unknown parts are ignored");
}

// ---- a trail ----
let clock = new Date(2026, 10, 15, 9, 0).getTime();
const store = new TrailStore(memoryStorage(), { now: () => clock });
const id = store.current().trail.id;
store.rename(id, "Rye & acids");
const visit = (url, title) => {
  store.visit(id, url, { title });
  clock += 30000;
  store.placePage(id, url, { title, x: 0, y: 0 });
  clock += 60000;
};
visit("https://example.org/paper?utm_source=x", "Lactic acid bacteria – ScienceDirect");
store.setCite(id, "https://example.org/paper?utm_source=x", C.fromMeta(journal));
visit("https://example.com/blog/feeding", "Feeding a starter");
store.setCite(id, "https://example.com/blog/feeding", { type: "post-weblog", authors: [{ family: "Lee", given: "Kim" }], date: "2026-10-01", container: "Kim bakes" });
visit("https://example.com/blog/feeding-2", "Feeding a starter, part 2");
store.setCite(id, "https://example.com/blog/feeding-2", { type: "post-weblog", authors: [{ family: "Lee", given: "Kim" }], date: "2026-10-01" });
visit("https://www.youtube.com/watch?v=abc", "Shaping a rye boule");
store.momentCard(id, { url: "https://www.youtube.com/watch?v=abc", title: "Shaping a rye boule", a: 72, b: 95 });
store.momentCard(id, { url: "https://www.youtube.com/watch?v=zzz", title: "Scoring", a: 10, b: 20 });
store.visit(id, "https://accounts.google.com/signin", { title: "Sign in" });
store.placePage(id, "https://accounts.google.com/signin", { title: "Sign in" });
store.visit(id, "https://example.net/quick", { title: "Quick look" });
store.bounce(id, "https://example.net/quick", 4000);
{
  assert.strictEqual(store.setCite(id, "https://example.net/quick", { type: "webpage" }), null, "a timeline-only page has no card to keep it");
  const s = store.snapshot(id);
  const md = toTrailMd(s);
  assert.ok(md.includes("Cite: article-journal · by Smith, Jane; Pérez, Ana María · 2024-03-01"), md.slice(0, 600));
  const back = parseTrailMd(md);
  const paper = back.cards.find((c) => /example\.org\/paper/.test(c.url || ""));
  assert.strictEqual(paper.cite.doi, "10.1016/j.jcs.2024.01.002");
  assert.ok(!paper.excerpt?.includes("Cite:"), "the line is not taken as an excerpt");
  ok("page cards keep their cite, and it goes into the trail file and back");
}
const list = C.entries(store.snapshot(id));
{
  assert.deepStrictEqual(list.map((e) => e.url), ["https://example.org/paper", "https://example.com/blog/feeding", "https://example.com/blog/feeding-2", "https://www.youtube.com/watch?v=abc", "https://www.youtube.com/watch?v=zzz"]);
  assert.ok(list.every((e) => !/accounts\.google|quick/.test(e.url)), "no sign-in page, no timeline-only visit");
  assert.deepStrictEqual(list[3].notes, ["Moment 1:12–1:35"]);
  assert.deepStrictEqual(list[4].cite, { type: "webpage" });
  assert.ok(list[0].accessed > 0);
  ok("entries: page cards in order, then moments' pages; tracking codes, sign-in pages and quick visits left out");
}
{
  const items = JSON.parse(C.toCslJson(list, { trailName: "Rye & acids" }));
  assert.strictEqual(items.length, 5);
  const a = items[0];
  assert.deepStrictEqual(
    { type: a.type, title: a.title, author: a.author, issued: a.issued, ct: a["container-title"], DOI: a.DOI, page: a.page, URL: a.URL },
    { type: "article-journal", title: "Lactic acid bacteria in rye sourdough", author: [{ family: "Smith", given: "Jane" }, { family: "Pérez", given: "Ana María" }], issued: { "date-parts": [[2024, 3, 1]] }, ct: "Journal of Cereal Science", DOI: "10.1016/j.jcs.2024.01.002", page: "45-67", URL: "https://example.org/paper" },
  );
  assert.deepStrictEqual(a.accessed, { "date-parts": [[2026, 11, 15]] });
  assert.strictEqual(a.note, "From the NODE trail “Rye & acids”");
  assert.strictEqual(items[3].note, "Moment 1:12–1:35. From the NODE trail “Rye & acids”");
  assert.ok(items.every((x) => x.id && x.type && x.title && x.URL));
  ok("CSL-JSON: one item per entry, in the shape Zotero reads");
}
{
  const bib = C.toBibtex(list, { trailName: "Rye & acids" });
  assert.ok(bib.startsWith("@article{smith2024lactic,\n  title = {{Lactic acid bacteria in rye sourdough}},\n  author = {Smith, Jane and Pérez, Ana María},"), bib.slice(0, 200));
  assert.ok(bib.includes("  journal = {Journal of Cereal Science}") && bib.includes("  pages = {45--67}") && bib.includes("  doi = {10.1016/j.jcs.2024.01.002}") && bib.includes("  urldate = {2026-11-15}"));
  assert.ok(bib.includes("@online{lee2026feeding,") && bib.includes("@online{lee2026feedinga,"), "keys are unique");
  assert.ok(bib.includes("@misc{youtube2026shaping,") || bib.includes("@online{youtube2026shaping,"), bib);
  assert.ok(bib.includes("note = {From the NODE trail ``Rye \\& acids''}"), "special characters escaped");
  const braces = (bib.match(/\{/g) || []).length === (bib.match(/\}/g) || []).length - (bib.match(/\\\}/g) || []).length + (bib.match(/\\\{/g) || []).length;
  assert.ok(braces, "braces balance");
  assert.strictEqual(C.toBibtex([]), "");
  ok("BibTeX: entry types, unique keys, escaped text, balanced braces");
}
console.log(`\n${n} checks passed`);
