// AI query ideas (B20).
// Turns pinned keywords, the page's top keywords and its title into a few
// extra search queries, using any OpenAI-compatible chat API:
//   - "local": Ollama (http://localhost:11434/v1) or LM Studio (http://localhost:1234/v1)
//   - "grok":  xAI (https://api.x.ai/v1), needs an API key
// No Electron code here; main.js passes in `fetch` and the settings.
//
// What is sent: pinned keywords, up to 8 page keywords, and the page title.
// Never the page text or the URL.

const { timeoutSignal } = require("./compat");

const GROK_URL = "https://api.x.ai/v1";

const AI_DEFAULTS = {
  enabled: false,
  provider: "local", // "local" | "grok"
  local: { url: "http://localhost:11434/v1", model: "llama3.2" },
  grok: { key: "", model: "grok-4.3" },
};

const SYSTEM_PROMPT = [
  "You help a researcher find the next pages to read.",
  "Given keywords and the title of the page they are reading, write search queries that look for",
  "different angles: background or definitions, related people or organisations, primary sources",
  "or data, and opposing or adjacent views.",
  "Rules: 2 or 3 queries. Each query 2 to 6 words. Plain words, no quotes, no operators, no site: filters.",
  "Keep every query on the same topic as the keywords. Pinned keywords must appear in every query.",
  'Answer with JSON only, in this form: {"queries": ["...", "..."]}',
].join(" ");

function endpoint(settings) {
  if (settings.provider === "grok") {
    return { base: GROK_URL, model: settings.grok?.model || AI_DEFAULTS.grok.model, key: settings.grok?.key || "" };
  }
  const base = String(settings.local?.url || AI_DEFAULTS.local.url).replace(/\/+$/, "");
  return { base, model: settings.local?.model || AI_DEFAULTS.local.model, key: "" };
}

function ready(settings) {
  if (!settings?.enabled) return false;
  const e = endpoint(settings);
  if (settings.provider === "grok") return Boolean(e.key && e.model);
  return /^https?:\/\//i.test(e.base) && Boolean(e.model);
}

function userPrompt({ pinned = [], keywords = [], title = "" }) {
  const lines = [];
  if (pinned.length) lines.push(`Pinned keywords: ${pinned.join(", ")}`);
  if (keywords.length) lines.push(`Page keywords: ${keywords.slice(0, 8).join(", ")}`);
  if (title) lines.push(`Page title: ${String(title).slice(0, 160)}`);
  return lines.join("\n");
}

// Pull a list of queries out of the model's answer, even if it wrapped the
// JSON in prose or a code block, or answered with a plain list.
function parseQueries(text) {
  const raw = String(text || "");
  const tryJson = (s) => {
    try {
      const v = JSON.parse(s);
      if (Array.isArray(v)) return v;
      if (Array.isArray(v?.queries)) return v.queries;
    } catch (_) {}
    return null;
  };
  let list = tryJson(raw.trim());
  if (!list) {
    const obj = raw.match(/\{[\s\S]*\}/);
    if (obj) list = tryJson(obj[0]);
  }
  if (!list) {
    const arr = raw.match(/\[[\s\S]*\]/);
    if (arr) list = tryJson(arr[0]);
  }
  if (!list) {
    // Plain list fallback: only lines that look like list items, not sentences.
    list = raw
      .split("\n")
      .filter((l) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l))
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
      .filter((l) => l && !/[.?!:{}]$/.test(l) && l.split(/\s+/).length <= 8);
  }
  return clean(list);
}

