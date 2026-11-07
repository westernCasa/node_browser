// Find things in past trails by what the person remembers (B89): words,
// a time ("yesterday", "last Tuesday", "in October"), an order ("after the
// Discogs page", "before …", "around …"), a kind ("video", "question",
// "note") and a trail ("in Rye breads"). Local rules only, no AI; nothing
// leaves the computer. No platform imports.
//
// parseRecall(text, { now, trails }) → { words, range, order, kinds, trail }
// recallIndex(store) → entries from every trail, oldest first in each trail
// recall(entries, text, { now, trails, limit }) → results, best first

const DAY = 86400000;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const SHORT_WD = WEEKDAYS.map((d) => d.slice(0, 3));
const SHORT_MO = MONTHS.map((m) => m.slice(0, 3));
// Words that say nothing about which page it was.
const STOP = new Set(
  "a an the that this those these one ones page pages site sites website article post thing something stuff i me my we our was were is it its of on at to for from with about some any where what which when did saw seen read found looked viewed visited opened watched listened there".split(" ")
);
// Kind words: what sort of thing it was.
const KINDS = {
  video: "video", videos: "video", clip: "video", watched: "video",
  song: "audio", track: "audio", audio: "audio", podcast: "audio", listened: "audio",
  question: "question", questions: "question", thread: "question", threads: "question",
  note: "note", notes: "note",
  search: "search", searches: "search", searched: "search",
  image: "image", images: "image", photo: "image", picture: "image", screenshot: "image",
};
const VIDEO_HOSTS = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|twitch\.tv|dailymotion\.com|tiktok\.com)$/;
const AUDIO_HOSTS = /(^|\.)(soundcloud\.com|bandcamp\.com|mixcloud\.com|open\.spotify\.com|music\.apple\.com)$/;

