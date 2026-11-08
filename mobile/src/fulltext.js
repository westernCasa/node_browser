// M19 full-text chip: find a free, legal copy of a paper from its DOI.
// Unpaywall first (needs the person's email), then OpenAlex (needs their
// free API key), and always a link through the person's library (LibKey) and
// doi.org. Lookups happen only when the person taps Full text, and send only
// the DOI with their email or key. No React Native imports (tested in Node).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// What can run with these settings: { unpaywall, openalex, reason }.
function sources(ft = {}) {
  const unpaywall = Boolean(ft.enabled && EMAIL_RE.test(String(ft.email || "").trim()));
  const openalex = Boolean(ft.enabled && String(ft.openalexKey || "").trim());
  let reason = "";
  if (!ft.enabled) reason = "off";
  else if (!unpaywall && !openalex) reason = ft.email ? "bad-email" : "no-email";
  return { unpaywall, openalex, reason };
}

const enc = (doi) => encodeURIComponent(doi).replace(/%2F/gi, "/");

function unpaywallUrl(doi, email) {
  return `https://api.unpaywall.org/v2/${enc(doi)}?email=${encodeURIComponent(String(email).trim())}`;
}
function openalexUrl(doi, key) {
  return `https://api.openalex.org/works/doi:${enc(doi)}?select=id,doi,title,open_access,best_oa_location,locations&api_key=${encodeURIComponent(String(key).trim())}`;
}

const VERSION = { publishedVersion: "published version", acceptedVersion: "accepted manuscript", submittedVersion: "preprint" };
const licenceText = (l) => (l ? String(l).toUpperCase().replace(/^CC-/, "CC ").replace(/-/g, " ") : "");

// One copy: { url, pdf, where, version, licence, from }.
function copyFrom(loc, from) {
  if (!loc) return null;
  const pdf = loc.url_for_pdf || loc.pdf_url || "";
  const page = loc.url_for_landing_page || loc.landing_page_url || loc.url || "";
  const url = pdf || page;
  if (!/^https?:\/\//i.test(url)) return null;
  const where = loc.repository_institution || loc.source?.display_name || (loc.host_type === "publisher" ? "Publisher" : loc.host_type === "repository" ? "Repository" : "") || hostOf(url);
  return { url, pdf: Boolean(pdf), where, version: VERSION[loc.version] || "", licence: licenceText(loc.license), from };
}

function hostOf(url) {
  const m = /^[a-z]+:\/\/([^/?#:]+)/i.exec(String(url || ""));
  return m ? m[1].replace(/^www\./, "") : "";
}

function parseUnpaywall(text) {
  const j = JSON.parse(text);
  const all = [j.best_oa_location, ...(j.oa_locations || [])].map((l) => copyFrom(l, "Unpaywall")).filter(Boolean);
  return { isOa: Boolean(j.is_oa), status: j.oa_status || "", title: j.title || "", copies: all };
}

function parseOpenAlex(text) {
  const j = JSON.parse(text);
  const all = [j.best_oa_location, ...(j.locations || []).filter((l) => l.is_oa)].map((l) => copyFrom(l, "OpenAlex")).filter(Boolean);
  if (!all.length && j.open_access?.oa_url) all.push({ url: j.open_access.oa_url, pdf: /\.pdf($|\?)/i.test(j.open_access.oa_url), where: hostOf(j.open_access.oa_url), version: "", licence: "", from: "OpenAlex" });
  return { isOa: Boolean(j.open_access?.is_oa), status: j.open_access?.oa_status || "", title: j.title || "", copies: all };
}

// Looks the DOI up. getText is core/net's (cached, rate limited, identified).
// Returns { copies, status, title, notes, links }.
async function lookUp(doi, ft, getText) {
  const can = sources(ft);
  const notes = [];
  const found = [];
  let status = "";
  let title = "";
  const run = async (name, url, parse) => {
    try {
      // The cache key leaves out the email and key.
      const r = await getText(url, { cacheKey: `${name}:${doi}`, timeout: 10000 });
      if (r.status === 404) return notes.push(`${name} doesn't know this DOI.`);
      if (r.status === 401 || r.status === 403 || r.status === 409) return notes.push(name === "OpenAlex" ? "OpenAlex refused the API key. Check it in Settings." : `${name} refused the request. Check your email in Settings.`);
      if (r.status === 422) return notes.push(`${name} wants a real email address. Check it in Settings.`);
      if (r.status === 429) return notes.push(`${name} is busy (too many requests today). Try later.`);
      if (!r.ok) return notes.push(`${name} didn't answer (${r.status}).`);
      const out = parse(r.text);
      found.push(...out.copies);
      status = status || out.status;
      title = title || out.title;
    } catch (err) {
      notes.push(`${name} couldn't be reached.`);
    }
  };
  if (can.unpaywall) await run("Unpaywall", unpaywallUrl(doi, ft.email), parseUnpaywall);
  if (can.openalex) await run("OpenAlex", openalexUrl(doi, ft.openalexKey), parseOpenAlex);
  // One row per address, PDFs and published versions first.
  const seen = new Set();
  const rank = (c) => (c.pdf ? 0 : 1) + (c.version === "published version" ? 0 : c.version === "accepted manuscript" ? 1 : 2);
  const copies = found.filter((c) => !seen.has(c.url) && seen.add(c.url)).sort((a, b) => rank(a) - rank(b));
  return { copies, status, title, notes, links: links(doi) };
}

// Always shown, no lookup needed.
function links(doi) {
  return { doi: `https://doi.org/${enc(doi)}`, library: `https://libkey.io/${enc(doi)}` };
}

// "Free to read: published version, PDF · CC BY · Unpaywall"
function copyLine(c) {
  return [[c.version, c.pdf ? "PDF" : "web page"].filter(Boolean).join(", "), c.licence, c.where, c.from].filter(Boolean).join(" · ");
}

const STATUS_TEXT = { gold: "Open access from the publisher", hybrid: "Open access from the publisher (hybrid journal)", bronze: "Free to read at the publisher, no open licence", green: "Free copy in a repository", diamond: "Open access, no fees", closed: "No free copy found" };

module.exports = { sources, unpaywallUrl, openalexUrl, parseUnpaywall, parseOpenAlex, lookUp, links, copyLine, STATUS_TEXT, EMAIL_RE };
