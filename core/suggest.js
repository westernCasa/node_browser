// Search flow shared by desktop and mobile: keyword queries (keywords.js),
// optional AI queries (ai.js), sources (providers.js Registry), merged results.
// The caller passes the registry and a function returning the AI settings.

const AI = require("./ai");
const { buildQueries } = require("./keywords");

function createSuggest({ registry, getAISettings, ttl = 30 * 60 * 1000 }) {
  // ---- AI query ideas (B20) ----
  // One call per distinct set of inputs, cached 30 min. Requests for the same
  // inputs share one in-flight call (the "reference" search pass starts it,
  // the "all" pass waits for it).
  const aiCache = new Map();
  const aiInflight = new Map();
  const aiState = { lastOk: 0, lastError: "", lastQueries: [] };

  function aiReset() {
    aiCache.clear();
    aiInflight.clear();
    aiState.lastError = "";
  }

  function aiQueries(input) {
    const conf = getAISettings();
    if (!AI.ready(conf)) return Promise.resolve([]);
    const e = AI.endpoint(conf);
    const key = JSON.stringify([conf.provider, e.base, e.model, input.pinned, input.keywords.slice(0, 8), input.title]);
    const hit = aiCache.get(key);
    if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.queries);
    if (aiInflight.has(key)) return aiInflight.get(key);
    const job = AI.expand(input, conf)
      .then((queries) => {
        aiCache.set(key, { at: Date.now(), queries });
        if (aiCache.size > 200) aiCache.delete(aiCache.keys().next().value);
        Object.assign(aiState, { lastOk: Date.now(), lastError: "", lastQueries: queries });
        return queries;
      })
      .catch((err) => {
        aiState.lastError = String(err.message || err);
        return [];
      })
      .finally(() => aiInflight.delete(key));
    aiInflight.set(key, job);
    return job;
  }

  // Settings panel Test button: list models, then try one expansion with sample input.
  async function aiTest(draft) {
    const conf = { ...getAISettings(), ...(draft || {}), enabled: true };
    const out = { ok: false, models: [], queries: [], error: "" };
    try {
      out.models = await AI.listModels(conf);
    } catch (err) {
      out.error = String(err.message || err);
      return out;
    }
    const model = AI.endpoint(conf).model;
    if (out.models.length && !out.models.includes(model)) {
      out.error = `Model "${model}" is not on this server. Available: ${out.models.slice(0, 12).join(", ")}`;
      return out;
    }
    try {
      out.queries = await AI.expand({ pinned: [], keywords: ["sourdough", "starter", "hydration", "rye"], title: "Why sourdough starters fail" }, conf);
      out.ok = true;
    } catch (err) {
      out.error = String(err.message || err);
    }
    return out;
  }

  function sameUrl(a, b) {
    const norm = (u) => String(u || "").replace(/#.*$/, "").replace(/\/$/, "").replace(/^http:/, "https:");
    return norm(a) === norm(b);
  }

  // Run several queries and merge the lists round-robin, so each query and each
  // source gets a share of the top results. Web search runs for the first two
  // queries; Wikipedia for all of them.
  // part: "all" (Wikipedia + web) or "reference" (Wikipedia only, B25). A
  // "reference" call also starts the web requests without waiting, so the
  // follow-up "all" call picks them up from the cache or the in-flight request.
  async function runQueries(queries, excludeUrl, part = "all") {
    const jobs = [];
    queries.forEach((q, i) => {
      jobs.push(registry.reference(q).then((r) => r.map((x) => ({ ...x, query: q }))));
      if (i >= 2) return;
      const web = registry.web(q).then((r) => r.map((x) => ({ ...x, query: q })));
      if (part === "all") jobs.push(web);
      else web.catch(() => {});
    });
    const lists = (await Promise.allSettled(jobs)).map((r) => (r.status === "fulfilled" ? r.value : []));
    const merged = [];
    const seen = new Set();
    for (let i = 0; merged.length < 12 && lists.some((l) => l.length > i); i++) {
      for (const list of lists) {
        const item = list[i];
        if (!item?.url || !item.title) continue;
        const key = item.url.replace(/#.*$/, "").replace(/\/$/, "");
        if (seen.has(key) || sameUrl(item.url, excludeUrl)) continue;
        if (/wikipedia\.org\/wiki\/(Main_Page|Special:)/.test(item.url)) continue;
        seen.add(key);
        merged.push(item);
        if (merged.length >= 12) break;
      }
    }
    return { results: merged, notes: registry.notes() };
  }

  // Legacy entry point (Tauri bridge and manual keyword list): one query from the list.
  async function suggest(keywords, excludeUrl) {
    const words = Array.isArray(keywords) ? keywords : String(keywords || "").split(/\s+/);
    const queries = buildQueries({ pinned: [], ranked: words.filter(Boolean) });
    if (!queries.length) return { keywords: [], results: [], queries: [] };
    const { results, notes } = await runQueries(queries, excludeUrl);
    return { keywords: words.slice(0, 8), results, queries, notes };
  }

  // Main entry point (B09): pinned keywords + ranked terms -> short queries -> results.
  async function suggestFor({ pinned = [], ranked = [], title = "", excludeUrl = "", part = "all" } = {}) {
    const base = buildQueries({ pinned, ranked, title });
    if (!base.length) return { results: [], queries: [], notes: [] };
    const terms = ranked.map((r) => (typeof r === "string" ? r : r.term));
    const aiJob = aiQueries({ pinned, keywords: terms, title });
    if (part === "reference") {
      // Fast pass: keyword queries only. The AI call keeps running in the background.
      const { results } = await runQueries(base, excludeUrl, part);
      return { results, queries: base, aiQueries: [], notes: [], part };
    }
    // Full pass: the first keyword query plus up to 2 AI queries (B20). If the
    // AI is off or fails, the keyword queries are used as before.
    const extra = (await aiJob).filter((q) => !base.some((b) => b.toLowerCase() === q.toLowerCase()));
    const queries = extra.length ? [base[0], ...extra.slice(0, 2)] : base;
    const { results, notes } = await runQueries(queries, excludeUrl, part);
    const conf = getAISettings();
    if (conf.enabled && !extra.length && aiState.lastError) notes.push(`AI query ideas unavailable: ${aiState.lastError}`);
    return { results, queries, aiQueries: extra.slice(0, 2), notes, part };
  }

  return { suggest, suggestFor, runQueries, aiQueries, aiTest, aiReset, aiState };
}

module.exports = { createSuggest };
