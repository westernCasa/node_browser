// Trail sharing (B82, docs/19-trail-sharing.md): a trail as one Markdown file
// that people and AI can read and edit ("<name>.trail.md"), reading it back,
// and merging an incoming trail into one of your own, the way Git merges.
//
// Pure JavaScript with no dependencies, so it also runs in the phone app.
//
// The trail object used here:
//   { id, name, about, pins: [], tags: [],
//     threads: [{ id, title, status: "open"|"resolved", conclusion, tags: [], pages: [url], by, at, replies: [Reply] }],
//     pages:   [{ id, url, title, firstAt, lastAt, keywords: [], tags: [], notes: [{ id, by, at, text }] }],
//     reports: [{ id, title, by, at, text }],
//     extra:   [text]  (text in a file that NODE did not recognize; kept, never lost) }
//   Reply: { id, by, at, text, replies: [Reply] }

const { isSensitiveUrl } = require("./urls");

const FORMAT = 1;
const ADDED_IN_FILE = "Added in the file";

// ---- Ids ----
function randomId() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}
// A stable id for an item that came without one (written into the file by a
// person or an AI), so merging the same file twice adds it only once.
function hashId(...parts) {
  let h = 0x811c9dc5;
  const s = parts.join("\u0001");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return "h" + h.toString(36);
}

// ---- Addresses ----
// Query parameters that carry private tokens or tracking are removed before a
// trail leaves the computer, and before pages are matched in a merge.
const PRIVATE_PARAM = /^(token|access_token|id_token|refresh_token|auth|authorization|key|api_?key|secret|password|pass|pwd|session|sessionid|sid|code|otp|sig|signature|ticket|jwt)$/i;
const TRACKING_PARAM = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_eid|mc_cid|igshid|yclid|_hsenc|_hsmi|ref_src)$/i;
function cleanUrl(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    for (const k of [...u.searchParams.keys()]) if (PRIVATE_PARAM.test(k) || TRACKING_PARAM.test(k)) u.searchParams.delete(k);
    u.hash = /^#?(access_token|id_token|token)=/i.test(u.hash) ? "" : u.hash;
    u.username = "";
    u.password = "";
    return u.toString();
  } catch {
    return null;
  }
}
const pageKey = (url) => {
  const c = cleanUrl(url);
  return c ? c.replace(/\/$/, "").replace(/^http:/, "https:").replace(/\/\/www\./, "//") : null;
};

// ---- From a saved research session ----
// opts.pages: the urls to include (the sender's ticks); default all.
function fromSession(session, { by = "", pages = null, reports = [], includeTabs = [] } = {}) {
  const keep = pages ? new Set(pages) : null;
  const pageRows = (session.trail || [])
    .filter((r) => !isSensitiveUrl(r.url) && (!keep || keep.has(r.url)))
    .map((r) => ({ id: r.id || hashId("page", pageKey(r.url) || r.url), url: cleanUrl(r.url), title: r.title || r.url, firstAt: r.firstAt || 0, lastAt: r.lastAt || 0, keywords: r.keywords || [], tags: r.tags || [], notes: (r.notes || []).map((n) => ({ ...n })) }))
    .filter((r) => r.url);
  // A page left out of the export is left out of threads' page links too.
  const threadPage = (u) => !isSensitiveUrl(u) && (!keep || keep.has(u));
  const threads = (session.threadList || []).map((t) => ({ ...t, pages: (t.pages || []).filter(threadPage).map(cleanUrl).filter(Boolean), replies: cloneReplies(t.replies) }));
  return {
    id: session.id,
    name: session.name,
    about: session.about || "",
    pins: [...(session.pins || [])],
    tags: [...(session.tags || [])],
    threads,
    pages: pageRows,
    reports: reports.map((r) => ({ id: r.id || hashId("report", r.title, r.at), title: r.title, by: r.by || by, at: r.at || 0, text: String(r.text || "") })),
    tabs: includeTabs.map(cleanUrl).filter((u) => u && !isSensitiveUrl(u)),
    extra: [],
  };
}
const cloneReplies = (list) => (list || []).map((r) => ({ ...r, replies: cloneReplies(r.replies) }));

