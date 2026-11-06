// How a trail page was reached (B83): the link or query that led there, and
// whether NODE chose it. No platform imports; the window loads this file too
// (as NodeProvenance) for the line on canvas cards.
//
// via: { how, query?, host? }
//   link       followed a link on another page (host: that page's site)
//   search     opened from web search results, or a search NODE ran for you (query)
//   typed      an address typed in the address bar, CommandBar or canvas
//   suggested  opened from NODE's suggestions (query: the keyword or search it came from)
//   agent      opened by the research agent
//   next       the site went on to the next video or track by itself (host)
// played: NODE's autoplay started the page's video or audio. A separate mark,
// since a page can be reached any of the ways above and then played by NODE.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NodeProvenance = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const HOWS = ["link", "search", "typed", "suggested", "agent", "next"];
  // Pages NODE or the site chose, not the person.
  const CHOSEN_BY_NODE = new Set(["suggested", "agent", "next"]);

  // Search result pages NODE knows, and the parameter that holds the query.
  const ENGINES = [
    [/(^|\.)search\.brave\.com$/, "/search", "q"],
    [/(^|\.)google\.[a-z.]+$/, "/search", "q"],
    [/(^|\.)duckduckgo\.com$/, "/", "q"],
    [/(^|\.)bing\.com$/, "/search", "q"],
    [/(^|\.)search\.yahoo\.com$/, "/search", "p"],
    [/(^|\.)kagi\.com$/, "/search", "q"],
    [/(^|\.)ecosia\.org$/, "/search", "q"],
    [/(^|\.)startpage\.com$/, "/", "query"],
  ];

  const clip = (s, n = 120) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (_) {
      return "";
    }
  }

  // The query when url is a web search results page, else "".
  function searchQuery(url) {
    let u;
    try {
      u = new URL(url);
    } catch (_) {
      return "";
    }
    const host = u.hostname.replace(/^www\./, "");
    for (const [re, path, param] of ENGINES) {
      if (!re.test(host) || !u.pathname.startsWith(path)) continue;
      const q = u.searchParams.get(param);
      if (q) return clip(q);
    }
    return "";
  }

  // Keeps only known fields, short.
  function clean(via) {
    if (!via || !HOWS.includes(via.how)) return null;
    const out = { how: via.how };
    if (via.query && (via.how === "search" || via.how === "suggested")) out.query = clip(via.query);
    if (via.host && (via.how === "link" || via.how === "next")) out.host = clip(via.host, 80);
    return out;
  }

  // A page opened from another page: a link, or a result of a web search.
  function fromPage(fromUrl) {
    if (!fromUrl) return null;
    const q = searchQuery(fromUrl);
    if (q) return { how: "search", query: q };
    const host = hostOf(fromUrl);
    return host ? { how: "link", host } : null;
  }

  // The text on a card, in Replay and in a trail file. Lower case; the
  // caller capitalises when it starts a line.
  function viaText(via, played) {
    const v = clean(via);
    const parts = [];
    if (v) {
      const q = v.query ? ` “${v.query}”` : "";
      parts.push(
        {
          link: `link from ${v.host || "another page"}`,
          search: `search${q}`,
          typed: "typed address",
          suggested: `suggested by NODE${v.query ? ` for${q}` : ""}`,
          agent: "found by agent",
          next: `auto-played next${v.host ? ` on ${v.host}` : ""}`,
        }[v.how]
      );
    }
    if (played) parts.push("played by NODE");
    return parts.join(" · ");
  }

  // Reads viaText() back. Returns { via, played }.
  function parseViaText(text) {
    let t = String(text || "").trim();
    let played = false;
    if (/(^|\s·\s)played by NODE$/.test(t)) {
      played = true;
      t = t.replace(/(^|\s·\s)played by NODE$/, "").trim();
    }
    const q = (s) => (s.match(/^“(.*)”$/) || [])[1];
    let via = null;
    let m;
    if ((m = t.match(/^link from (.+)$/))) via = m[1] === "another page" ? { how: "link" } : { how: "link", host: m[1] };
    else if ((m = t.match(/^search(?: (“.*”))?$/))) via = m[1] ? { how: "search", query: q(m[1]) } : { how: "search" };
    else if (t === "typed address") via = { how: "typed" };
    else if ((m = t.match(/^suggested by NODE(?: for (“.*”))?$/))) via = m[1] ? { how: "suggested", query: q(m[1]) } : { how: "suggested" };
    else if (t === "found by agent") via = { how: "agent" };
    else if ((m = t.match(/^auto-played next(?: on (.+))?$/))) via = m[1] ? { how: "next", host: m[1] } : { how: "next" };
    return { via, played };
  }

  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

  return { HOWS, CHOSEN_BY_NODE, searchQuery, fromPage, clean, viaText, parseViaText, cap, hostOf };
});
