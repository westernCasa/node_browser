// Ask AI about the current page. Uses the same model settings as AI query
// ideas (core/ai.js): a local model (Ollama, LM Studio) or Grok.
//
// Unlike query ideas, this sends the page's readable text (up to 20,000
// characters), its title and its address to the model, and only when the
// user asks a question. The UI says so next to the question box.

const { endpoint, postChat, AIError } = require("./ai");

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
  let res;
  try {
    res = await postChat(doFetch, e, settings, { model: e.model, temperature, max_tokens: maxTokens, stream: false, messages }, timeout || (settings.provider === "grok" ? 60000 : 120000));
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
  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: pageMessage(page) },
    { role: "assistant", content: "I have read the page. What would you like to know?" },
    ...history.slice(-8).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 4000) })),
    { role: "user", content: String(question).slice(0, 2000) },
  ];
  let res;
  try {
    res = await postChat(doFetch, e, settings, { model: e.model, temperature: 0.3, max_tokens: 700, stream: false, messages }, timeout || (settings.provider === "grok" ? 45000 : 90000));
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

// ---- Several pages at once (B49) ----
// Ask about the tabs in Mosaic or the pages of a research session, and get an
// answer that cites its sources by number, [1] to [n]. Each source is
// { title, url, text }; the text budget is shared between them.

const SOURCES_CHARS = 24000;
const MAX_SOURCES = 10;

const SYSTEM_SOURCES = [
  "You answer questions for a researcher, using the numbered sources below: pages they have open or have read.",
  "After each statement, cite the source or sources it comes from by number in square brackets, like [2] or [1][3].",
  "Use only these sources. If they do not contain the answer, say so in one sentence and do not guess.",
  "When sources disagree, say which says what.",
  "Be brief: a few sentences or a short list. Plain language, no headings.",
].join(" ");

const SYSTEM_SUMMARY = [
  "You write a short summary of a research session from the numbered sources below: the pages the researcher read.",
  "Write in Markdown with exactly these three sections: '## Key findings' (5 to 8 bullet points), '## Where sources disagree' (bullets, or 'Nothing found.'), '## Open questions' (2 to 4 bullets).",
  "Cite every finding with the source numbers in square brackets, like [2] or [1][3]. Use only these sources.",
  "Plain language, no introduction and no conclusion.",
].join(" ");

/** The sources as one message, numbered from 1, sharing SOURCES_CHARS between them. */
function sourcesMessage(sources) {
  const list = (sources || []).slice(0, MAX_SOURCES);
  const each = Math.max(1500, Math.floor(SOURCES_CHARS / Math.max(1, list.length)));
  return list
    .map((src, i) => [`[${i + 1}] ${src.title || "(no title)"}`, `Address: ${src.url || "(unknown)"}`, String(src.text || "(no readable text)").slice(0, each)].join("\n"))
    .join("\n\n---\n\n");
}

/** The source numbers an answer cites, in order of first use, only those that exist. */
function citations(text, count) {
  const seen = [];
  for (const m of String(text || "").matchAll(/\[(\d{1,2})\]/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= count && !seen.includes(n)) seen.push(n);
  }
  return seen;
}

function checkSources(sources) {
  if (!Array.isArray(sources) || !sources.length) throw new AIError("No pages to read. Open some pages first.");
}

/** Ask a question about several pages; the answer cites them as [1] to [n]. */
async function askSources({ question, sources, history = [] }, settings, opts = {}) {
  checkSources(sources);
  const messages = [
    { role: "system", content: SYSTEM_SOURCES },
    { role: "user", content: "Sources:\n\n" + sourcesMessage(sources) },
    { role: "assistant", content: "I have read the sources. What would you like to know?" },
    ...history.slice(-8).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 4000) })),
    { role: "user", content: String(question).slice(0, 2000) },
  ];
  return complete(messages, settings, { maxTokens: 900, ...opts });
}

/** A cited summary of a research session, in Markdown, with a Sources list at the end. */
async function summarizeSources({ name = "", sources }, settings, opts = {}) {
  checkSources(sources);
  const list = sources.slice(0, MAX_SOURCES);
  const body = await complete(
    [
      { role: "system", content: SYSTEM_SUMMARY },
      { role: "user", content: `Research session: ${name || "(untitled)"}\n\nSources:\n\n` + sourcesMessage(list) },
    ],
    settings,
    { maxTokens: 1400, ...opts }
  );
  return [`# ${name || "Research session"}: summary`, "", body.trim(), "", "## Sources", "", ...list.map((src, i) => `${i + 1}. [${String(src.title || src.url).replace(/([\[\]])/g, "\\$1")}](${src.url})`), ""].join("\n");
}

module.exports = { askPage, complete, canChat, pageMessage, PAGE_CHARS, askSources, summarizeSources, sourcesMessage, citations, SOURCES_CHARS, MAX_SOURCES };
