// Search providers (B15).
// Each provider turns one query into a list of results:
//   [{ url, title, snippet, source, image? }]
// Providers do not fetch directly; they get `ctx.getText` (cached, throttled,
// time-limited) and `ctx.config` (this provider's settings) from main.js.
//
// Two roles:
//   "reference" - Wikipedia. Runs for every query when enabled.
//   "web"       - general web search. For each query the first working web
//                 provider in WEB_ORDER is used; if it fails or returns nothing,
//                 the next one is tried. DuckDuckGo is last, as the fallback.

const WEB_ORDER = ["brave", "searxng", "ddg"];

function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Thrown when a provider should be paused (bad key, rate limit, blocked).
class ProviderError extends Error {
  constructor(message, { cooldownMs = 0 } = {}) {
    super(message);
    this.cooldownMs = cooldownMs;
  }
}

function checkStatus(res, name) {
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError(`${name} rejected the request (HTTP ${res.status}). Check the key or URL.`, { cooldownMs: 30 * 60 * 1000 });
  }
  if (res.status === 429) throw new ProviderError(`${name} rate limit reached.`, { cooldownMs: 5 * 60 * 1000 });
  if (!res.ok) throw new ProviderError(`${name} returned HTTP ${res.status}.`, { cooldownMs: 60 * 1000 });
}

function parseJson(text, name) {
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new ProviderError(`${name} did not return JSON.`, { cooldownMs: 5 * 60 * 1000 });
  }
}

const PROVIDERS = {
  wikipedia: {
    id: "wikipedia",
    label: "Wikipedia",
    role: "reference",
    fields: [{ key: "lang", label: "Language code", placeholder: "en" }],
    defaults: { enabled: true, lang: "en" },
    ready: () => true,
    async search(query, { getText, config }) {
      const lang = /^[a-z-]{2,12}$/.test(config.lang || "") ? config.lang : "en";
      const url =
        `https://${lang}.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=` +
        encodeURIComponent(query) +
        "&gsrlimit=5&prop=pageimages|extracts|info&inprop=url&exintro=1&explaintext=1&exchars=300&pithumbsize=640&format=json";
      const res = await getText(url);
      checkStatus(res, "Wikipedia");
      const pages = Object.values(parseJson(res.text, "Wikipedia").query?.pages || {});
      pages.sort((a, b) => (a.index || 0) - (b.index || 0));
      return pages.map((p) => ({
        url: p.fullurl || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
        title: p.title,
        snippet: (p.extract || "").slice(0, 220),
        source: "wiki",
        image: p.thumbnail?.source || "",
      }));
    },
  },

  brave: {
    id: "brave",
    label: "Brave Search API",
    role: "web",
    fields: [{ key: "key", label: "API key", secret: true, placeholder: "From api-dashboard.search.brave.com" }],
    defaults: { enabled: false, key: "" },
    ready: (c) => Boolean(c.key),
    async search(query, { getText, config }) {
      const url = "https://api.search.brave.com/res/v1/web/search?count=8&q=" + encodeURIComponent(query);
      const res = await getText(url, {
        headers: { Accept: "application/json", "X-Subscription-Token": config.key },
        cacheKey: "brave " + query,
      });
      checkStatus(res, "Brave");
      const data = parseJson(res.text, "Brave");
      return (data.web?.results || []).slice(0, 8).map((r) => ({
        url: r.url,
        title: decodeEntities(r.title),
        snippet: decodeEntities(r.description),
        source: "brave",
        image: r.thumbnail?.src || "",
      }));
    },
  },

  searxng: {
    id: "searxng",
    label: "SearXNG",
    role: "web",
    fields: [{ key: "url", label: "Instance URL", placeholder: "https://searx.example.org" }],
    defaults: { enabled: false, url: "" },
    ready: (c) => /^https?:\/\/[^\s/]+/i.test(c.url || ""),
    async search(query, { getText, config }) {
      const base = String(config.url).replace(/\/+$/, "");
      const res = await getText(`${base}/search?format=json&q=${encodeURIComponent(query)}`, {
        headers: { Accept: "application/json" },
      });
      if (res.status === 403) {
        throw new ProviderError("SearXNG refused JSON output. Enable the json format in the instance's settings.yml.", {
          cooldownMs: 30 * 60 * 1000,
        });
      }
      checkStatus(res, "SearXNG");
      const data = parseJson(res.text, "SearXNG");
      return (data.results || []).slice(0, 8).map((r) => ({
        url: r.url,
        title: decodeEntities(r.title),
        snippet: decodeEntities(r.content),
        source: "searxng",
        image: r.img_src || r.thumbnail || "",
      }));
    },
  },

  ddg: {
    id: "ddg",
    label: "DuckDuckGo (no key, fallback)",
    role: "web",
    fields: [],
    defaults: { enabled: true },
    ready: () => true,
    async search(query, { getText }) {
      const res = await getText("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query), {
        headers: { Accept: "text/html" },
      });
      const html = res.text || "";
      // DuckDuckGo answers clients it is throttling with 202/403 or a challenge page.
      if (res.status === 202 || res.status === 403 || /anomaly-modal|challenge-form/i.test(html)) {
        throw new ProviderError("DuckDuckGo is limiting requests.", { cooldownMs: 10 * 60 * 1000 });
      }
      checkStatus(res, "DuckDuckGo");
      const results = [];
      const re =
        /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/)/gi;
      let m;
      while ((m = re.exec(html)) && results.length < 8) {
        let href = decodeEntities(m[1]);
        try {
          const u = new URL(href, "https://duckduckgo.com/");
          href = u.pathname === "/l/" && u.searchParams.get("uddg") ? u.searchParams.get("uddg") : u.href;
        } catch (_) {}
        if (/duckduckgo\.com\/y\.js/.test(href)) continue; // ads
        results.push({ url: href, title: decodeEntities(m[2]), snippet: decodeEntities(m[3] || ""), source: "search" });
      }
      return results;
    },
  },
};