// ---- Writing ----
const day = (ms) => (ms && Number.isFinite(new Date(ms).getTime()) ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "");
const idTag = (id) => (id ? ` <!-- id:${id} -->` : "");
const esc = (t) => String(t || "").replace(/\r?\n+/g, " ").trim();
const linkText = (t) => esc(t).replace(/([\[\]])/g, "\\$1");
const yamlStr = (v) => (/^[\w .@:+\-/]*$/.test(v) && !/^\s|\s$/.test(v) && v !== "" ? v : JSON.stringify(v));
const yamlList = (a) => `[${(a || []).map((v) => yamlStr(String(v))).join(", ")}]`;

function toMarkdown(trail, { by = "", at = Date.now() } = {}) {
  const L = [];
  L.push("---", `node-trail: ${FORMAT}`, `id: ${yamlStr(trail.id || randomId())}`, `name: ${yamlStr(esc(trail.name) || "Trail")}`);
  if (by) L.push(`exported-by: ${yamlStr(esc(by))}`);
  L.push(`exported-at: ${new Date(at).toISOString()}`);
  if (trail.pins?.length) L.push(`pins: ${yamlList(trail.pins)}`);
  if (trail.tags?.length) L.push(`tags: ${yamlList(trail.tags)}`);
  if (trail.tabs?.length) L.push(`open-tabs: ${yamlList(trail.tabs)}`);
  L.push("---", `# ${esc(trail.name) || "Trail"}`, "");
  if (trail.about) L.push(esc(trail.about), "");
  L.push("This is a NODE trail. Open it in NODE (Menu → Trail → Open Shared Trail) to read it there or merge it into one of your trails. You can also add replies or pages here by hand, in the same form.", "");

  L.push("## Threads", "");
  if (!trail.threads?.length) L.push("No threads yet.", "");
  for (const t of trail.threads || []) {
    L.push(`### ${esc(t.title)}${idTag(t.id)}`);
    L.push(`Status: ${t.status === "resolved" ? "resolved" : "open"}${t.tags?.length ? ` · Tags: ${t.tags.map(esc).join(", ")}` : ""}${t.by ? ` · Started by: ${esc(t.by)}` : ""}${t.at ? ` · ${day(t.at)}` : ""}`);
    if (t.conclusion) L.push(`Conclusion: ${esc(t.conclusion)}`);
    if (t.pages?.length) L.push(`Pages: ${t.pages.map((u) => `<${u}>`).join(", ")}`);
    L.push("");
    const walk = (list, depth) => {
      for (const r of list || []) {
        L.push(`${"  ".repeat(depth)}- **${esc(r.by) || "Someone"}** · ${day(r.at)}: ${esc(r.text)}${idTag(r.id)}`);
        walk(r.replies, depth + 1);
      }
    };
    walk(t.replies, 0);
    if (t.replies?.length) L.push("");
  }

  L.push("## Pages", "");
  if (!trail.pages?.length) L.push("No pages.", "");
  for (const p of trail.pages || []) {
    L.push(`- [${linkText(p.title || p.url)}](${p.url})${idTag(p.id)}`);
    const read = p.firstAt ? `Read: ${day(p.firstAt).slice(0, 10)}${p.lastAt && day(p.lastAt).slice(0, 10) !== day(p.firstAt).slice(0, 10) ? ` to ${day(p.lastAt).slice(0, 10)}` : ""}` : "";
    const facts = [read, p.keywords?.length ? `Keywords: ${p.keywords.map(esc).join(", ")}` : "", p.tags?.length ? `Tags: ${p.tags.map(esc).join(", ")}` : ""].filter(Boolean);
    if (facts.length) L.push(`  - ${facts.join(" · ")}`);
    for (const n of p.notes || []) L.push(`  - Note: **${esc(n.by) || "Someone"}** · ${day(n.at)}: ${esc(n.text)}${idTag(n.id)}`);
  }
  L.push("");

  if (trail.reports?.length) {
    L.push("## Reports", "");
    for (const r of trail.reports) {
      L.push(`### ${esc(r.title) || "Report"}${idTag(r.id)}`);
      if (r.by || r.at) L.push(`By **${esc(r.by) || "Someone"}** · ${day(r.at)}`);
      L.push("");
      // Report text keeps its own Markdown, with its headings moved below ###.
      L.push(String(r.text || "").trim().replace(/^(#{1,3}) /gm, "#### "), "");
    }
  }
  for (const x of trail.extra || []) L.push(x, "");
  return L.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ---- Reading ----
function parseYaml(lines) {
  const out = {};
  for (const line of lines) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (/^\[.*\]$/.test(v)) {
      v = v
        .slice(1, -1)
        .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => (/^".*"$/.test(x) ? JSON.parse(x) : x));
    } else if (/^".*"$/.test(v)) {
      try {
        v = JSON.parse(v);
      } catch {}
    }
    out[m[1]] = v;
  }
  return out;
}
const takeId = (s) => {
  const m = String(s).match(/<!--\s*id:([\w-]+)\s*-->\s*$/);
  return { id: m ? m[1] : "", text: m ? s.slice(0, m.index).trimEnd() : String(s).trimEnd() };
};
const parseDay = (s) => {
  const t = Date.parse(String(s || "").replace(" UTC", "Z").replace(" ", "T"));
  return Number.isNaN(t) ? 0 : t;
};
const splitList = (s) =>
  String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const unescLink = (t) => String(t).replace(/\\([\[\]])/g, "$1");

function isTrailFile(text) {
  return /^\s*---\s*\n[\s\S]*?\bnode-trail:\s*\d+/.test(String(text || ""));
}

function fromMarkdown(text) {
  const src = String(text || "").replace(/\r\n?/g, "\n");
  if (!isTrailFile(src)) throw new Error("This is not a NODE trail file: it has no \"node-trail\" line at the top.");
  const end = src.indexOf("\n---", 4);
  const front = parseYaml(src.slice(src.indexOf("---") + 3, end).split("\n"));
  if (Number(front["node-trail"]) > FORMAT) throw new Error(`This trail file was made by a newer NODE (format ${front["node-trail"]}). Update NODE to open it.`);
  const body = src.slice(src.indexOf("\n", end + 1) + 1).split("\n");
  const trail = {
    id: String(front.id || ""),
    name: String(front.name || "Shared trail"),
    exportedBy: String(front["exported-by"] || ""),
    exportedAt: Date.parse(front["exported-at"] || "") || 0,
    pins: Array.isArray(front.pins) ? front.pins.map(String) : [],
    tags: Array.isArray(front.tags) ? front.tags.map(String) : [],
    tabs: Array.isArray(front["open-tabs"]) ? front["open-tabs"].map(String) : [],
    about: "",
    threads: [],
    pages: [],
    reports: [],
    extra: [],
  };
  let section = "intro";
  let thread = null;
  let page = null;
  let report = null;
  const stack = []; // [{ depth, reply }] for nested replies
  const extraBuf = [];
  const flushExtra = () => {
    const t = extraBuf.join("\n").trim();
    if (t) trail.extra.push(t);
    extraBuf.length = 0;
  };
  const author = (s) => {
    // "**Author** · 2026-10-27 14:02 UTC: text" (the date is optional).
    const m = s.match(/^\*\*(.+?)\*\*\s*(?:·\s*(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?(?:\s*UTC|Z)?)?)?\s*:\s*([\s\S]*)$/);
    return m ? { by: m[1].trim(), at: parseDay(m[2]), text: m[3].trim() } : { by: ADDED_IN_FILE, at: 0, text: s.trim() };
  };

  for (const raw of body) {
    const line = raw.replace(/\s+$/, "");
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2 && !line.startsWith("###")) {
      flushExtra();
      const name = h2[1].trim().toLowerCase();
      section = name === "threads" ? "threads" : name === "pages" ? "pages" : name === "reports" ? "reports" : "other";
      thread = page = report = null;
      stack.length = 0;
      if (section === "other") extraBuf.push(line);
      continue;
    }
    if (section === "intro") {
      if (/^#\s/.test(line) || /^This is a NODE trail\./.test(line) || !line.trim()) continue;
      trail.about = trail.about ? `${trail.about} ${line.trim()}` : line.trim();
      continue;
    }
    if (section === "other") {
      extraBuf.push(line);
      continue;
    }
    if (section === "threads") {
      const h3 = line.match(/^###\s+(.+)$/);
      if (h3) {
        const { id, text } = takeId(h3[1]);
        thread = { id: id || hashId("thread", text), title: text.trim(), status: "open", conclusion: "", tags: [], pages: [], by: "", at: 0, replies: [] };
        trail.threads.push(thread);
        stack.length = 0;
        continue;
      }
      if (!thread || !line.trim() || /^No threads yet\.$/.test(line)) continue;
      const status = line.match(/^Status:\s*(.+)$/i);
      if (status) {
        for (const part of status[1].split("·").map((x) => x.trim())) {
          if (/^resolved$/i.test(part)) thread.status = "resolved";
          else if (/^open$/i.test(part)) thread.status = "open";
          else if (/^tags:/i.test(part)) thread.tags = splitList(part.replace(/^tags:/i, ""));
          else if (/^started by:/i.test(part)) thread.by = part.replace(/^started by:/i, "").trim();
          else if (parseDay(part)) thread.at = parseDay(part);
        }
        continue;
      }
      const concl = line.match(/^Conclusion:\s*(.*)$/i);
      if (concl) {
        thread.conclusion = concl[1].trim();
        continue;
      }
      const pages = line.match(/^Pages:\s*(.*)$/i);
      if (pages) {
        thread.pages = [...pages[1].matchAll(/<([^>]+)>|\((https?:[^)\s]+)\)/g)].map((m) => cleanUrl(m[1] || m[2])).filter(Boolean);
        continue;
      }
      const item = line.match(/^(\s*)[-*]\s+(.*)$/);
      if (item) {
        const depth = Math.floor(item[1].replace(/\t/g, "  ").length / 2);
        const { id, text } = takeId(item[2]);
        const a = author(text);
        while (stack.length && stack.at(-1).depth >= depth) stack.pop();
        const parent = stack.at(-1)?.reply;
        const reply = { id: id || hashId("reply", thread.id, parent?.id || "", a.by, a.text), by: a.by, at: a.at, text: a.text, replies: [] };
        (parent ? parent.replies : thread.replies).push(reply);
        stack.push({ depth, reply });
        continue;
      }
      // A continuation line of the last reply, or free text under a thread.
      const last = stack.at(-1)?.reply;
      if (last) last.text = `${last.text} ${line.trim()}`;
      else thread.replies.push({ id: hashId("reply", thread.id, "", ADDED_IN_FILE, line.trim()), by: ADDED_IN_FILE, at: 0, text: line.trim(), replies: [] });
      continue;
    }
    if (section === "pages") {
      if (!line.trim() || /^No pages\.$/.test(line)) continue;
      const top = line.match(/^[-*]\s+(.*)$/);
      if (top) {
        const { id, text } = takeId(top[1]);
        const link = text.match(/^\[((?:\\.|[^\]])*)\]\(([^)\s]+)\)/) || text.match(/^<?(https?:\/\/[^>\s]+)>?/);
        const url = cleanUrl(link ? link[2] || link[1] : "");
        if (!url) {
          trail.extra.push(line);
          page = null;
          continue;
        }
        page = { id: id || hashId("page", pageKey(url)), url, title: link[2] ? unescLink(link[1]) : url, firstAt: 0, lastAt: 0, keywords: [], tags: [], notes: [] };
        trail.pages.push(page);
        continue;
      }
      const sub = line.match(/^\s+[-*]\s+(.*)$/);
      if (sub && page) {
        const { id, text } = takeId(sub[1]);
        const note = text.match(/^Note:\s*(.*)$/i);
        if (note) {
          const a = author(note[1]);
          page.notes.push({ id: id || hashId("note", page.id, a.by, a.text), by: a.by, at: a.at, text: a.text });
          continue;
        }
        let matched = false;
        for (const part of text.split("·").map((x) => x.trim())) {
          const read = part.match(/^Read:\s*(\S+)(?:\s+to\s+(\S+))?/i);
          if (read) {
            page.firstAt = parseDay(read[1]);
            page.lastAt = parseDay(read[2] || read[1]);
            matched = true;
          } else if (/^keywords:/i.test(part)) {
            page.keywords = splitList(part.replace(/^keywords:/i, ""));
            matched = true;
          } else if (/^tags:/i.test(part)) {
            page.tags = splitList(part.replace(/^tags:/i, ""));
            matched = true;
          }
        }
        if (!matched) page.notes.push({ id: id || hashId("note", page.id, ADDED_IN_FILE, text), by: ADDED_IN_FILE, at: 0, text: text.trim() });
        continue;
      }
      trail.extra.push(line);
      continue;
    }
    if (section === "reports") {
      const h3 = line.match(/^###\s+(.+)$/);
      if (h3 && !line.startsWith("####")) {
        const { id, text } = takeId(h3[1]);
        report = { id: id || hashId("report", text), title: text.trim(), by: "", at: 0, text: "" };
        trail.reports.push(report);
        continue;
      }
      if (!report) continue;
      const by = line.match(/^By \*\*(.+?)\*\*\s*(?:·\s*(.*))?$/);
      if (by && !report.text) {
        report.by = by[1];
        report.at = parseDay(by[2]);
        continue;
      }
      report.text += (report.text ? "\n" : "") + line.replace(/^#### /, "### ");
    }
  }
  flushExtra();
  for (const r of trail.reports) r.text = r.text.trim();
  // A file can be edited by anyone: sign-in and payment pages, and addresses
  // that are not web pages, are never taken in.
  trail.pages = trail.pages.filter((p) => /^https?:/i.test(p.url) && !isSensitiveUrl(p.url));
  trail.tabs = trail.tabs.filter((u) => /^https?:/i.test(u) && !isSensitiveUrl(u));
  for (const t of trail.threads) t.pages = (t.pages || []).filter((u) => /^https?:/i.test(u) && !isSensitiveUrl(u));
  return trail;
}

// ---- Merging ----
const uniq = (a) => {
  const seen = new Set();
  return a.filter((x) => {
    const k = String(x).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};
const sameSet = (a = [], b = []) => uniq(a).length === uniq([...a, ...b]).length && uniq(b).length === uniq([...a, ...b]).length;
function flatReplies(list, out = []) {
  for (const r of list || []) {
    out.push(r);
    flatReplies(r.replies, out);
  }
  return out;
}

// What merging "incoming" into "base" would do: counts and the questions to ask.
// Questions: { kind: "status", threadId, title, ours, theirs }
//            { kind: "tags", count }  (tags that differ on matching threads and pages, and trail tags)
//            { kind: "pins", ours, theirs }
function mergePlan(base, incoming) {
  const plan = { newPages: 0, combinedPages: 0, newThreads: 0, newReplies: 0, newNotes: 0, newReports: 0, questions: [] };
  const basePages = new Map((base.pages || []).map((p) => [pageKey(p.url), p]));
  let tagDiffs = 0;
  for (const p of incoming.pages || []) {
    const mine = basePages.get(pageKey(p.url));
    if (!mine) {
      plan.newPages++;
      plan.newNotes += (p.notes || []).length;
      continue;
    }
    plan.combinedPages++;
    const ids = new Set((mine.notes || []).map((n) => n.id));
    plan.newNotes += (p.notes || []).filter((n) => !ids.has(n.id)).length;
    if (!sameSet(mine.tags, p.tags)) tagDiffs++;
  }
  const baseThreads = new Map((base.threads || []).map((t) => [t.id, t]));
  for (const t of incoming.threads || []) {
    const mine = baseThreads.get(t.id);
    if (!mine) {
      plan.newThreads++;
      plan.newReplies += flatReplies(t.replies).length;
      continue;
    }
    const ids = new Set(flatReplies(mine.replies).map((r) => r.id));
    plan.newReplies += flatReplies(t.replies).filter((r) => !ids.has(r.id)).length;
    if ((mine.status || "open") !== (t.status || "open")) plan.questions.push({ kind: "status", threadId: t.id, title: mine.title, ours: mine.status || "open", theirs: t.status || "open" });
    if (!sameSet(mine.tags, t.tags)) tagDiffs++;
  }
  if (!sameSet(base.tags, incoming.tags)) tagDiffs++;
  if (tagDiffs) plan.questions.push({ kind: "tags", count: tagDiffs });
  if (!sameSet(base.pins, incoming.pins)) plan.questions.push({ kind: "pins", ours: [...(base.pins || [])], theirs: [...(incoming.pins || [])] });
  const reportIds = new Set((base.reports || []).map((r) => r.id));
  plan.newReports = (incoming.reports || []).filter((r) => !reportIds.has(r.id)).length;
  return plan;
}

// Merges a copy of "incoming" into a copy of "base". Nothing is ever deleted.
// answers: { status: { [threadId]: "ours"|"theirs" }, tags: "ours"|"theirs"|"both", pins: "ours"|"theirs"|"both" }
// Unanswered questions keep "ours" for status and "both" for tags and pins.
function merge(base, incoming, answers = {}) {
  const out = JSON.parse(JSON.stringify(base));
  const inc = JSON.parse(JSON.stringify(incoming));
  const pick = (mine = [], theirs = [], how = "both") => (how === "ours" ? mine : how === "theirs" ? theirs : uniq([...mine, ...theirs]));
  const tagHow = answers.tags || "both";
  out.pins = pick(out.pins, inc.pins, answers.pins || "both");
  out.tags = pick(out.tags, inc.tags, tagHow);
  out.pages = out.pages || [];
  out.threads = out.threads || [];
  out.reports = out.reports || [];

  // Pages: matched by address; first read the earliest, last read the latest,
  // keywords from both, every note kept.
  const pages = new Map(out.pages.map((p) => [pageKey(p.url), p]));
  for (const p of inc.pages || []) {
    const mine = pages.get(pageKey(p.url));
    if (!mine) {
      out.pages.push(p);
      pages.set(pageKey(p.url), p);
      continue;
    }
    mine.firstAt = Math.min(...[mine.firstAt, p.firstAt].filter(Boolean)) || 0;
    mine.lastAt = Math.max(mine.lastAt || 0, p.lastAt || 0);
    if (!mine.title || mine.title === mine.url) mine.title = p.title;
    mine.keywords = uniq([...(mine.keywords || []), ...(p.keywords || [])]).slice(0, 8);
    mine.tags = pick(mine.tags, p.tags, tagHow);
    const ids = new Set((mine.notes || []).map((n) => n.id));
    mine.notes = [...(mine.notes || []), ...(p.notes || []).filter((n) => !ids.has(n.id))].sort((a, b) => (a.at || 0) - (b.at || 0));
  }

  // Threads: matched by id; replies added in their place, by id.
  const threads = new Map(out.threads.map((t) => [t.id, t]));
  const mergeReplies = (mine, theirs) => {
    const byId = new Map(mine.map((r) => [r.id, r]));
    for (const r of theirs || []) {
      const have = byId.get(r.id);
      if (have) mergeReplies((have.replies = have.replies || []), r.replies);
      else {
        mine.push(r);
        byId.set(r.id, r);
      }
    }
    mine.sort((a, b) => (a.at || 0) - (b.at || 0) || String(a.id).localeCompare(String(b.id)));
  };
  for (const t of inc.threads || []) {
    const mine = threads.get(t.id);
    if (!mine) {
      out.threads.push(t);
      threads.set(t.id, t);
      continue;
    }
    mine.replies = mine.replies || [];
    mergeReplies(mine.replies, t.replies);
    if ((mine.status || "open") !== (t.status || "open") && answers.status?.[t.id] === "theirs") mine.status = t.status;
    if (!mine.conclusion && t.conclusion) mine.conclusion = t.conclusion;
    else if (t.conclusion && mine.conclusion !== t.conclusion && !flatReplies(mine.replies).some((r) => r.text === `Conclusion: ${t.conclusion}`))
      mine.replies.push({ id: hashId("conclusion", t.id, t.conclusion), by: t.by || "", at: t.at || 0, text: `Conclusion: ${t.conclusion}`, replies: [] });
    mine.tags = pick(mine.tags, t.tags, tagHow);
    mine.pages = uniq([...(mine.pages || []), ...(t.pages || [])]);
  }

  const reportIds = new Set(out.reports.map((r) => r.id));
  for (const r of inc.reports || []) if (!reportIds.has(r.id)) out.reports.push(r);
  out.extra = uniq([...(out.extra || []), ...(inc.extra || [])]);
  return out;
}

module.exports = { FORMAT, ADDED_IN_FILE, cleanUrl, pageKey, fromSession, toMarkdown, fromMarkdown, isTrailFile, mergePlan, merge, hashId, randomId };
