// Per-site behaviour rules (B16).
// The user edits rules.json; Scout reloads it on save. No Electron code here.
//
// A rule applies when its "match" matches the page URL. All matching rules are
// merged in file order, so later rules override earlier ones. "*" matches all.
//
// match forms:
//   "example.com"           example.com and all its subdomains
//   "*.example.com"         subdomains only
//   "example.com/watch"     that host (and subdomains) with a path starting /watch
//   "/^https:\\/\\/x/i"     a regular expression against the full URL
//   ["a.com", "b.com"]      any of these

const DEFAULT_RULE = {
  autoplay: "on", // "on" | "muted" | "off"
  sound: "auto", // "auto" (only the active tab) | "on" | "off"
  popups: "gesture", // "gesture" (after a click) | "block" | "allow"
  suggest: true, // false: never read this site for keywords or send its words to search
  mosaic: true, // false: keep this site out of the Mosaic grid unless it is the active tab
  center: true, // false: do not scroll media to the middle of the view when it is clicked
  adblock: true, // false: do not block ads and trackers on this site
  talk: true, // false: never look up discussions of this site's pages (Talk); also off where suggest is false
  extract: { include: [], skip: [] }, // CSS selectors: extra text to read with priority, areas to ignore
};

const ENUMS = {
  autoplay: ["on", "muted", "off"],
  sound: ["auto", "on", "off"],
  popups: ["gesture", "block", "allow"],
};

const DEFAULT_FILE = {
  _help: [
    "NODE site rules. Edit and save; NODE reloads them right away.",
    "Each rule has a 'match' and any of: autoplay (on/muted/off), sound (auto/on/off),",
    "popups (gesture/block/allow), suggest (true/false), mosaic (true/false), center (true/false), adblock (true/false), talk (true/false),",
    "extract.include and extract.skip (lists of CSS selectors).",
    "Rules are applied in order; later matches override earlier ones.",
    "match: 'example.com' (with subdomains), '*.example.com', 'example.com/path', or '/regex/'.",
  ],
  rules: [
    { name: "Default for every site", match: "*", autoplay: "on", sound: "auto", popups: "gesture", suggest: true, mosaic: true },
    {
      name: "Wikipedia: read the article, not the navigation boxes",
      match: "wikipedia.org",
      autoplay: "off",
      extract: { skip: [".navbox", ".reflist", ".mw-references-wrap", "#toc", ".mw-editsection", ".hatnote"] },
    },
    {
      name: "YouTube: read the title and description, skip comments and the sidebar",
      match: ["youtube.com", "youtu.be"],
      extract: {
        include: ["#title h1", "#description-inline-expander", "ytd-text-inline-expander"],
        skip: ["#comments", "#related", "ytd-watch-next-secondary-results-renderer", "#masthead"],
      },
    },
    {
      name: "Sign-in, banking and payments: never read for suggestions, no autoplay",
      match: ["accounts.google.com", "login.microsoftonline.com", "paypal.com", "stripe.com", "chase.com", "bankofamerica.com", "wellsfargo.com", "/\\/(login|signin|sign-in|checkout|account)(\\/|\\?|$)/i"],
      suggest: false,
      autoplay: "off",
      mosaic: false,
    },
  ],
};

function parseRegex(pattern) {
  const m = /^\/(.+)\/([a-z]*)$/.exec(pattern);
  if (!m) return null;
  try {
    return new RegExp(m[1], m[2]);
  } catch {
    return null;
  }
}

function matchOne(pattern, u) {
  if (typeof pattern !== "string" || !pattern) return false;
  if (pattern === "*") return true;
  const re = parseRegex(pattern);
  if (re) return re.test(u.href);
  let p = pattern.toLowerCase().replace(/^https?:\/\//, "");
  const subOnly = p.startsWith("*.");
  if (subOnly) p = p.slice(2);
  const slash = p.indexOf("/");
  const host = slash === -1 ? p : p.slice(0, slash);
  const pathPrefix = slash === -1 ? "" : p.slice(slash);
  const h = u.hostname.toLowerCase().replace(/^www\./, "");
  const hostOk = subOnly ? h.endsWith("." + host) : h === host || h.endsWith("." + host);
  return hostOk && (!pathPrefix || u.pathname.toLowerCase().startsWith(pathPrefix));
}

function matches(rule, url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(u.protocol)) return rule.match === "*";
  const list = Array.isArray(rule.match) ? rule.match : [rule.match];
  return list.some((p) => matchOne(p, u));
}

/** Check a parsed rules file. Returns { rules, errors }. Bad fields are dropped, not fatal. */
function validate(data) {
  const errors = [];
  const out = [];
  const list = Array.isArray(data?.rules) ? data.rules : null;
  if (!list) return { rules: [], errors: ['The file needs a "rules" list.'] };
  list.forEach((r, i) => {
    const label = r?.name ? `"${r.name}"` : `rule ${i + 1}`;
    if (!r || typeof r !== "object") return errors.push(`${label} is not an object.`);
    const okMatch = (m) => typeof m === "string" && m.length > 0 && (!m.startsWith("/") || parseRegex(m));
    const ms = Array.isArray(r.match) ? r.match : [r.match];
    if (!ms.length || !ms.every(okMatch)) return errors.push(`${label}: "match" is missing or has an invalid pattern.`);
    const clean = { name: r.name || "", match: r.match };
    for (const [k, allowed] of Object.entries(ENUMS)) {
      if (r[k] === undefined) continue;
      if (allowed.includes(r[k])) clean[k] = r[k];
      else errors.push(`${label}: "${k}" must be one of ${allowed.join(", ")}.`);
    }
    for (const k of ["suggest", "mosaic", "center", "adblock", "talk"]) {
      if (r[k] === undefined) continue;
      if (typeof r[k] === "boolean") clean[k] = r[k];
      else errors.push(`${label}: "${k}" must be true or false.`);
    }
    if (r.extract !== undefined) {
      const ex = {};
      for (const k of ["include", "skip"]) {
        const v = r.extract?.[k];
        if (v === undefined) continue;
        if (Array.isArray(v) && v.every((x) => typeof x === "string")) ex[k] = v;
        else errors.push(`${label}: "extract.${k}" must be a list of CSS selectors.`);
      }
      clean.extract = ex;
    }
    out.push(clean);
  });
  return { rules: out, errors };
}

/** The effective behaviour for a URL: defaults, then every matching rule in order. */
function resolve(rules, url) {
  const eff = { ...DEFAULT_RULE, extract: { include: [], skip: [] }, matched: [] };
  for (const r of rules) {
    if (!matches(r, url)) continue;
    for (const k of ["autoplay", "sound", "popups", "suggest", "mosaic", "center", "adblock", "talk"]) if (r[k] !== undefined) eff[k] = r[k];
    if (r.extract) {
      eff.extract.include = [...eff.extract.include, ...(r.extract.include || [])];
      eff.extract.skip = [...eff.extract.skip, ...(r.extract.skip || [])];
    }
    if (r.match !== "*") eff.matched.push(r.name || [].concat(r.match).join(", "));
  }
  return eff;
}

module.exports = { DEFAULT_RULE, DEFAULT_FILE, validate, resolve, matches };