function defaultSettings() {
  const providers = {};
  for (const p of Object.values(PROVIDERS)) providers[p.id] = { ...p.defaults };
  return { providers };
}

/**
 * Search registry: tracks each provider's health and picks which to call.
 * `getText` comes from main.js; `getConfig(id)` returns the provider's settings.
 */
class Registry {
  constructor({ getText, getConfig }) {
    this.getText = getText;
    this.getConfig = getConfig;
    this.health = {}; // id -> { cooldownUntil, lastError, lastOk, lastCount }
  }

  status() {
    return Object.values(PROVIDERS).map((p) => {
      const config = this.getConfig(p.id);
      const h = this.health[p.id] || {};
      const paused = (h.cooldownUntil || 0) > Date.now();
      return {
        id: p.id,
        label: p.label,
        role: p.role,
        enabled: Boolean(config.enabled),
        ready: p.ready(config),
        paused,
        pausedFor: paused ? Math.ceil((h.cooldownUntil - Date.now()) / 60000) : 0,
        lastError: h.lastError || "",
        lastOk: h.lastOk || 0,
        lastCount: h.lastCount ?? null,
      };
    });
  }

  usable(id) {
    const p = PROVIDERS[id];
    const config = this.getConfig(id);
    return config.enabled && p.ready(config) && !((this.health[id]?.cooldownUntil || 0) > Date.now());
  }

  async run(id, query, { ignoreCooldown = false } = {}) {
    const p = PROVIDERS[id];
    const h = (this.health[id] = this.health[id] || {});
    if (!ignoreCooldown && (h.cooldownUntil || 0) > Date.now()) return [];
    try {
      const out = await p.search(query, { getText: this.getText, config: this.getConfig(id) });
      h.lastOk = Date.now();
      h.lastError = "";
      h.lastCount = out.length;
      h.cooldownUntil = 0;
      return out;
    } catch (err) {
      h.lastError = String(err.message || err);
      if (err.cooldownMs) h.cooldownUntil = Date.now() + err.cooldownMs;
      throw err;
    }
  }

  // Reference provider results for one query.
  async reference(query) {
    if (!this.usable("wikipedia")) return [];
    return this.run("wikipedia", query).catch(() => []);
  }

  // First web provider that returns results for this query.
  async web(query) {
    for (const id of WEB_ORDER) {
      if (!this.usable(id)) continue;
      try {
        const out = await this.run(id, query);
        if (out.length) return out;
      } catch (_) {
        // try the next provider
      }
    }
    return [];
  }

  // One-off check used by the settings panel's Test button.
  async test(id) {
    const started = Date.now();
    try {
      const out = await this.run(id, "solar eclipse", { ignoreCooldown: true });
      return { ok: true, count: out.length, ms: Date.now() - started, sample: out[0]?.title || "" };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  }

  // Clear a provider's pause and last error (after its settings change).
  reset(id) {
    delete this.health[id];
  }

  // A note for the status line, only when web search is unavailable.
  notes() {
    if (WEB_ORDER.some((id) => this.usable(id))) return [];
    const paused = this.status().filter((s) => s.role === "web" && s.enabled && s.ready && s.paused);
    const why = paused.map((s) => `${s.lastError} Retrying in ${s.pausedFor} min.`);
    return ["Web search unavailable, showing Wikipedia only.", ...why, "Add another source under Sources."];
  }
}

module.exports = { PROVIDERS, WEB_ORDER, Registry, ProviderError, defaultSettings, decodeEntities };
