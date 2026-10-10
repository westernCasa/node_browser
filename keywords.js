// Keyword pipeline (Phase 1: B07-B09).
// Pure functions, no Electron imports, so they can be tested with plain Node.
//
// page (from extractPage) -> rankTerms() -> ranked terms -> buildQueries() -> queries

const STOP = new Set(
  `a about above after again against all almost also am an and any are aren't around as at be because been
  before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't
  down during each either else even ever every few for from further get gets got had hadn't has hasn't have
  haven't having he he'd he'll he's her here here's hers herself him himself his how how's however i i'd i'll
  i'm i've if in into is isn't it it's its itself just let's like made make many may me might more most much
  must mustn't my myself near need never new no nor not now of off often on once one only or other others
  ought our ours ourselves out over own per rather same says said see seen shan't she she'd she'll she's
  should shouldn't since so some still such than that that's the their theirs them themselves then there
  there's these they they'd they'll they're they've this those though through thus to too toward under
  until up upon us use used using very via was wasn't we we'd we'll we're we've well were weren't what what's
  when when's where where's whether which while who who's whom whose why why's will with within without won't
  would wouldn't yet you you'd you'll you're you've your yours yourself yourselves also another back first
  last two three four five six seven eight nine ten one's way ways may might shall within among etc e.g i.e`.split(/\s+/)
);

// Words that show up on most web pages regardless of topic (navigation, UI, legal).
const WEB_NOISE = new Set(
  `home page pages menu search skip content main navigation nav login log sign signin signup register account
  cookie cookies privacy policy terms conditions copyright rights reserved contact subscribe newsletter
  share shares tweet email print click here read more next previous prev top bottom loading load view views
  watch video videos image images photo photos gallery comments comment reply replies like likes follow
  followers official site website web www com org net html http https free download app apps open close
  edit edits article articles post posts blog news update updated published retrieved archived archive
  original source sources external links link references reference citation citations needed wikipedia
  encyclopedia wiki talk help portal contents random contribute tools languages create toggle hide show
  jump list lists category categories file media advertisement ads sponsored learn today yesterday min mins
  ago min read minutes hours days week weeks month months year years`.split(/\s+/)
);

// Very common English words that are rarely useful as research keywords on their own.
const COMMON = new Set(
  `able act add age ago air allow area ask away bad base become began begin best better big bit body book
  both bring build call came car care case cause change child city come common company could country course
  cut day days different does done door during early easy end enough example face fact family far feel field
  find fine form found full game gave general give given goes going good great group grow hand hard head hear
  help high hold house idea important include including information interest keep kind know known large later
  lead least leave left less life light line little live long look lot love low main man mean means men mind
  money move name need number often old open order part people place play point possible power present
  problem program public put question quite real reason right room run said school second seem seems set
  several show side small social something sometimes sound start state story study system take taken tell
  thing things think thought time times today together told took turn type under upon value want water week
  went whole woman women word words work world write year young fail fails failed carry carries choice
  matter matters recommend recommends feed feeds goes keep keeps needs makes making whether below above`.split(/\s+/)
);

const TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}'’+#.-]*/gu;