function clean(list) {
  const seen = new Set();
  const out = [];
  for (const q of list || []) {
    const s = String(q || "")
      .replace(/["“”]/g, "")
      .replace(/\b(site|inurl|intitle):\S+/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    const words = s.split(" ").filter(Boolean);
    if (words.length < 2 || words.length > 8) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(words.slice(0, 6).join(" "));
    if (out.length >= 3) break;
  }
  return out;
}

class AIError extends Error {}

// Grok models think before they answer, at "high" effort unless told
// otherwise, and the thinking counts against max_tokens. For short jobs like
// query ideas that is slow (often over 12 s) and can leave no room for the
// answer. So for Grok: ask for "low" effort and leave room for the thinking.
const GROK_THINKING_ROOM = 2000;

function chatBody(settings, body) {
  if (settings.provider !== "grok") return body;
  return { ...body, reasoning_effort: "low", max_tokens: (body.max_tokens || 0) + GROK_THINKING_ROOM };
}

// POST /chat/completions. A model that does not accept reasoning_effort
// answers HTTP 400; then send the request once more without it.
async function postChat(doFetch, e, settings, body, ms) {
  const headers = { "Content-Type": "application/json" };
  if (e.key) headers.Authorization = `Bearer ${e.key}`;
  const send = (b) => doFetch(`${e.base}/chat/completions`, { method: "POST", headers, body: JSON.stringify(b), signal: timeoutSignal(ms) });
  const full = chatBody(settings, body);
  const res = await send(full);
  if (res.status === 400 && full.reasoning_effort) {
    const { reasoning_effort, ...rest } = full;
    return send(rest);
  }
  return res;
}

function describeHttpError(status, provider) {
  if (status === 401 || status === 403) return provider === "grok" ? "Grok rejected the API key." : "The local server refused the request.";
  if (status === 404) return provider === "grok" ? "Grok does not know this model name. Use Test to list models." : "Model or address not found. Is the model pulled (for Ollama: ollama pull <model>)?";
  if (status === 429) return "Rate limit reached. Try again in a minute.";
  return `The AI server returned HTTP ${status}.`;
}

/**
 * Ask the model for extra queries.
 * @returns {Promise<string[]>} up to 3 queries
 */
async function expand(input, settings, { fetch: doFetch = fetch, timeout } = {}) {
  const e = endpoint(settings);
  let res;
  try {
    res = await postChat(
      doFetch,
      e,
      settings,
      {
        model: e.model,
        temperature: 0.4,
        max_tokens: 200,
        stream: false,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt(input) },
        ],
      },
      // Local models can be slow to load the first time; Grok thinks first.
      timeout || (settings.provider === "grok" ? 30000 : 25000)
    );
  } catch (err) {
    if (err?.name === "TimeoutError") throw new AIError("The AI server took too long to answer.");
    throw new AIError(settings.provider === "grok" ? "Could not reach Grok." : `Could not reach the local model at ${e.base}. Is Ollama or LM Studio running?`);
  }
  if (!res.ok) throw new AIError(describeHttpError(res.status, settings.provider));
  const data = await res.json().catch(() => ({}));
  const text = data?.choices?.[0]?.message?.content || "";
  const pins = (input.pinned || []).map((p) => String(p).trim()).filter(Boolean);
  const queries = parseQueries(text).map((q) => {
    // Pinned keywords must be in every query; add any the model left out.
    const missing = pins.filter((p) => !q.toLowerCase().includes(p.toLowerCase()));
    return [...missing, q].join(" ").split(" ").slice(0, 7).join(" ");
  });
  if (!queries.length) throw new AIError("The model answered, but not with usable queries.");
  return queries;
}

/** List model IDs the server offers (GET /models). */
async function listModels(settings, { fetch: doFetch = fetch } = {}) {
  const e = endpoint(settings);
  const headers = {};
  if (e.key) headers.Authorization = `Bearer ${e.key}`;
  let res;
  try {
    res = await doFetch(`${e.base}/models`, { headers, signal: timeoutSignal(8000) });
  } catch (_) {
    throw new AIError(settings.provider === "grok" ? "Could not reach Grok." : `Could not reach the local model at ${e.base}. Is Ollama or LM Studio running?`);
  }
  if (!res.ok) throw new AIError(describeHttpError(res.status, settings.provider));
  const data = await res.json().catch(() => ({}));
  return (data?.data || data?.models || []).map((m) => m.id || m.name).filter(Boolean);
}

module.exports = { AI_DEFAULTS, GROK_URL, chatBody, postChat, expand, listModels, ready, parseQueries, userPrompt, endpoint, AIError };
