// Ask AI about the current page. Uses the same model settings as AI query
// ideas (core/ai.js): a local model (Ollama, LM Studio) or Grok.
//
// Unlike query ideas, this sends the page's readable text (up to 20,000
// characters), its title and its address to the model, and only when the
// user asks a question. The UI says so next to the question box.

const { endpoint, AIError } = require("./ai");
const { timeoutSignal } = require("./compat");

const PAGE_CHARS = 20000;

const SYSTEM = [
  "You answer questions about the web page the user is reading in their research browser.",
  "Use the page text below as your main source. Quote short phrases from it when they support the answer.",
  "If the page does not contain the answer, say so in one sentence, then answer from general knowledge and say that you did.",
  "Be brief: a few sentences or a short list. Plain language, no headings.",
].join(" ");

/** Whether a model is set up for chat (query ideas do not need to be switched on). */
function canChat(settings) {
  const e = endpoint(settings || {});
  if (settings?.provider === "grok") return Boolean(e.key && e.model);
  return /^https?:\/\//i.test(e.base) && Boolean(e.model);
}

function pageMessage(page) {
  const text = String(page.text || "").slice(0, PAGE_CHARS);
  return [
    `Page title: ${page.title || "(none)"}`,
    `Address: ${page.url || "(unknown)"}`,
    page.selection ? `Text the user selected: ${String(page.selection).slice(0, 1500)}` : "",
    "Page text:",
    text || "(no readable text)",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * One chat completion with the configured model (local or Grok).
 * @returns {Promise<string>} the model's reply
 */
async function complete(messages, settings, { fetch: doFetch = fetch, timeout, maxTokens = 700, temperature = 0.3 } = {}) {
  if (!canChat(settings)) throw new AIError("Set up a model first: Settings → AI (a local model or a Grok key).");
  const e = endpoint(settings);
  const headers = { "Content-Type": "application/json" };
  if (e.key) headers.Authorization = `Bearer ${e.key}`;
  let res;
  try {
    res = await doFetch(`${e.base}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: e.model, temperature, max_tokens: maxTokens, stream: false, messages }),
      signal: timeoutSignal(timeout || (settings.provider === "grok" ? 60000 : 120000)),
    });
  } catch (err) {
    if (err?.name === "TimeoutError") throw new AIError("The AI server took too long to answer.");
    throw new AIError(settings.provider === "grok" ? "Could not reach Grok." : `Could not reach the local model at ${e.base}. Is Ollama or LM Studio running?`);
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new AIError(settings.provider === "grok" ? "Grok rejected the API key." : "The local server refused the request.");
    if (res.status === 404) throw new AIError("Model or address not found. Check the model name in Settings → AI.");
    if (res.status === 429) throw new AIError("Rate limit reached. Try again in a minute.");
    throw new AIError(`The AI server returned HTTP ${res.status}.`);
  }
  const data = await res.json().catch(() => ({}));
  const text = String(data?.choices?.[0]?.message?.content || "").trim();
  if (!text) throw new AIError("The model sent an empty answer.");
  return text;
}

/**
 * Ask a question about a page.
 * @param {{question: string, page: {title, url, text, selection}, history?: {role, content}[]}} input
 *   history: earlier questions and answers about the same page, oldest first.
 * @returns {Promise<string>} the answer
 */
async function askPage({ question, page, history = [] }, settings, { fetch: doFetch = fetch, timeout } = {}) {
  if (!canChat(settings)) throw new AIError("Set up a model first: Settings → AI (a local model or a Grok key).");
  const e = endpoint(settings);
  const headers = { "Content-Type": "application/json" };
  if (e.key) headers.Authorization = `Bearer ${e.key}`;
  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: pageMessage(page) },
    { role: "assistant", content: "I have read the page. What would you like to know?" },
    ...history.slice(-8).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 4000) })),
    { role: "user", content: String(question).slice(0, 2000) },
  ];
  let res;
  try {
    res = await doFetch(`${e.base}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: e.model, temperature: 0.3, max_tokens: 700, stream: false, messages }),
      signal: timeoutSignal(timeout || (settings.provider === "grok" ? 45000 : 90000)),
    });
  } catch (err) {
    if (err?.name === "TimeoutError") throw new AIError("The AI server took too long to answer.");
    throw new AIError(settings.provider === "grok" ? "Could not reach Grok." : `Could not reach the local model at ${e.base}. Is Ollama or LM Studio running?`);
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new AIError(settings.provider === "grok" ? "Grok rejected the API key." : "The local server refused the request.");
    if (res.status === 404) throw new AIError("Model or address not found. Check the model name in Settings → AI.");
    if (res.status === 429) throw new AIError("Rate limit reached. Try again in a minute.");
    throw new AIError(`The AI server returned HTTP ${res.status}.`);
  }
  const data = await res.json().catch(() => ({}));
  const answer = String(data?.choices?.[0]?.message?.content || "").trim();
  if (!answer) throw new AIError("The model sent an empty answer.");
  return answer;
}

module.exports = { askPage, complete, canChat, pageMessage, PAGE_CHARS };
