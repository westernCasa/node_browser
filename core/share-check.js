// The check before sharing (B86): contact details (email addresses and phone
// numbers) in what a trail would share, so the person can leave each one out.
// Runs on the trail file (node-trail v2) and on share links (format 1).
// Local rules only. No platform imports.
//
// findContacts(texts) → [{ kind, value, where, count }]
// redact(value, leaveOut) → a copy with each left-out detail replaced, in every string

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// A phone number: an optional +, then digits in groups split by spaces, dots,
// dashes or brackets; 10 to 15 digits in all. Not inside a longer run of
// digits or letters (order numbers, ids, hashes).
const PHONE = /(?<![\w+])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]\d{2,4}){1,4}(?![\w])/g;
const digits = (s) => s.replace(/\D/g, "");
// Dates, times and number ranges look like phone numbers; these don't count.
const NOT_PHONE = [/^\d{4}[-.]\d{1,2}[-.]\d{1,2}$/, /^\d{1,2}[-.]\d{1,2}[-.]\d{2,4}$/, /^\d{1,2}[:.]\d{2}/, /^\d{4}\s*-\s*\d{4}$/];

function phonesIn(text) {
  const out = [];
  for (const m of String(text).matchAll(PHONE)) {
    const v = m[0].trim();
    const n = digits(v).length;
    if (n < 10 || n > 15) continue;
    if (NOT_PHONE.some((re) => re.test(v))) continue;
    // Plain runs of digits without separators are ids, not numbers to call,
    // unless they start with +.
    if (!/[\s.()-]/.test(v) && !v.startsWith("+")) continue;
    out.push(v);
  }
  return out;
}

// texts: [{ where: "Note: Feed twice a day", text }]. The same detail found
// in several places is one finding with a count and its first place.
function findContacts(texts) {
  const found = new Map();
  for (const { where, text } of texts) {
    if (!text) continue;
    const s = String(text);
    const add = (kind, value) => {
      const key = kind === "phone" ? `phone:${digits(value)}` : `email:${value.toLowerCase()}`;
      const f = found.get(key);
      if (f) f.count++;
      else found.set(key, { kind, value, where, count: 1, also: [] });
      if (f && f.value !== value && !f.also.includes(value)) f.also.push(value);
    };
    for (const m of s.matchAll(EMAIL)) add("email", m[0]);
    for (const v of phonesIn(s.replace(EMAIL, " "))) add("phone", v);
  }
  return [...found.values()];
}

// The texts a trail snapshot would share: card titles and text, notes,
// questions and their replies, group names, timeline titles, the note
// typed in the share sheet.
function snapshotTexts(snap, { note = "" } = {}) {
  const out = [];
  const label = (c) => ({ page: "Page", video: "Video", capture: "Capture", report: "Report", question: "Question", note: "Note", voice: "Voice note", search: "Search", media: "Media", moment: "Moment" })[c.kind] || "Card";
  const short = (s) => {
    s = String(s || "").replace(/\s+/g, " ").trim();
    return s.length > 48 ? `${s.slice(0, 47)}…` : s;
  };
  if (note) out.push({ where: "Your note in the share sheet", text: note });
  for (const c of snap.cards || []) {
    if (c.removed) continue;
    const name = `${label(c)}: ${short(c.title || c.text || c.quote || c.query || "")}`;
    for (const f of ["title", "text", "quote", "excerpt", "conclusion", "transcript", "query"]) if (c[f]) out.push({ where: name, text: c[f] });
    const walk = (list) => (list || []).forEach((r) => (out.push({ where: `${name}, a reply${r.by ? ` by ${r.by}` : ""}`, text: r.text }), walk(r.replies)));
    walk(c.replies);
  }
  for (const g of snap.groups || []) if (g.label) out.push({ where: `Group: ${short(g.label)}`, text: g.label });
  for (const s of snap.timeline || []) for (const it of s.items || []) if (it.title) out.push({ where: `Timeline: ${short(it.title)}`, text: it.title });
  return out;
}

// The texts of a share link's trail (TrailFile.fromSession: pages with notes,
// threads with replies, reports).
function sessionTexts(trail) {
  const out = [];
  for (const p of trail.pages || []) {
    out.push({ where: `Page: ${p.title || p.url}`, text: p.title });
    for (const n of p.notes || []) out.push({ where: `Note on ${p.title || p.url}`, text: n.text });
  }
  const walk = (t, list) => (list || []).forEach((r) => (out.push({ where: `Thread: ${t.title}, a reply`, text: r.text }), walk(t, r.replies)));
  for (const t of trail.threads || []) {
    out.push({ where: `Thread: ${t.title}`, text: t.title }, { where: `Thread: ${t.title}`, text: t.conclusion });
    walk(t, t.replies);
  }
  for (const r of trail.reports || []) out.push({ where: `Report: ${r.title}`, text: `${r.title}\n${r.text || ""}` });
  return out;
}

// Replaces each left-out detail everywhere it appears, in every string of a
// copy of obj ("[email left out]", "[phone number left out]").
function redact(obj, leaveOut = []) {
  const list = (leaveOut || []).filter((f) => f && f.value);
  if (!list.length) return obj;
  const swaps = list.flatMap((f) => [f.value, ...(f.also || [])].map((v) => [v, f.kind === "phone" ? "[phone number left out]" : "[email left out]"]));
  const fix = (s) => {
    let out = s;
    for (const [v, w] of swaps) out = out.split(v).join(w);
    // An email in a different case is the same email.
    for (const f of list) if (f.kind === "email") out = out.replace(new RegExp(f.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[email left out]");
    return out;
  };
  const walk = (v) => (typeof v === "string" ? fix(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v);
  return walk(obj);
}

module.exports = { findContacts, snapshotTexts, sessionTexts, redact, phonesIn };
