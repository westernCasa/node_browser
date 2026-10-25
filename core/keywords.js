// Keyword pipeline (Phase 1: B07-B09).
// Pure functions, no Electron imports, so they can be tested with plain Node.
//
// page (from extractPage) -> rankTerms() -> ranked terms -> buildQueries() -> queries

const { rarityWeight } = require("./frequency");

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
  ago min read minutes hours days week weeks month months year years shortcut shortcuts hotkey hotkeys`.split(/\s+/)
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

// Shop and checkout words: rarely what a page is about.
const SHOP = new Set(
  `cart basket checkout shipping delivery returns refund refunds wishlist coupon coupons discount sale price prices stock warranty order orders subtotal tax taxes`.split(/\s+/)
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
  const titleParts = clean(page?.title).split(/\s[|–—:-]\s/);
  if (titleParts.length > 1) {
    // "Topic - Site Name": the last segment is usually the site name.
    for (const t of tokens(titleParts.at(-1), new Set())) set.add(t);
  }
  return set;
}

// Strip the site-name suffix from a page title.
function coreTitle(title) {
  const parts = clean(title).split(/\s[|–—:-]\s/);
  return parts.length > 1 ? parts.slice(0, -1).join(" - ") : clean(title);
}

// Multi-word proper names ("Marie Curie", "Large Hadron Collider") from original-case text.
const NAME_RE = /\b[\p{Lu}][\p{Ll}\p{Lu}'’.-]+(?:\s+(?:of|de|del|da|van|von|the|la|le)?\s*[\p{Lu}][\p{Ll}\p{Lu}'’.-]+){1,3}\b/gu;
const NAME_SKIP = /^(The|A|An|And|For|With|From|This|That|You|Your|Home|Page|Video|Image|Photo|Main|Sign|Log|Read|Click|Is|Are|Was|Were|Why|How|What|When|Where|Who|Did|Does|Do|Can|Will|Should)\s/;

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
  focus: 3, // text from a site rule's extract.include selectors
  title: 4,
  headings: 3,
  description: 2,
  names: 2,
  text: 1,
  media: 0.6,
};

// Interface text: prompts, buttons and calls to action ("Try searching to get
// started", "Continue with Google", "Join the conversation"). Short blocks that
// start like this are about using the site, not about the page's topic.
const UI_START = /^(try|start(ed)?|get( started)?|continue|join|sign|log ?in|log ?out|watch|subscribe|follow|download|install|click|tap|discover|explore|learn more|shop|buy|add to|create|upload|share|enable|accept|allow|manage|choose|select|search|browse|view all|see (all|more)|read more|show (more|less)|load more|open|go to|skip|reply|award|report|save|vote|upvote|sort|filter|close|cancel|agree|reject|play|pause|send|post|upgrade|register|apply now|contact us|chat with|need help|book now|order now|get the app)\b/i;
const UI_SENTENCE = /^(free (shipping|delivery|returns)|in stock|out of stock|only \d+ left|you('|’)re|your (account|feed|cart|library|subscriptions|history)|we use cookies|by (continuing|signing|clicking)|already have an account|don('|’)t have an account|no results|nothing (here|to see)|something went wrong|loading|this (site|page) uses)/i;

function isInterfaceText(s, maxWords = 12) {
  const t = clean(s);
  if (!t) return true;
  if (t.split(" ").length > maxWords) return false;
  return UI_START.test(t) || UI_SENTENCE.test(t);
}

// Image alt text and file names that describe the site's own graphics
// ("Brave Logo Small", "Google Button", "Semi Protection Shackle", "Snoo Map")
// rather than the page's topic (B67).
const UI_GRAPHIC = /\b(logos?|icons?|buttons?|btn|badges?|avatars?|sprites?|favicon|wordmark|glyphs?|placeholder|spinner|chevron|caret|shackle|padlock|snoo|profile (photo|picture|image)|user ?pic)\b/i;
// Keyboard-shortcut help ("Keyboard shortcuts", "Press ? to view keyboard shortcuts").
const SHORTCUT_TEXT = /\b(?:press\s+\S+\s+to\s+(?:open|view|see|show)\s+)?(?:keyboard\s+shortcuts?|shortcut\s+keys?|hot\s?keys?)\b/gi;

function withoutUiGraphics(list) {
  const out = [];
  for (const item of list || []) {
    const parts = String(item).split(" | ").filter((p) => clean(p) && !UI_GRAPHIC.test(p));
    if (parts.length) out.push(parts.join(" | "));
  }
  return out;
}

const blockKey = (s) => clean(s).toLowerCase().slice(0, 160);

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch (_) {
    return "";
  }
}

// What NODE learns while you browse, for better keywords:
// - furniture: text blocks that repeat on different pages of the same site
//   (sidebars, sign-up boxes, site descriptions) are left out on that site;
// - topic: words that are among the top keywords on pages from different sites
//   are your running topic; they rank higher, and thin pages fall back to them.
class KeywordContext {
  constructor({ pagesPerHost = 30, topicPages = 40 } = {}) {
    this.pagesPerHost = pagesPerHost;
    this.topicPages = topicPages;
    this.hosts = new Map(); // host -> Map(url -> Set(blockKey))
    this.hostNames = new Map(); // host -> Map(url -> Set(name, lower case))
    this.pages = new Map(); // url -> { host, terms: string[] }, newest last
  }

  furniture(host, url) {
    const seen = new Set();
    for (const [u, keys] of this.hosts.get(host) || []) if (u !== url) for (const k of keys) seen.add(k);
    return seen;
  }

  rememberBlocks(host, url, keys) {
    if (!host) return;
    if (!this.hosts.has(host)) this.hosts.set(host, new Map());
    const m = this.hosts.get(host);
    m.delete(url);
    m.set(url, new Set(keys));
    while (m.size > this.pagesPerHost) m.delete(m.keys().next().value);
  }

  // Names that come with every page of a site whatever the page is about: the
  // signed-in user's own name in the site's menus, the site's own name (B67).
  // A name counts once it was on at least 3 other pages of the site, all of them.
  siteNames(host, url) {
    const others = [...(this.hostNames.get(host) || [])].filter(([u]) => u !== url).map(([, set]) => set);
    if (others.length < 3) return new Set();
    const [first, ...rest] = others;
    return new Set([...first].filter((n) => rest.every((set) => set.has(n))));
  }

  rememberNames(host, url, names) {
    if (!host) return;
    if (!this.hostNames.has(host)) this.hostNames.set(host, new Map());
    const m = this.hostNames.get(host);
    m.delete(url);
    m.set(url, new Set(names.map((n) => clean(n).toLowerCase()).filter(Boolean)));
    while (m.size > this.pagesPerHost) m.delete(m.keys().next().value);
  }

  rememberTopic(host, url, terms) {
    this.pages.delete(url);
    this.pages.set(url, { host, terms: terms.map((t) => t.toLowerCase()) });
    while (this.pages.size > this.topicPages) this.pages.delete(this.pages.keys().next().value);
  }

  // Distinct sites whose pages had this word among their top keywords.
  sitesFor(term) {
    const t = String(term).toLowerCase();
    const hosts = new Set();
    for (const p of this.pages.values()) if (p.terms.includes(t)) hosts.add(p.host);
    return hosts.size;
  }

  boost(term) {
    const n = this.sitesFor(term);
    return n >= 2 ? Math.min(2, 1 + 0.35 * (n - 1)) : 1;
  }

  // The running topic: words on pages from 2 or more sites first, then words
  // on 2 or more pages. Empty until there is something recurring.
  topic(limit = 8, banned = []) {
    const skip = new Set(banned.map((b) => String(b).toLowerCase()));
    const count = new Map();
    const sites = new Map();
    for (const p of this.pages.values()) {
      for (const t of p.terms) {
        count.set(t, (count.get(t) || 0) + 1);
        if (!sites.has(t)) sites.set(t, new Set());
        sites.get(t).add(p.host);
      }
    }
    return [...count.entries()]
      .filter(([t, n]) => n >= 2 && !skip.has(t))
      .map(([t, n]) => ({ term: t, score: sites.get(t).size * 10 + n, kind: "topic", from: "topic" }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

// Fewer real words than this (after interface text and site furniture are left
// out) and the page is "thin": a home screen, feed, search box or sign-in wall.
const THIN_WORDS = 20;

// Bot checks and access blocks (Cloudflare, DataDome, Akamai and similar).
const BLOCKED = /^(just a moment|attention required|access (is )?(temporarily )?(restricted|denied)|access to this page has been denied|are you a robot|verify you are human|checking (if the site connection is secure|your browser)|please verify you are a human|pardon our interruption|request blocked|you have been blocked|sorry, you have been blocked|too many requests|unusual traffic)/i;

function isBlockedPage(page) {
  const lines = [page?.title, ...(page?.headings || []), ...(page?.blocks || []).slice(0, 6)].map(clean);
  return lines.some((l) => l && BLOCKED.test(l)) || /captcha-delivery\.com|challenges\.cloudflare\.com/.test(String(page?.text || ""));
}

/**
 * Rank keywords for a page.
 * @param {object} page  output of extractPage()
 * @param {object} opts  { context: KeywordContext, banned: string[], limit, df (older SessionDF) }
 * @returns {{ranked: {term, score, kind, from}[], thin: boolean, words: number}}
 */
function analyzePage(page, opts = {}) {
  const banned = new Set((opts.banned || []).map((b) => b.toLowerCase()));
  const extraStop = siteStopwords(page);
  const ctx = opts.context || null;
  const url = page?.url || "";
  const host = hostOf(url);
  const furniture = ctx ? ctx.furniture(host, url) : new Set();
  const siteNames = ctx ? ctx.siteNames(host, url) : new Set();
  const rawNames = withoutUiGraphics(page?.names);
  const pageNames = rawNames.filter((n) => !siteNames.has(clean(n).toLowerCase()));
  const noShortcuts = (t) => clean(String(t || "").replace(SHORTCUT_TEXT, " "));

  // Body text: keep blocks that are neither interface text nor site furniture.
  const allBlocks = Array.isArray(page?.blocks) ? page.blocks.map(clean).filter(Boolean) : null;
  const kept = allBlocks ? allBlocks.filter((b) => !furniture.has(blockKey(b)) && !isInterfaceText(b)).map(noShortcuts).filter(Boolean) : null;
  const headings = (page?.headings || []).map(clean).filter((h) => h && !furniture.has(blockKey(h)) && !isInterfaceText(h, 4)).map(noShortcuts).filter(Boolean);
  const desc = clean(page?.description);
  const description = desc && !furniture.has("desc:" + blockKey(desc)) ? desc : "";
  const bodyText = kept ? kept.join(" . ") : noShortcuts(page?.text);

  const fields = {
    selection: clean(page?.selection),
    focus: clean(page?.focus),
    title: coreTitle(page?.title),
    headings: headings.join(" . "),
    description,
    names: pageNames.join(" . "),
    text: bodyText,
    media: withoutUiGraphics([...(page?.mediaMeta || []), ...(page?.mediaLinks || [])])
      .map((m) => m.split(" | ").filter((part) => !siteNames.has(clean(part).toLowerCase())).join(" | "))
      .filter(Boolean)
      .join(" . "),
  };

  const words = tokens(`${fields.text} ${fields.headings} ${fields.focus}`, extraStop).length;
  const blocked = isBlockedPage(page);
  // A page with a real title of its own (a video, an image, a short post) is
  // not thin even with little text; "YouTube" or "Home" alone is.
  const titleWords = tokens(fields.title, extraStop).length;
  const thin = blocked || (!fields.selection && !fields.focus && words < THIN_WORDS && titleWords < 2);

  // Words written with a capital letter in mid-sentence are names ("Apple",
  // "Fire" in "Light No Fire"), so being a common English word costs less.
  const caps = new Map();
  for (const text of [bodyText, fields.headings, fields.selection]) {
    for (const m of String(text).matchAll(TOKEN_RE)) {
      const t = normToken(m[0]);
      const before = String(text).slice(Math.max(0, m.index - 2), m.index);
      const sentenceStart = m.index === 0 || /[.!?:]\s*$|^\s*$/.test(before);
      if (sentenceStart) continue;
      const c = caps.get(t) || [0, 0];
      c[1]++;
      if (/^\p{Lu}/u.test(m[0])) c[0]++;
      caps.set(t, c);
    }
  }
  const nameLike = (t) => {
    const c = caps.get(t);
    return Boolean(c && c[0] >= 1 && c[0] / c[1] >= 0.6);
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
  if (opts.df) opts.df.add(url, [...tf.keys()]);

  const weightOf = (t) => {
    let r = rarityWeight(t);
    if (nameLike(t)) r = Math.max(r, 0.9);
    if (COMMON.has(t)) r = Math.min(r, 0.5);
    if (SHOP.has(t)) r = Math.min(r, 0.2);
    return r;
  };

  const scored = new Map();
  for (const [t, s] of tf) {
    if (banned.has(t)) continue;
    let score = s * weightOf(t) * (opts.df ? opts.df.idf(t) : 1);
    if (t.length >= 7) score *= 1.1;
    if (ctx) score *= ctx.boost(t);
    scored.set(t, { term: t, score, kind: "term", from: from.get(t) });
  }

  // 2. Multi-word names. A phrase that recurs absorbs its member words (K5).
  const phraseCount = new Map();
  const phraseCase = new Map();
  const addPhrases = (text, w) => {
    for (const p of phrasesFrom(text)) {
      if (isInterfaceText(p, 6)) continue;
      const key = p.toLowerCase();
      phraseCount.set(key, (phraseCount.get(key) || 0) + w);
      if (!phraseCase.has(key)) phraseCase.set(key, p);
    }
  };
  addPhrases(fields.selection, 6);
  addPhrases(fields.focus, 3);
  addPhrases(page?.title, 4);
  addPhrases(fields.headings, 3);
  addPhrases(fields.names, 2);
  addPhrases(bodyText, 1);
  // The site's own names (the signed-in user's name) score only from the
  // title, headings or a selection, never from menus and body text.
  for (const key of siteNames) {
    const inMain = [page?.title, fields.headings, fields.selection].some((t) => String(t || "").toLowerCase().includes(key));
    if (!inMain) phraseCount.delete(key);
  }
  for (const n of pageNames) {
    const key = clean(n).toLowerCase();
    if (key.includes(" ") && !isInterfaceText(n, 6)) {
      phraseCount.set(key, (phraseCount.get(key) || 0) + 2);
      if (!phraseCase.has(key)) phraseCase.set(key, clean(n));
    }
  }

  for (const [key, weight] of phraseCount) {
    if (weight < 2 || banned.has(key)) continue;
    const parts = tokens(key, extraStop);
    if (parts.length < 2) continue;
    const memberScores = parts.map((p) => scored.get(p)?.score || 0);
    let score = weight + Math.max(...memberScores) * 0.9;
    // A "name" made only of everyday words ("Get The App") is usually interface.
    if (Math.max(...parts.map((p) => rarityWeight(p))) < 0.5) score *= 0.4;
    if (ctx) score *= ctx.boost(key);
    scored.set(key, { term: phraseCase.get(key), score, kind: "phrase", from: "names" });
    for (const p of parts) {
      const s = scored.get(p);
      if (s) s.score *= 0.3; // member words drop below the phrase
    }
  }

  const limit = opts.limit || 12;
  const ordered = [...scored.values()].sort((a, b) => b.score - a.score);
  // Drop single words already covered by a higher-ranked phrase ("marie" under "Marie Curie").
  const covered = new Set();
  const ranked = [];
  for (const r of ordered) {
    if (r.kind === "term" && covered.has(r.term)) continue;
    if (r.kind === "phrase") for (const p of tokens(r.term, new Set())) covered.add(p);
    ranked.push(r);
    if (ranked.length >= limit) break;
  }

  if (ctx && opts.learn !== false) {
    const keys = (allBlocks || []).map(blockKey);
    for (const h of page?.headings || []) keys.push(blockKey(h));
    if (desc) keys.push("desc:" + blockKey(desc));
    ctx.rememberBlocks(host, url, keys);
    ctx.rememberNames(host, url, rawNames);
    if (!thin) ctx.rememberTopic(host, url, ranked.slice(0, 8).map((r) => r.term));
  }
  return { ranked: blocked ? [] : ranked, thin, blocked, words };
}

// Older entry point: just the ranked list.
function rankTerms(page, opts = {}) {
  return analyzePage(page, opts).ranked;
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

module.exports = { rankTerms, analyzePage, isBlockedPage, KeywordContext, isInterfaceText, buildQueries, overlap, coreTitle, SessionDF, tokens, phrasesFrom };
