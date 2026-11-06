// Unit checks for core/net.js: identity headers for background requests.
const { createNet, identityHeaders } = require("../core/net");
let failed = 0;
const check = (name, ok) => { if (!ok) failed++; console.log(ok ? "✓" : "✗", name); };

const UA = "NODE/0.1.0 (research browser; mobile; +https://github.com/westernCasa/node_browser)";

check("no user agent, no headers", Object.keys(identityHeaders("", "en.wikipedia.org")).length === 0);
const wiki = identityHeaders(UA, "en.wikipedia.org");
check("Wikipedia gets User-Agent and Api-User-Agent", wiki["User-Agent"] === UA && wiki["Api-User-Agent"] === UA);
check("other Wikimedia sites too", identityHeaders(UA, "commons.wikimedia.org")["Api-User-Agent"] === UA && identityHeaders(UA, "www.wikidata.org")["Api-User-Agent"] === UA);
const other = identityHeaders(UA, "api.search.brave.com");
check("other sites get User-Agent only", other["User-Agent"] === UA && !("Api-User-Agent" in other));
check("look-alike hosts are not Wikimedia", !("Api-User-Agent" in identityHeaders(UA, "wikipedia.org.example.com")) && !("Api-User-Agent" in identityHeaders(UA, "notwikipedia.org")));

(async () => {
  const seen = [];
  const fakeFetch = async (url, opts) => {
    seen.push({ url, headers: opts.headers });
    return { ok: true, status: 200, url, text: async () => "{}" };
  };
  const net = createNet({ fetch: fakeFetch, userAgent: UA, gaps: { default: 0 } });
  await net.getText("https://en.wikipedia.org/w/api.php?action=query&format=json");
  await net.getText("https://example.com/page", { headers: { Accept: "text/html" } });
  check("request to Wikipedia carries both headers", seen[0].headers["User-Agent"] === UA && seen[0].headers["Api-User-Agent"] === UA);
  check("caller headers are kept", seen[1].headers.Accept === "text/html" && seen[1].headers["User-Agent"] === UA);

  const bare = [];
  const net2 = createNet({ fetch: async (url, opts) => { bare.push(opts.headers); return { ok: true, status: 200, url, text: async () => "" }; }, gaps: { default: 0 } });
  await net2.getText("https://en.wikipedia.org/wiki/Main_Page");
  check("without a user agent nothing is added", Object.keys(bare[0]).length === 0);

  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
})();
