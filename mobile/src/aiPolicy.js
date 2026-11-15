// AI rules for the store releases. No React Native imports (tested in Node:
// mobile/test/ai-policy.test.js).
//
// - Consent (Apple guideline 5.1.2(i)): before page text, keywords or a
//   question go to an AI provider, the person agrees once per provider, and
//   can withdraw it in Settings. No consent: no Ask AI and no AI query ideas.
// - Demo (Sven, 2026-11-15): an "AI" that runs on the phone and only picks
//   sentences from the page, clearly labelled, so reviewers and people
//   without a key can try Ask AI. Nothing is sent.
// - Report (Google Play AI-generated content policy): every AI answer has a
//   "Report" control that opens a pre-filled email, without leaving the app's
//   flow for more than the mail sheet.

const PROVIDERS = {
  demo: { name: "Demo (on this phone)", sends: false },
  local: { name: "Your local model server", sends: true },
  grok: { name: "Grok (xAI)", sends: true },
};

const provider = (ai) => (PROVIDERS[ai?.provider] ? ai.provider : "local");

function providerName(ai) {
  const p = provider(ai);
  if (p === "local") return `your local model server (${String(ai?.local?.url || "").replace(/\/v1\/?$/, "") || "not set"})`;
  return PROVIDERS[p].name;
}

// What is sent, in plain words, for the consent sheet.
function consentText(ai) {
  const p = provider(ai);
  if (p === "demo") return null;
  const who = p === "grok" ? "xAI, the company that runs Grok," : "the model server at the address you entered";
  return {
    title: p === "grok" ? "Send page text to Grok (xAI)?" : "Send page text to your model server?",
    lines: [
      `When you use Ask AI, NODE sends ${who} the page's address, title and text, any text you selected, and your question.`,
      "If AI query ideas are on, NODE also sends the keywords and titles of pages you read, to suggest searches.",
      p === "grok" ? "xAI handles this data under its own privacy policy. Your API key stays in this phone's keychain." : "This server is yours; NODE sends nothing to anyone else for Ask AI.",
      "Nothing is sent until you agree. You can withdraw this in Settings → AI at any time.",
    ],
  };
}

// consents: { [provider]: time agreed }.
function hasConsent(ai, consents = {}) {
  const p = provider(ai);
  return p === "demo" || Boolean(consents[p]);
}

// The settings the search flow sees: AI query ideas only with consent, and
// never for the demo (it has no model).
function aiForQueries(ai, consents) {
  if (!ai?.enabled) return ai;
  if (provider(ai) === "demo" || !hasConsent(ai, consents)) return { ...ai, enabled: false };
  return ai;
}

// ---- demo answers: sentences from the page, chosen on the phone ----

const STOP = new Set("a an and are as at be been but by can could did do does for from had has have how i if in into is it its may more most no not of on or our so such than that the their them then there these they this to was we were what when where which who why will with would you your about after also any before between both each other over some through under up very".split(" "));

function sentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/([.!?])\s+(?=[A-Z0-9“"(])/g, "$1\u0001") // no lookbehind: safe on every JS engine
    .split("\u0001")
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.length <= 400);
}
const words = (s) => (String(s).toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) || []).filter((w) => !STOP.has(w));

function topWords(text, n = 12) {
  const f = new Map();
  for (const w of words(text)) f.set(w, (f.get(w) || 0) + 1);
  return [...f.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

// The n sentences that best match the given words, in page order.
function pick(list, keys, n) {
  const k = new Set(keys);
  return list
    .map((s, i) => ({ s, i, score: words(s).filter((w) => k.has(w)).length / Math.sqrt(words(s).length || 1) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s);
}

const DEMO_NOTE = "Demo answer: picked from the page on this phone, not written by an AI model. Add a model in Settings → AI for real answers.";

function demoAnswer(question, page) {
  const text = [page?.selection, page?.text].filter(Boolean).join(" ");
  const list = sentences(text);
  if (!list.length) return `This page has no readable text to pick from.\n\n${DEMO_NOTE}`;
  const q = String(question || "").toLowerCase();
  let out;
  if (/summar/.test(q)) {
    out = pick(list, topWords(text), 5).map((s) => `• ${s}`).join("\n");
  } else if (/key facts|names|dates/.test(q)) {
    const facts = list.filter((s) => /\b(1[5-9]\d\d|20\d\d)\b|\d+(\.\d+)?\s?(%|percent|km|kg|m\b|million|billion)|\b[A-Z][a-z]+ [A-Z][a-z]+/.test(s));
    out = (facts.length ? pick(facts, topWords(text), 5) : pick(list, topWords(text), 5)).map((s) => `• ${s}`).join("\n");
  } else if (/open|next|read/.test(q)) {
    const terms = topWords(text, 6);
    out = `Words this page keeps coming back to: ${terms.join(", ")}.\nTry searching for:\n${terms.slice(0, 3).map((t) => `• ${t} ${terms.find((x) => x !== t) || ""}`.trim()).join("\n")}`;
  } else {
    const keys = words(q);
    const hits = pick(list, keys, 3);
    out = hits.length ? `Sentences on this page that match your question:\n${hits.map((s) => `• ${s}`).join("\n")}` : "No sentence on this page matches your question.";
  }
  return `${out}\n\n${DEMO_NOTE}`;
}

// ---- report an AI answer ----

function reportMailto({ to, provider: prov, model = "", question = "", answer = "", url = "", version = "" }) {
  const body = [
    "What's wrong with this answer? (Write here.)",
    "",
    "",
    "---",
    `Provider: ${prov}${model ? ` (${model})` : ""}`,
    `App version: ${version}`,
    `Page: ${url}`,
    `Question: ${String(question).slice(0, 500)}`,
    "Answer:",
    String(answer).slice(0, 1500),
  ].join("\n");
  const subject = "NODE: report an AI answer";
  return `mailto:${encodeURIComponent(to || "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

module.exports = { PROVIDERS, provider, providerName, consentText, hasConsent, aiForQueries, demoAnswer, reportMailto, DEMO_NOTE, sentences };
