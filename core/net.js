// Network layer (B12, B13). Every outbound GET goes through getText():
// results are cached (30 min by default), identical requests in flight are
// shared, each host has a minimum gap between requests, a limited number of
// requests run at once, and every request times out.
// Platform-neutral: the caller passes a fetch function.

const { timeoutSignal } = require("./compat");

const DEFAULT_GAPS = { "html.duckduckgo.com": 2500, "api.search.brave.com": 1100, default: 400 };

function createNet({ fetch: doFetch, userAgent = "", ttl = 30 * 60 * 1000, max = 500, gaps = DEFAULT_GAPS, maxParallel = 4 } = {}) {
  const cache = new Map();
  const inflight = new Map();
  const hostNext = new Map();
  const waiting = [];
  let running = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function cacheGet(key) {
    const hit = cache.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > ttl) {
      cache.delete(key);
      return undefined;
    }
    return hit.value;
  }

  function cacheSet(key, value) {
    cache.delete(key);
    cache.set(key, { at: Date.now(), value });
    if (cache.size > max) cache.delete(cache.keys().next().value);
  }

  async function slot() {
    if (running < maxParallel) {
      running++;
      return;
    }
    await new Promise((r) => waiting.push(r));
    running++;
  }

  function release() {
    running--;
    const next = waiting.shift();
    if (next) next();
  }

  async function hostTurn(host) {
    const gap = gaps[host] ?? gaps.default ?? 0;
    const now = Date.now();
    const at = Math.max(now, hostNext.get(host) || 0);
    hostNext.set(host, at + gap);
    if (at > now) await sleep(at - now);
  }

  function hostOf(url) {
    const m = /^[a-z]+:\/\/([^/?#:]+)/i.exec(url);
    return m ? m[1].toLowerCase() : "";
  }

  async function getText(url, { headers = {}, maxBytes = 300000, timeout = 10000, cacheKey } = {}) {
    const key = "GET " + (cacheKey || url);
    const hit = cacheGet(key);
    if (hit) return hit;
    if (inflight.has(key)) return inflight.get(key);
    const job = (async () => {
      await slot();
      try {
        await hostTurn(hostOf(url));
        const res = await doFetch(url, {
          headers: userAgent ? { "User-Agent": userAgent, ...headers } : headers,
          redirect: "follow",
          signal: timeoutSignal(timeout),
        });
        const text = (await res.text()).slice(0, maxBytes);
        const out = { ok: res.ok, status: res.status, url: res.url || url, text };
        if (res.ok) cacheSet(key, out);
        return out;
      } finally {
        release();
      }
    })();
    inflight.set(key, job);
    try {
      return await job;
    } finally {
      inflight.delete(key);
    }
  }

  return { getText, clear: () => cache.clear(), ttl };
}

module.exports = { createNet, DEFAULT_GAPS };
