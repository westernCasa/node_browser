// M18 smart capture on the phone: the logic, with no React Native imports so
// it runs in Node tests (mobile/test/capture.test.js).
//
// One tap saves the page's address, title, DOI or PMID if it has one, the
// time with the time zone, the selected text and a thumbnail into the trail
// being recorded. It follows the desktop rules: the capture is a capture card
// linked "captured from" its page, and capturing a page makes the page a card
// (B104: a capture is an engagement signal).
const { isSensitiveUrl } = require("../../core/urls");

const QUOTE_MAX = 600;

// Runs in the page; posts what the page says about itself.
const captureInfoCall = (id) => `(function () {
  var post = function (m) { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} };
  try {
    var meta = function (sel) { var el = document.querySelector(sel); return el ? (el.getAttribute("content") || "") : ""; };
    var metas = [];
    ["citation_doi", "dc.identifier", "DC.identifier", "prism.doi", "bepress_citation_doi", "citation_pmid", "og:title", "citation_title"].forEach(function (n) {
      var v = meta('meta[name="' + n + '"]') || meta('meta[property="' + n + '"]');
      if (v) metas.push([n, v]);
    });
    var links = [];
    var as = document.querySelectorAll('a[href*="doi.org/10."]');
    for (var i = 0; i < as.length && i < 5; i++) links.push(as[i].href);
    var sel = String(window.getSelection ? window.getSelection() : "").trim();
    var text = (document.body && document.body.innerText || "").slice(0, 20000);
    post({ type: "capinfo", id: ${JSON.stringify(id)}, url: location.href, title: document.title || "", selection: sel.slice(0, 2000), metas: metas, links: links, text: text });
  } catch (e) { post({ type: "capinfo", id: ${JSON.stringify(id)}, error: String(e) }); }
  true;
})();`;

const DOI_RE = /\b(10\.\d{4,9}\/[^\s"'<>]+)/i;

// "https://doi.org/10.1038/X." -> "10.1038/x"; null if it is not a DOI.
function cleanDoi(raw) {
  const m = DOI_RE.exec(decodeSafe(String(raw || "")));
  if (!m) return null;
  // Sentence punctuation and closing brackets are not part of a DOI.
  let doi = m[1].replace(/[.,;:]+$/, "");
  while (/[)\]]$/.test(doi) && count(doi, doi.endsWith(")") ? "(" : "[") < count(doi, doi.slice(-1))) doi = doi.slice(0, -1);
  return doi.toLowerCase();
}
const count = (s, ch) => s.split(ch).length - 1;
function decodeSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// The page's DOI and PMID, most trusted source first: citation metadata, the
// address, DOI links on the page, then the page text.
function findIds({ url = "", metas = [], links = [], text = "" } = {}) {
  const meta = (names) => metas.filter(([n]) => names.includes(n.toLowerCase())).map(([, v]) => v);
  let doi = null;
  for (const v of [...meta(["citation_doi", "prism.doi", "bepress_citation_doi", "dc.identifier"]), url, ...links, text]) {
    doi = cleanDoi(v);
    if (doi) break;
  }
  let pmid = meta(["citation_pmid"]).map((v) => String(v).trim()).find((v) => /^\d{1,9}$/.test(v)) || null;
  if (!pmid) pmid = (/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{1,9})/.exec(url) || [])[1] || null;
  return { doi, pmid };
}

function hostOf(url) {
  const m = /^[a-z]+:\/\/([^/?#:]+)/i.exec(String(url || ""));
  return m ? m[1].replace(/^www\./, "") : "";
}

// "GMT-5", "GMT+5:30" from a UTC offset in minutes east (Date's is west).
function zoneOf(date) {
  const east = -date.getTimezoneOffset();
  const sign = east < 0 ? "-" : "+";
  const h = Math.floor(Math.abs(east) / 60);
  const m = Math.abs(east) % 60;
  let name = "";
  try {
    name = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch (_) {}
  return { offset: east, label: `GMT${east ? sign + h + (m ? `:${String(m).padStart(2, "0")}` : "") : ""}`, name };
}

function hhmm(at) {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// What the capture card holds. `selection` is the text selected when Capture
// was tapped, or the last selection on this page if the tap cleared it.
// Returns { error } for pages that are never captured.
function buildCapture(info, { at = Date.now(), selection = "", shot = "" } = {}) {
  if (!info || info.error) return { error: "Couldn't read this page. Try again once it has loaded." };
  const url = String(info.url || "");
  if (!/^https?:\/\//i.test(url)) return { error: "Only web pages can be captured." };
  if (isSensitiveUrl(url)) return { error: "Sign-in, account and payment pages are never captured." };
  const ids = findIds(info);
  const quote = String(info.selection || selection || "").replace(/\s+/g, " ").trim().slice(0, QUOTE_MAX);
  const metaTitle = (info.metas || []).find(([n]) => ["citation_title", "og:title"].includes(n))?.[1];
  const title = String(info.title || metaTitle || hostOf(url)).trim();
  const zone = zoneOf(new Date(at));
  const source = hostOf(url);
  // The line under the quote in a shared file (doc 26 keeps it verbatim).
  const parts = [`Captured from ${source}`, `phone ${hhmm(at)} ${zone.label}`];
  if (ids.doi) parts.push(`DOI ${ids.doi}`);
  if (ids.pmid) parts.push(`PMID ${ids.pmid}`);
  return {
    card: {
      kind: "capture",
      quote,
      title,
      source,
      url,
      time: at,
      tz: zone.name || zone.label,
      tzOffset: zone.offset,
      device: "phone",
      captureKind: shot ? "shot" : "text",
      shot,
      doi: ids.doi || "",
      pmid: ids.pmid || "",
      fromText: parts.join(" · "),
    },
  };
}

// Saves the capture into the trail. The page becomes a card first (if it is
// not one), then the capture card, linked "captured from" the page.
// Returns { card, page, newPage } so Undo can take back both.
function saveCapture(store, trailId, card, { at = card.time, pageTitle } = {}) {
  const existing = store.pageCard(trailId, card.url);
  const had = existing && !existing.removed ? existing : null;
  const page = had || store.placePage(trailId, card.url, { title: pageTitle || card.title, at });
  const c = store.addCard(trailId, card, { at, event: "captured", data: { url: card.url, title: card.quote || card.title } });
  if (c && page) store.link(trailId, page.id, c.id, { kind: "auto", label: "captured from", at });
  return { card: c, page, newPage: Boolean(page && !had) };
}

// Undo: the capture card goes, and the page card too if the capture made it.
function undoCapture(store, trailId, saved) {
  if (saved?.card) store.removeCard(trailId, saved.card.id);
  if (!saved?.newPage || !saved.page) return;
  // Keep the page card if another capture of the page still uses it.
  const others = (store.get(trailId)?.cards || []).some((c) => c.kind === "capture" && !c.removed && c.url === saved.page.url);
  if (!others) store.removeCard(trailId, saved.page.id);
}

// A short confirmation: "Captured to Sourdough starters · DOI found".
function capturedText(card, trailName) {
  const bits = [`Captured to ${trailName || "the trail"}`];
  if (card.quote) bits.push("with the selected text");
  if (card.doi) bits.push("DOI found");
  return bits.join(" · ");
}

module.exports = { captureInfoCall, cleanDoi, findIds, buildCapture, saveCapture, undoCapture, capturedText, zoneOf, QUOTE_MAX };
