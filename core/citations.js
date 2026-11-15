// Citations (B91): the details a reference manager needs for a page (authors,
// date, DOI, journal or site), read from the page's own tags when it becomes a
// card, and a trail's page cards exported as CSL-JSON (Zotero, Pandoc) and
// BibTeX (Overleaf, LaTeX).
//
// No Electron or DOM imports. main.js runs citeScript() in the page, passes
// what it returns to fromMeta(), and keeps the result on the card (card.cite).

const { isSensitiveUrl } = require("./urls");
// trail-file.js requires this file, so cleanUrl is loaded when first needed.
const cleanUrl = (u) => require("./trail-file").cleanUrl(u);

// The CSL types NODE uses, and their BibTeX entry types.
const TYPES = {
  "article-journal": "article",
  "article-newspaper": "article",
  "article-magazine": "article",
  "paper-conference": "inproceedings",
  "post-weblog": "online",
  webpage: "online",
  report: "techreport",
  thesis: "phdthesis",
  book: "book",
  motion_picture: "misc",
  song: "misc",
};
const MAX = { text: 300, authors: 30 };

// ---- In the page ----
// Collects the tags that carry citation details: <meta> name/property and
// content pairs (Highwire citation_*, Dublin Core, Open Graph, article:*,
// author) and schema.org JSON-LD blocks. Evaluates to { meta, ld }. Reading
// only; nothing in the page changes.
function citeScript() {
  return `(() => {
    const want = /^(citation_|dc\\.|dcterms\\.|og:|article:|author$|parsely-|sailthru\\.)/i;
    const meta = [];
    for (const m of document.querySelectorAll("meta[content]")) {
      const k = m.getAttribute("name") || m.getAttribute("property") || m.getAttribute("itemprop") || "";
      if (want.test(k) && meta.length < 200) meta.push([k.toLowerCase(), String(m.getAttribute("content")).slice(0, 400)]);
    }
    const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 8).map((s) => (s.textContent || "").slice(0, 20000));
    return { meta, ld };
  })()`;
}

// ---- Reading the tags ----
const clip = (s, n = MAX.text) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const isUrl = (s) => /^https?:\/\//i.test(String(s || "").trim());

// "2024-03-01T10:00:00Z", "2024/03/01", "2024-3", "March 1, 2024", "2024"
// → "2024-03-01", "2024-03", "2024", or "".
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function cleanDate(s) {
  s = clip(s, 60);
  if (!s) return "";
  const pad = (n) => String(n).padStart(2, "0");
  let m = s.match(/^(\d{4})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)];
    if (y < 1000 || y > 2100) return "";
    if (!mo || mo > 12) return String(y);
    if (!d || d > 31) return `${y}-${pad(mo)}`;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
  m = s.match(/^(?:(\d{1,2})\s+)?([A-Za-z]{3})[a-z]*\.?\s+(?:(\d{1,2}),?\s+)?(\d{4})/);
  if (m) {
    const mo = MONTHS.indexOf(m[2].toLowerCase()) + 1;
    const d = Number(m[1] || m[3] || 0);
    if (!mo) return m[4];
    return d && d <= 31 ? `${m[4]}-${pad(mo)}-${pad(d)}` : `${m[4]}-${pad(mo)}`;
  }
  return "";
}

