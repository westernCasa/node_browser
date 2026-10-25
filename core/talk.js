// Talk, stage 1 of the social layer plan (S01-S03): existing discussion of
// the page being read, from Hacker News and Bluesky, plus a Reddit search link.
// No accounts and no NODE server.
//
// Privacy: NODE looks a page up only when the user opens Talk, and only for
// pages that are not private: no sign-in, account, payment or banking pages,
// no local or private network addresses, nothing a site rule turned off. The
// page's address (cleaned of tracking parameters) goes to Hacker News's search
// (Algolia) and to Bluesky's public search. The UI says so.
//
// Platform-neutral: the caller passes getJson(url) (desktop: core/net.js).

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref|ref_src|ref_url|si|spm|_hsenc|_hsmi|yclid|s_cid|cmpid)$/i;
const { isSensitiveUrl } = require("./urls");

/** The address used for lookups: no fragment, no tracking parameters, no trailing slash. */
function cleanUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || ""));
  } catch (_) {
    return "";
  }
  if (!/^https?:$/.test(u.protocol)) return "";
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
  return u.href;
}

function isPrivateHost(h) {
  h = String(h || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".local") || h.endsWith(".localhost") || h.endsWith(".internal") || !h.includes(".")) return true;
  const m = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 127 || a === 10 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return h === "::1" || /^f[cde]/.test(h);
}

/** Why a page is not looked up, or "" when it can be. */
function whyNot(url, rule = {}) {
  const clean = cleanUrl(url);
  if (!clean) return "Talk works on web pages (http and https) only.";
  const u = new URL(clean);
  if (isPrivateHost(u.hostname)) return "Pages on this computer or a private network are never looked up.";
  if (isSensitiveUrl(u.href)) return "Sign-in, account, payment and banking pages are never looked up.";
  if (rule.suggest === false || rule.talk === false) return "A site rule turns Talk off for this site.";
  return "";
}

const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

async function hackerNews(url, getJson) {
  const q = new URL("https://hn.algolia.com/api/v1/search");
  q.searchParams.set("query", url);
  q.searchParams.set("restrictSearchableAttributes", "url");
  q.searchParams.set("tags", "story");
  q.searchParams.set("hitsPerPage", "10");
  const data = await getJson(q.href);
  const hits = Array.isArray(data?.hits) ? data.hits : [];
  // Algolia matches words of the address; keep stories whose address is this page.
  const same = (a) => cleanUrl(a).replace(/^https?:\/\/(www\.)?/, "") === url.replace(/^https?:\/\/(www\.)?/, "");
  return hits
    .filter((h) => h?.objectID && same(h.url))
    .map((h) => ({
      source: "Hacker News",
      title: String(h.title || "Discussion"),
      url: `https://news.ycombinator.com/item?id=${encodeURIComponent(h.objectID)}`,
      points: num(h.points),
      comments: num(h.num_comments),
      author: String(h.author || ""),
      at: num(h.created_at_i) * 1000,
    }))
    .sort((a, b) => b.comments - a.comments);
}

async function bluesky(url, getJson) {
  const q = new URL("https://api.bsky.app/xrpc/app.bsky.feed.searchPosts");
  q.searchParams.set("q", new URL(url).hostname);
  q.searchParams.set("url", url);
  q.searchParams.set("sort", "top");
  q.searchParams.set("limit", "15");
  const data = await getJson(q.href);
  const posts = Array.isArray(data?.posts) ? data.posts : [];
  return posts
    .filter((p) => p?.uri && p?.author?.handle)
    .map((p) => ({
      source: "Bluesky",
      text: String(p.record?.text || "").slice(0, 500),
      author: String(p.author.displayName || p.author.handle),
      handle: String(p.author.handle),
      url: `https://bsky.app/profile/${encodeURIComponent(p.author.handle)}/post/${encodeURIComponent(String(p.uri).split("/").pop())}`,
      likes: num(p.likeCount),
      comments: num(p.replyCount),
      at: Date.parse(p.indexedAt || p.record?.createdAt || "") || 0,
    }));
}

function redditSearch(url) {
  return `https://www.reddit.com/search/?q=${encodeURIComponent(`url:${url}`)}`;
}

/**
 * Discussions of one page. Each source fails on its own: an error in one
 * leaves the other's results.
 */
async function discussions(rawUrl, { getJson, rule = {} } = {}) {
  const reason = whyNot(rawUrl, rule);
  if (reason) return { url: cleanUrl(rawUrl), off: reason, hn: [], bluesky: [], errors: {} };
  const url = cleanUrl(rawUrl);
  const errors = {};
  const [hn, bsky] = await Promise.all([
    hackerNews(url, getJson).catch((e) => ((errors.hn = String(e?.message || e)), [])),
    bluesky(url, getJson).catch((e) => ((errors.bluesky = /403|401/.test(String(e?.message || e)) ? "Bluesky search is not available right now." : String(e?.message || e)), [])),
  ]);
  return { url, off: "", hn, bluesky: bsky, reddit: redditSearch(url), errors };
}

module.exports = { discussions, cleanUrl, whyNot, hackerNews, bluesky, redditSearch };