const lower = (s) => String(s || "").toLowerCase();
const startOfDay = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const addDays = (t, n) => {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
};
function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (_) {
    return "";
  }
}
function tokens(s) {
  return lower(s)
    .replace(/[“”"']/g, " ")
    .split(/[^\p{L}\p{N}.+#-]+/u)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ""))
    .filter(Boolean);
}

// Time phrases at the given word position. Returns { range: [from, to), n }
// where n is how many words it used, or null.
function timeAt(w, i, now) {
  const today = startOfDay(now);
  const a = w[i], b = w[i + 1], c = w[i + 2];
  const day = (start) => [start, addDays(start, 1)];
  if (a === "today") return { range: day(today), n: 1 };
  if (a === "yesterday") return { range: day(addDays(today, -1)), n: 1 };
  if (a === "tonight") return { range: [today + 17 * 3600000, addDays(today, 1)], n: 1 };
  if (a === "this" && ["morning", "afternoon", "evening"].includes(b)) {
    const h = { morning: [5, 12], afternoon: [12, 17], evening: [17, 24] }[b];
    return { range: [today + h[0] * 3600000, today + h[1] * 3600000], n: 2 };
  }
  if (a === "last" && b === "night") return { range: [addDays(today, -1) + 17 * 3600000, today + 5 * 3600000], n: 2 };
  const wd = (x) => {
    const k = WEEKDAYS.indexOf(x) >= 0 ? WEEKDAYS.indexOf(x) : SHORT_WD.indexOf(x);
    return x && k >= 0 ? k : -1;
  };
  // "last tuesday": the latest Tuesday before today. "tuesday", "on tuesday":
  // the latest Tuesday, today included.
  if ((a === "last" || a === "on") && wd(b) >= 0) {
    const back = (new Date(today).getDay() - wd(b) + 7) % 7 || (a === "last" ? 7 : 0);
    return { range: day(addDays(today, -back)), n: 2 };
  }
  if (wd(a) >= 0 && a.length > 3) {
    const back = (new Date(today).getDay() - wd(a) + 7) % 7;
    return { range: day(addDays(today, -back)), n: 1 };
  }
  const monday = addDays(today, -((new Date(today).getDay() + 6) % 7));
  if (a === "this" && b === "week") return { range: [monday, addDays(today, 1)], n: 2 };
  if (a === "last" && b === "week") return { range: [addDays(monday, -7), monday], n: 2 };
  const first = (() => {
    const d = new Date(today);
    d.setDate(1);
    return d.getTime();
  })();
  const monthStart = (t, k) => {
    const d = new Date(t);
    d.setMonth(d.getMonth() + k, 1);
    return startOfDay(d.getTime());
  };
  if (a === "this" && b === "month") return { range: [first, addDays(today, 1)], n: 2 };
  if (a === "last" && b === "month") return { range: [monthStart(first, -1), first], n: 2 };
  // "in october", "october": the latest October, this month included.
  const mo = (x) => {
    const k = MONTHS.indexOf(x) >= 0 ? MONTHS.indexOf(x) : x && x.length >= 3 && x !== "may" ? SHORT_MO.indexOf(x) : -1;
    return x === "may" ? 4 : k;
  };
  const monthRange = (k) => {
    const d = new Date(today);
    let y = d.getFullYear();
    if (k > d.getMonth()) y -= 1;
    const s = new Date(y, k, 1).getTime();
    return [s, new Date(y, k + 1, 1).getTime()];
  };
  if (a === "in" && mo(b) >= 0) return { range: monthRange(mo(b)), n: 2 };
  if (mo(a) >= 0 && a !== "may") return { range: monthRange(mo(a)), n: 1 };
  // "3 days ago", "2 weeks ago", "a few days ago", "a week ago"
  const num = (x) => (/^\d+$/.test(x || "") ? Number(x) : { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 }[x]);
  if (c === "ago" && num(a) && /^days?$/.test(b)) return { range: day(addDays(today, -num(a))), n: 3 };
  if (c === "ago" && num(a) && /^weeks?$/.test(b)) {
    const s = addDays(today, -7 * num(a) - 3);
    return { range: [s, addDays(s, 7)], n: 3 };
  }
  if (a === "a" && b === "few" && c === "days" && w[i + 3] === "ago") return { range: [addDays(today, -5), addDays(today, -1)], n: 4 };
  if (a === "recently" || (a === "the" && b === "other" && c === "day")) {
    const n = a === "recently" ? 1 : 3;
    return { range: [addDays(today, -7), addDays(today, 1)], n };
  }
  return null;
}

function parseRecall(text, { now = Date.now(), trails = [] } = {}) {
  let q = lower(text).trim();
  const out = { words: [], range: null, order: null, kinds: [], trail: null };
  // "in <trail name>" / "on the <trail name> trail", when a trail has that name.
  const names = trails.map((t) => ({ id: t.id, name: lower(t.name).trim() })).filter((t) => t.name).sort((a, b) => b.name.length - a.name.length);
  for (const t of names) {
    const m = q.match(new RegExp(`(?:^|\\s)(?:in|on|from)\\s+(?:the\\s+|my\\s+)?${t.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s+trail)?(?=\\s|$)`));
    if (m) {
      out.trail = t.id;
      q = (q.slice(0, m.index) + " " + q.slice(m.index + m[0].length)).trim();
      break;
    }
  }
  const w = tokens(q);
  const rest = [];
  let order = null;
  for (let i = 0; i < w.length; ) {
    const t = timeAt(w, i, now);
    if (t) {
      out.range = t.range;
      i += t.n;
      continue;
    }
    if (["after", "before", "around", "near", "next"].includes(w[i]) && !(w[i] === "next" && w[i + 1] !== "to")) {
      const rel = w[i] === "after" ? "after" : w[i] === "before" ? "before" : "near";
      order = { rel, words: [] };
      i += w[i] === "next" ? 2 : 1;
      continue;
    }
    if (KINDS[w[i]]) {
      if (!out.kinds.includes(KINDS[w[i]])) out.kinds.push(KINDS[w[i]]);
      i++;
      continue;
    }
    if (!STOP.has(w[i])) (order ? order.words : rest).push(w[i]);
    i++;
  }
  out.words = rest;
  if (order && order.words.length) out.order = order;
  else if (order) out.words.push(...order.words);
  return out;
}

// The kind of an entry, for "video", "question" and the like.
function kindOf(e) {
  if (e.kind === "media") return e.media === "screenshot" ? "image" : e.media || "image";
  if (e.kind === "page" || e.kind === "visit") {
    const host = hostOf(e.url);
    if (VIDEO_HOSTS.test(host)) return "video";
    if (AUDIO_HOSTS.test(host)) return "audio";
    return "page";
  }
  return e.kind;
}

// Everything in every trail that can be found: the pages in each trail's
// timeline (cards and timeline only), and its other cards (questions, notes,
// searches, media).
function recallIndex(store) {
  const out = [];
  for (const t of store.list()) {
    const snap = store.snapshot(t.id);
    if (!snap) continue;
    const cards = new Map(snap.cards.filter((c) => !c.removed).map((c) => [c.id, c]));
    const seenCards = new Set();
    const rows = [];
    for (const s of snap.timeline || []) {
      for (const it of s.items || []) {
        if (!it.at) continue;
        const c = it.card ? cards.get(it.card) : null;
        if (c) seenCards.add(c.id);
        rows.push({
          kind: c ? c.kind : "visit",
          media: c?.media,
          trail: t.id,
          card: c ? c.id : null,
          url: it.url || c?.url || "",
          title: it.title || c?.title || it.url || "",
          text: c ? [c.excerpt, ...(c.keywords || [])].filter(Boolean).join(" ") : "",
          at: it.at,
          timelineOnly: !c,
        });
      }
    }
    for (const c of cards.values()) {
      if (seenCards.has(c.id) || !c.placedAt) continue;
      const text = [c.text, c.quote, c.query, c.excerpt, c.conclusion, ...(c.keywords || []), ...(c.replies || []).map((r) => r.text)].filter(Boolean).join(" ");
      rows.push({ kind: c.kind, media: c.media, trail: t.id, card: c.id, url: c.url || "", title: c.title || c.text || c.query || "", text, at: c.placedAt, timelineOnly: false });
    }
    for (const g of snap.groups || []) {
      // A group's name finds its cards: "in the hydration group".
      for (const id of g.cards || []) {
        const c = cards.get(id);
        const r = c && rows.find((x) => x.card === id);
        if (r) r.text = `${r.text} ${g.label || ""}`.trim();
      }
    }
    rows.sort((a, b) => a.at - b.at);
    rows.forEach((r, i) => {
      r.trailName = t.name;
      r.pos = i;
    });
    out.push(...rows);
  }
  return out;
}

function hay(e) {
  return lower(`${e.title} ${hostOf(e.url)} ${e.url.replace(/^https?:\/\/(www\.)?/, "")} ${e.text}`);
}
// How well the words match: 0 when one is missing.
function score(e, words) {
  if (!words.length) return 1;
  const title = lower(e.title), h = hay(e);
  let s = 0;
  for (const w of words) {
    if (title.includes(w)) s += 3;
    else if (hostOf(e.url).includes(w)) s += 2;
    else if (h.includes(w)) s += 1;
    else return 0;
  }
  return s;
}

const fmtDay = (t, now) => {
  const d = new Date(t), today = startOfDay(now);
  if (t >= today) return "today";
  if (t >= addDays(today, -1)) return "yesterday";
  const wd = SHORT_WD[d.getDay()][0].toUpperCase() + SHORT_WD[d.getDay()].slice(1, 3);
  const mo = SHORT_MO[d.getMonth()][0].toUpperCase() + SHORT_MO[d.getMonth()].slice(1);
  return `${wd} ${d.getDate()} ${mo}${d.getFullYear() !== new Date(now).getFullYear() ? ` ${d.getFullYear()}` : ""}`;
};
const short = (s, n = 40) => (String(s).length > n ? String(s).slice(0, n - 1).trimEnd() + "…" : String(s));

// Results, best first: { trail, trailName, card, url, title, at, kind,
// timelineOnly, why }.
function recall(entries, text, { now = Date.now(), trails = [], limit = 8 } = {}) {
  const p = parseRecall(text, { now, trails });
  const nothing = !p.words.length && !p.range && !p.order && !p.kinds.length;
  if (nothing) return [];
  const inScope = (e) => (!p.trail || e.trail === p.trail) && (!p.range || (e.at >= p.range[0] && e.at < p.range[1]));
  const kindOk = (e) => !p.kinds.length || p.kinds.includes(kindOf(e));
  const byTrail = new Map();
  for (const e of entries) {
    if (!byTrail.has(e.trail)) byTrail.set(e.trail, []);
    byTrail.get(e.trail).push(e);
  }
  const found = [];
  if (p.order) {
    // The pages the order words name, then what came just after or before
    // them in the same trail.
    const anchors = entries.filter((e) => inScope(e) && score(e, p.order.words) > 0);
    for (const a of anchors) {
      const list = byTrail.get(a.trail);
      const steps = p.order.rel === "after" ? [1, 2, 3, 4, 5, 6] : p.order.rel === "before" ? [-1, -2, -3, -4, -5, -6] : [1, -1, 2, -2, 3, -3];
      for (const d of steps) {
        const e = list[a.pos + d];
        if (!e || e.url === a.url || !kindOk(e)) continue;
        const s = score(e, p.words);
        if (!s) continue;
        found.push({ e, s: s + 20 - Math.abs(d) * 3 + score(a, p.order.words), why: `${p.order.rel === "after" ? "after" : p.order.rel === "before" ? "before" : "near"} “${short(a.title, 32)}”` });
      }
    }
  } else {
    for (const e of entries) {
      if (!inScope(e) || !kindOk(e)) continue;
      const s = score(e, p.words);
      if (s) found.push({ e, s, why: "" });
    }
  }
  // One result per page (or card) in a trail: the best, then the latest.
  const best = new Map();
  for (const f of found) {
    const k = `${f.e.trail} ${f.e.card || f.e.url}`;
    const o = best.get(k);
    if (!o || f.s > o.s || (f.s === o.s && f.e.at > o.e.at)) best.set(k, f);
  }
  return [...best.values()]
    .sort((a, b) => b.s - a.s || b.e.at - a.e.at)
    .slice(0, limit)
    .map(({ e, why }) => ({
      trail: e.trail,
      trailName: e.trailName,
      card: e.card,
      url: e.url,
      title: e.title,
      at: e.at,
      kind: kindOf(e),
      timelineOnly: e.timelineOnly,
      why: [why, fmtDay(e.at, now), e.trailName].filter(Boolean).join(" · "),
    }));
}

module.exports = { parseRecall, recallIndex, recall, kindOf, timeAt };