function clean(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function normToken(raw) {
  return raw
    .toLowerCase()
    .replace(/[’']s$/, "")
    .replace(/^[.\-+#]+|[.\-']+$/g, "");
}

function isUseful(tok, extraStop) {
  if (tok.length < 3 || tok.length > 40) return false;
  if (/^\d+$/.test(tok) && !/^(1[5-9]|20)\d\d$/.test(tok)) return false; // keep years 1500-2099
  if (/^\d/.test(tok) && !/^\d{4}$/.test(tok) && !/[a-z]/.test(tok)) return false;
  if (STOP.has(tok) || WEB_NOISE.has(tok) || extraStop.has(tok)) return false;
  return true;
}

function tokens(text, extraStop) {
  const out = [];
  for (const m of String(text || "").matchAll(TOKEN_RE)) {
    const t = normToken(m[0]);
    if (isUseful(t, extraStop)) out.push(t);
  }
  return out;
}

// Words that belong to the site itself ("wikipedia", "nytimes") rather than the topic.
function siteStopwords(page) {
  const set = new Set();
  try {
    const host = new URL(page?.url || "").hostname.replace(/^www\./, "");
    for (const part of host.split(".")) if (part.length > 2) set.add(part.toLowerCase());
  } catch (_) {}
  const titleParts = clean(page?.title).split(/\s[|–—-]\s/);
  if (titleParts.length > 1) {
    // "Topic - Site Name": the last segment is usually the site name.
    for (const t of tokens(titleParts.at(-1), new Set())) set.add(t);
  }
  return set;
}

// Strip the site-name suffix from a page title.
function coreTitle(title) {
  const parts = clean(title).split(/\s[|–—-]\s/);
  return parts.length > 1 ? parts.slice(0, -1).join(" - ") : clean(title);
}

// Multi-word proper names ("Marie Curie", "Large Hadron Collider") from original-case text.
const NAME_RE = /\b[\p{Lu}][\p{Ll}\p{Lu}'’.-]+(?:\s+(?:of|de|del|da|van|von|the|la|le)?\s*[\p{Lu}][\p{Ll}\p{Lu}'’.-]+){1,3}\b/gu;
const NAME_SKIP = /^(The|A|An|And|For|With|From|This|That|You|Your|Home|Page|Video|Image|Photo|Main|Sign|Log|Read|Click)\s/;

const CONNECTOR = /\s+(?:of|de|del|da|van|von|the|and|la|le)\s+/i;

function phrasesFrom(text) {
  const out = [];
  for (const m of String(text || "").matchAll(NAME_RE)) {
    const p = clean(m[0].replace(NAME_SKIP, ""));
    // "Chad Robertson of Tartine Bakery" -> "Chad Robertson", "Tartine Bakery".
    // Short connected names ("Bank of America") stay whole.
    const parts = p.split(" ").length > 4 && CONNECTOR.test(p) ? p.split(CONNECTOR) : [p];
    for (const part of parts) {
      const words = part.split(" ").length;
      if (words >= 2 && words <= 4 && part.length <= 60) out.push(part);
    }
  }
  return out;
}

// Session document frequency: how many recent pages each term appeared on.
// Terms that appear on most pages (site chrome, generic words) are pushed down.
class SessionDF {
  constructor(limit = 60) {
    this.limit = limit;
    this.pages = []; // array of Set(term)
    this.df = new Map();
  }
  add(url, terms) {
    if (this.lastUrl === url) return; // same page re-read on scroll: count once
    this.lastUrl = url;
    const set = new Set(terms);
    this.pages.push(set);
    for (const t of set) this.df.set(t, (this.df.get(t) || 0) + 1);
    while (this.pages.length > this.limit) {
      for (const t of this.pages.shift()) {
        const n = (this.df.get(t) || 1) - 1;
        if (n) this.df.set(t, n);
        else this.df.delete(t);
      }
    }
  }
  idf(term) {
    const n = this.pages.length;
    if (n < 3) return 1; // not enough pages yet to judge
    const d = this.df.get(term) || 0;
    return Math.log((n + 1) / (d + 1)) / Math.log(n + 1) + 0.35;
  }
}

const FIELD_WEIGHT = {
  selection: 6,
  title: 4,
  headings: 3,
  description: 2,
  names: 2,
  text: 1,
  media: 0.6,
};

/**
 * Rank keywords for a page.
 * @param {object} page  output of extractPage()
 * @param {object} opts  { df: SessionDF, banned: string[], limit }
 * @returns {{term:string, score:number, kind:"term"|"phrase", from:string}[]}
 */
function rankTerms(page, opts = {}) {
  const banned = new Set((opts.banned || []).map((b) => b.toLowerCase()));
  const extraStop = siteStopwords(page);
  const fields = {
    selection: clean(page?.selection),
    title: coreTitle(page?.title),
    headings: (page?.headings || []).join(" . "),
    description: clean(page?.description),
    names: (page?.names || []).join(" . "),
    text: clean(page?.text),
    media: [...(page?.mediaMeta || []), ...(page?.mediaLinks || [])].join(" . "),
  };

  // 1. Single-word scores, weighted by where the word appears.
  const tf = new Map();
  const from = new Map();
  for (const [field, text] of Object.entries(fields)) {
    const w = FIELD_WEIGHT[field];
    const seen = new Map();
    for (const t of tokens(text, extraStop)) seen.set(t, (seen.get(t) || 0) + 1);
    for (const [t, n] of seen) {
      // Diminishing returns for repeats inside one field.
      tf.set(t, (tf.get(t) || 0) + w * (1 + Math.log(n)));
      if (!from.has(t) || FIELD_WEIGHT[from.get(t)] < w) from.set(t, field);
    }
  }
  // Fold simple plurals into the singular ("starters" -> "starter").
  for (const t of [...tf.keys()]) {
    const single = t.endsWith("ies") ? t.slice(0, -3) + "y" : t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : "";
    if (t.length > 4 && single && tf.has(single)) {
      tf.set(single, tf.get(single) + tf.get(t));
      tf.delete(t);
    }
  }
  if (opts.df) opts.df.add(page?.url || "", [...tf.keys()]);

  const scored = new Map();
  for (const [t, s] of tf) {
    let score = s * (opts.df ? opts.df.idf(t) : 1);
    if (COMMON.has(t)) score *= 0.35;
    if (t.length >= 7) score *= 1.15;
    if (banned.has(t)) continue;
    scored.set(t, { term: t, score, kind: "term", from: from.get(t) });
  }

  // 2. Multi-word names. A phrase that recurs absorbs its member words (K5).
  const phraseCount = new Map();
  const phraseCase = new Map();
  const addPhrases = (text, w) => {
    for (const p of phrasesFrom(text)) {
      const key = p.toLowerCase();
      phraseCount.set(key, (phraseCount.get(key) || 0) + w);
      if (!phraseCase.has(key)) phraseCase.set(key, p);
    }
  };
  addPhrases(fields.selection, 6);
  addPhrases(page?.title, 4);
  addPhrases(fields.headings, 3);
  addPhrases(fields.names, 2);
  addPhrases(page?.text, 1);
  for (const n of page?.names || []) {
    const key = clean(n).toLowerCase();
    if (key.includes(" ")) {
      phraseCount.set(key, (phraseCount.get(key) || 0) + 2);
      if (!phraseCase.has(key)) phraseCase.set(key, clean(n));
    }
  }

  for (const [key, weight] of phraseCount) {
    if (weight < 2 || banned.has(key)) continue;
    const parts = tokens(key, extraStop);
    if (parts.length < 2) continue;
    const memberScores = parts.map((p) => scored.get(p)?.score || 0);
    const score = weight + Math.max(...memberScores) * 0.9;
    scored.set(key, { term: phraseCase.get(key), score, kind: "phrase", from: "names" });
    for (const p of parts) {
      const s = scored.get(p);
      if (s) s.score *= 0.3; // member words drop below the phrase
    }
  }

  const limit = opts.limit || 12;
  const ranked = [...scored.values()].sort((a, b) => b.score - a.score);
  // Drop single words already covered by a higher-ranked phrase ("marie" under "Marie Curie").
  const covered = new Set();
  const out = [];
  for (const r of ranked) {
    if (r.kind === "term" && covered.has(r.term)) continue;
    if (r.kind === "phrase") for (const p of tokens(r.term, new Set())) covered.add(p);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Turn pinned keywords + ranked terms into 1-3 short search queries (B09).
 * Each query has at most 4 words; pinned keywords go into every query.
 */
function buildQueries({ pinned = [], ranked = [], title = "" }, max = 3) {
  const pins = pinned.map(clean).filter(Boolean);
  const pinWords = pins.join(" ").split(" ").filter(Boolean).length;
  const room = Math.max(1, 4 - pinWords);
  const pinSet = new Set(pins.map((p) => p.toLowerCase()));
  const pool = ranked.map((r) => (typeof r === "string" ? r : r.term)).filter((t) => t && !pinSet.has(t.toLowerCase()));

  const queries = [];
  // Pick terms in order until the word budget is used up.
  const take = (terms, budget) => {
    const picked = [];
    let words = 0;
    for (const t of terms) {
      const n = t.split(" ").length;
      if (words + n > budget) continue;
      picked.push(t);
      words += n;
      if (words >= budget) break;
    }
    return picked;
  };
  const push = (parts) => {
    const q = clean([...pins, ...parts].join(" "));
    if (q && !queries.some((x) => x.toLowerCase() === q.toLowerCase())) queries.push(q);
  };

  // Q1: the strongest terms.
  const q1 = take(pool.slice(0, 4), room);
  push(q1);
  // Q2: the top term as an anchor plus terms not used in Q1, for a second angle.
  const rest = pool.filter((t) => !q1.includes(t));
  if (rest.length >= 2) {
    const anchor = pool[0];
    const anchorWords = anchor.split(" ").length;
    push(anchorWords < room ? [anchor, ...take(rest, room - anchorWords)] : take(rest, room));
  }
  // Q3: the page's own title (cleaned), for "more like this page".
  const core = coreTitle(title);
  if (core && core.split(" ").length <= 8 && !pins.length) push([core]);
  if (!queries.length && pins.length) push([]);
  return queries.slice(0, max);
}

/** Overlap between two keyword lists (0..1), used to decide whether to re-crawl. */
function overlap(a, b) {
  const A = new Set(a.map((x) => String(x).toLowerCase()));
  const B = new Set(b.map((x) => String(x).toLowerCase()));
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / Math.max(A.size, B.size);
}

module.exports = { rankTerms, buildQueries, overlap, coreTitle, SessionDF, tokens, phrasesFrom };