// A DOI on its own ("10.1234/abc"), with "doi:" or as a doi.org address.
function cleanDoi(s) {
  const m = String(s || "").match(/\b(10\.\d{4,9}\/[^\s"<>]+)/);
  return m ? m[1].replace(/[.,;)\]]+$/, "").slice(0, 200) : "";
}

// "Smith, Jane" → { family: "Smith", given: "Jane" }; "Jane Smith" → the
// same; one word, an organization or anything with "and" in it stays whole
// ({ literal }).
function person(s) {
  const name = clip(s, 120).replace(/^by\s+/i, "");
  if (!name || isUrl(name) || name.includes("@")) return null;
  if (name.includes(",")) {
    const [family, ...rest] = name.split(",");
    const given = rest.join(",").trim();
    return given ? { family: family.trim(), given } : { literal: family.trim() };
  }
  const words = name.split(" ");
  if (words.length < 2 || words.length > 4 || /\b(and|inc|ltd|llc|staff|team|editors?|press|university|institute)\b/i.test(name)) return { literal: name };
  return { family: words.pop(), given: words.join(" ") };
}
const personText = (p) => (p.literal ? p.literal : `${p.family}, ${p.given}`);
// "Smith, Jane and Doe, A." in one meta tag.
const splitPeople = (s) => (/;| and /.test(String(s)) ? String(s).split(/\s*;\s*|\s+and\s+/) : [s]);

// The page's schema.org objects, flattened (@graph, lists).
function ldObjects(blocks) {
  const out = [];
  const walk = (o, depth = 0) => {
    if (!o || typeof o !== "object" || depth > 4 || out.length > 40) return;
    if (Array.isArray(o)) return o.forEach((x) => walk(x, depth + 1));
    if (o["@type"]) out.push(o);
    if (o["@graph"]) walk(o["@graph"], depth + 1);
  };
  for (const b of blocks || []) {
    try {
      walk(JSON.parse(b));
    } catch (_) {
      // A broken block is skipped.
    }
  }
  return out;
}
const typesOf = (o) => [].concat(o["@type"] || []).map((t) => String(t).toLowerCase());
const nameOf = (v) => (typeof v === "string" ? v : v && typeof v === "object" ? v.name || "" : "");

const LD_TYPE = [
  [/^(scholarlyarticle|medicalscholarlyarticle)$/, "article-journal"],
  [/^(newsarticle|reportagenewsarticle|analysisnewsarticle|opinionnewsarticle)$/, "article-newspaper"],
  [/^(blogposting|socialmediaposting|discussionforumposting)$/, "post-weblog"],
  [/^(report)$/, "report"],
  [/^(thesis)$/, "thesis"],
  [/^(book)$/, "book"],
  [/^(videoobject|movie|episode|tvepisode)$/, "motion_picture"],
  [/^(podcastepisode|audioobject|musicrecording)$/, "song"],
  [/^(article|techarticle|webpage|creativework)$/, "webpage"],
];

// What the page says about itself, as a cite: { type, title, authors, date,
// container, publisher, doi, volume, issue, pages }. Fields with nothing are
// left out. url: the page's address (a doi.org address gives the DOI).
function fromMeta(raw = {}, { url = "", title = "" } = {}) {
  const tags = new Map();
  for (const [k, v] of raw.meta || []) {
    const key = String(k).toLowerCase();
    if (!tags.has(key)) tags.set(key, []);
    if (clip(v)) tags.get(key).push(clip(v, 400));
  }
  const one = (...keys) => {
    for (const k of keys) if (tags.get(k)?.[0]) return tags.get(k)[0];
    return "";
  };
  const all = (...keys) => keys.flatMap((k) => tags.get(k) || []);
  const ld = ldObjects(raw.ld).filter((o) => !typesOf(o).some((t) => /^(organization|person|website|breadcrumblist|imageobject|searchaction|listitem)$/.test(t)));
  const main = ld.find((o) => typesOf(o).some((t) => LD_TYPE.slice(0, -1).some(([re]) => re.test(t)))) || ld.find((o) => typesOf(o).some((t) => /article|webpage|creativework/.test(t))) || null;

  const cite = {};
  // Type: Highwire tags first (they are written for citing), then schema.org,
  // then Open Graph.
  if (one("citation_journal_title")) cite.type = "article-journal";
  else if (one("citation_conference_title")) cite.type = "paper-conference";
  else if (one("citation_technical_report_institution", "citation_technical_report_number")) cite.type = "report";
  else if (one("citation_dissertation_institution")) cite.type = "thesis";
  else if (one("citation_isbn") && !one("citation_journal_title")) cite.type = "book";
  else if (main) {
    const t = typesOf(main);
    cite.type = (LD_TYPE.find(([re]) => t.some((x) => re.test(x))) || [, "webpage"])[1];
  } else if (/^video/.test(one("og:type"))) cite.type = "motion_picture";
  else if (/^(music|audio)/.test(one("og:type"))) cite.type = "song";
  else if (one("og:type") === "article" || one("article:published_time")) cite.type = "post-weblog";
  else cite.type = "webpage";

  const t = one("citation_title", "dc.title", "dcterms.title") || clip(main?.headline || main?.name) || one("og:title") || title;
  if (clip(t)) cite.title = clip(t);

  let people = all("citation_author");
  if (!people.length) people = all("dc.creator", "dcterms.creator");
  if (!people.length && main?.author) people = [].concat(main.author).map(nameOf);
  if (!people.length) people = all("author", "article:author", "parsely-author", "sailthru.author").filter((a) => !isUrl(a));
  const authors = [];
  const seen = new Set();
  for (const p of people.flatMap(splitPeople)) {
    const a = person(p);
    const key = a && personText(a).toLowerCase();
    if (a && !seen.has(key) && authors.length < MAX.authors) seen.add(key) && authors.push(a);
  }
  if (authors.length) cite.authors = authors;

  const date = cleanDate(one("citation_publication_date", "citation_date", "citation_online_date", "dc.date", "dcterms.issued", "dcterms.date") || main?.datePublished || one("article:published_time", "parsely-pub-date") || main?.dateCreated || "");
  if (date) cite.date = date;

  const container =
    one("citation_journal_title", "citation_conference_title", "citation_inbook_title") ||
    clip(nameOf(main?.isPartOf)) ||
    (cite.type !== "article-journal" ? one("og:site_name") || clip(nameOf(main?.publisher)) : "");
  if (container) cite.container = clip(container);
  const publisher = one("citation_publisher", "dc.publisher", "dcterms.publisher", "citation_technical_report_institution", "citation_dissertation_institution") || clip(nameOf(main?.publisher));
  if (publisher && publisher !== cite.container) cite.publisher = clip(publisher);

  const doi = cleanDoi(one("citation_doi")) || cleanDoi(all("dc.identifier", "dcterms.identifier").find((x) => /10\.\d{4,9}\//.test(x)) || "") || cleanDoi(/doi\.org\//i.test(url) ? url : "") || cleanDoi(typeof main?.identifier === "string" && /10\.\d/.test(main.identifier) ? main.identifier : "");
  if (doi) cite.doi = doi;
  const volume = one("citation_volume");
  const issue = one("citation_issue");
  const first = one("citation_firstpage");
  const last = one("citation_lastpage");
  if (/^[\w.-]{1,20}$/.test(volume)) cite.volume = volume;
  if (/^[\w.-]{1,20}$/.test(issue)) cite.issue = issue;
  if (/^[\w.-]{1,20}$/.test(first)) cite.pages = /^[\w.-]{1,20}$/.test(last) && last !== first ? `${first}-${last}` : first;
  return clean(cite);
}

// Keeps only known fields of the right shape (for cites from a file or IPC).
function clean(c) {
  if (!c || typeof c !== "object") return null;
  const out = {};
  out.type = TYPES[c.type] ? c.type : "webpage";
  if (clip(c.title)) out.title = clip(c.title);
  const authors = (Array.isArray(c.authors) ? c.authors : [])
    .map((a) => (a && typeof a === "object" ? (clip(a.literal) ? { literal: clip(a.literal, 120) } : clip(a.family) ? { family: clip(a.family, 80), given: clip(a.given, 80) } : null) : null))
    .filter(Boolean)
    .slice(0, MAX.authors);
  if (authors.length) out.authors = authors;
  for (const k of ["container", "publisher"]) if (clip(c[k])) out[k] = clip(c[k]);
  const date = cleanDate(c.date);
  if (date) out.date = date;
  const doi = cleanDoi(c.doi);
  if (doi) out.doi = doi;
  for (const k of ["volume", "issue", "pages"]) if (/^[\w.-]{1,41}$/.test(String(c[k] ?? ""))) out[k] = String(c[k]);
  return out;
}

// ---- In the trail file (doc 26) ----
// One line on a page card:
//   Cite: article-journal · by Smith, Jane; Doe, A. · 2024-03-01 · in Journal of Bread · volume 12 · issue 3 · pages 45-67 · published by Bread Society · DOI 10.1234/abc
// The title is the card's own. Parts in any order; unknown parts are ignored.
const PARTS = [
  ["authors", "by ", (c) => c.authors?.map(personText).join("; ")],
  ["date", "", (c) => c.date],
  ["container", "in ", (c) => c.container],
  ["volume", "volume ", (c) => c.volume],
  ["issue", "issue ", (c) => c.issue],
  ["pages", "pages ", (c) => c.pages],
  ["publisher", "published by ", (c) => c.publisher],
  ["doi", "DOI ", (c) => c.doi],
];
const safe = (s) => String(s).replace(/ · /g, " - ").replace(/\n/g, " ");
function citeLine(cite) {
  const c = clean(cite);
  if (!c) return "";
  const parts = [c.type, ...PARTS.map(([, pre, get]) => (get(c) ? `${pre}${safe(get(c))}` : "")).filter(Boolean)];
  return `Cite: ${parts.join(" · ")}`;
}
function parseCiteLine(line) {
  const m = String(line || "").match(/^Cite: (.+)$/);
  if (!m) return null;
  const c = {};
  for (const part of m[1].split(" · ")) {
    if (TYPES[part]) c.type = part;
    else if (/^by /.test(part)) c.authors = part.slice(3).split("; ").map((p) => (p.includes(", ") ? { family: p.split(", ")[0], given: p.split(", ").slice(1).join(", ") } : { literal: p }));
    else if (/^\d{4}(-\d\d){0,2}$/.test(part)) c.date = part;
    else if (/^in /.test(part)) c.container = part.slice(3);
    else if (/^volume /.test(part)) c.volume = part.slice(7);
    else if (/^issue /.test(part)) c.issue = part.slice(6);
    else if (/^pages /.test(part)) c.pages = part.slice(6);
    else if (/^published by /.test(part)) c.publisher = part.slice(13);
    else if (/^DOI /.test(part)) c.doi = part.slice(4);
  }
  return clean(c);
}

// ---- Export ----
// The entries for a trail snapshot (TrailStore.snapshot): one per page card,
// in the order they were placed, plus the pages of media moments that have no
// page card. Sign-in, account and payment pages are never included (B66), and
// private and tracking parts of addresses are removed. Each entry: { url,
// title, accessed (ms), cite, notes: [text] }.
function entries(snap) {
  if (!snap) return [];
  const cards = (snap.cards || []).filter((c) => !c.removed);
  const firstSeen = new Map();
  for (const s of snap.timeline || []) for (const it of s.items || []) if (it.url && it.type === "opened" && !(firstSeen.get(it.url) <= it.at)) firstSeen.set(it.url, it.at);
  const out = new Map();
  const ordered = [...cards].sort((a, b) => (a.placedAt || 0) - (b.placedAt || 0));
  const add = (c, title) => {
    const url = cleanUrl(c.url);
    if (!url || isSensitiveUrl(c.url)) return null;
    if (!out.has(url)) out.set(url, { url, title: clip(c.cite?.title || title || c.title || url), accessed: firstSeen.get(c.url) || c.placedAt || 0, cite: clean(c.cite) || { type: "webpage" }, notes: [] });
    return out.get(url);
  };
  for (const c of ordered) if (c.kind === "page" && c.url) add(c);
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  for (const c of ordered) {
    if (c.kind !== "moment" || !c.url) continue;
    const e = add({ ...c, cite: cards.find((p) => p.kind === "page" && p.url === c.url)?.cite }, c.title);
    if (e) e.notes.push(`Moment ${mmss(c.a)}–${mmss(c.b)}`);
  }
  return [...out.values()];
}

const dateParts = (d) => [d.split("-").map(Number)];
const dayOf = (ms) => {
  const d = new Date(ms);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
};

// CSL-JSON: an array of items, as Zotero, Pandoc and Mendeley read it.
function toCslJson(list, { trailName = "" } = {}) {
  const items = list.map((e, i) => {
    const c = e.cite || {};
    const it = { id: `node-${i + 1}`, type: c.type || "webpage", title: e.title, URL: e.url };
    if (c.authors) it.author = c.authors.map((a) => (a.literal ? { literal: a.literal } : { family: a.family, given: a.given }));
    if (c.date) it.issued = { "date-parts": dateParts(c.date) };
    if (e.accessed) it.accessed = { "date-parts": [dayOf(e.accessed)] };
    if (c.container) it["container-title"] = c.container;
    if (c.publisher) it.publisher = c.publisher;
    if (c.doi) it.DOI = c.doi;
    if (c.volume) it.volume = c.volume;
    if (c.issue) it.issue = c.issue;
    if (c.pages) it.page = c.pages;
    const note = [...e.notes, trailName ? `From the NODE trail “${trailName}”` : ""].filter(Boolean).join(". ");
    if (note) it.note = note;
    return it;
  });
  return JSON.stringify(items, null, 2) + "\n";
}

// BibTeX: one entry per page, with keys like smith2024bread (made unique).
// Special characters are escaped; braces keep the title's capitals.
const TEX = { "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", "%": "\\%", $: "\\$", "&": "\\&", "#": "\\#", _: "\\_", "^": "\\^{}", "~": "\\~{}" };
const tex = (s) => String(s).replace(/[\\{}%$&#_^~]/g, (ch) => TEX[ch]);
const ascii = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const SKIP = new Set(["the", "a", "an", "on", "of", "in", "and", "for", "to", "how", "why", "what"]);
function toBibtex(list, { trailName = "" } = {}) {
  const used = new Map();
  const blocks = list.map((e) => {
    const c = e.cite || {};
    const who = c.authors?.[0] ? ascii(c.authors[0].family || c.authors[0].literal).slice(0, 20) : ascii(hostOf(e.url)).slice(0, 20) || "page";
    const year = c.date ? c.date.slice(0, 4) : e.accessed ? String(new Date(e.accessed).getFullYear()) : "";
    const word = ascii((String(e.title).split(/\s+/).find((w) => ascii(w).length > 2 && !SKIP.has(ascii(w))) || "")).slice(0, 15);
    let key = `${who}${year}${word}` || "page";
    const n = used.get(key) || 0;
    used.set(key, n + 1);
    if (n) key += String.fromCharCode(97 + ((n - 1) % 26)); // smith2024bread, smith2024breada…
    const f = [];
    const put = (k, v) => v && f.push(`  ${k} = {${v}}`);
    put("title", `{${tex(e.title)}}`);
    if (c.authors) put("author", c.authors.map((a) => (a.literal ? `{${tex(a.literal)}}` : `${tex(a.family)}, ${tex(a.given)}`)).join(" and "));
    if (c.date) {
      put("date", c.date);
      put("year", c.date.slice(0, 4));
    }
    const type = TYPES[c.type] || "online";
    if (c.container) put(type === "article" ? "journal" : type === "inproceedings" ? "booktitle" : "howpublished", tex(c.container));
    if (c.publisher) put(type === "techreport" ? "institution" : type === "phdthesis" ? "school" : "publisher", tex(c.publisher));
    put("volume", c.volume && tex(c.volume));
    put("number", c.issue && tex(c.issue));
    put("pages", c.pages && c.pages.replace("-", "--"));
    put("doi", c.doi && tex(c.doi));
    put("url", e.url.replace(/[%#{}\\]/g, (ch) => `\\${ch}`));
    if (e.accessed) put("urldate", dayOf(e.accessed).map((x, i) => (i ? String(x).padStart(2, "0") : x)).join("-"));
    const note = [...e.notes, trailName ? "From the NODE trail ``" + trailName + "''" : ""].filter(Boolean).join(". ");
    put("note", note && tex(note));
    return `@${type}{${key},\n${f.join(",\n")}\n}`;
  });
  return blocks.length ? blocks.join("\n\n") + "\n" : "";
}
function hostOf(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return /^[\d.]+$|^\[/.test(host) ? "" : host.split(".")[0]; // no key from an IP address
  } catch (_) {
    return "";
  }
}

module.exports = { citeScript, fromMeta, clean, cleanDate, cleanDoi, person, citeLine, parseCiteLine, entries, toCslJson, toBibtex, TYPES };
