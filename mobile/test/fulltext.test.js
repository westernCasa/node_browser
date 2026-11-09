// M19 full-text chip: the lookup, with a fake network. Run: npm test (in mobile/).
const assert = require("assert");
const F = require("../src/fulltext");

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`ok ${passed} - ${name}`);
};

const UNPAYWALL = JSON.stringify({
  doi: "10.1038/nature12373",
  title: "Nanometre-scale thermometry in a living cell",
  is_oa: true,
  oa_status: "green",
  best_oa_location: { url: "https://europepmc.org/articles/pmc4221854", url_for_landing_page: "https://europepmc.org/articles/pmc4221854", url_for_pdf: null, license: null, version: "acceptedVersion", host_type: "repository" },
  oa_locations: [
    { url: "https://europepmc.org/articles/pmc4221854", url_for_landing_page: "https://europepmc.org/articles/pmc4221854", version: "acceptedVersion", host_type: "repository" },
    { url: "https://dash.harvard.edu/x.pdf", url_for_pdf: "https://dash.harvard.edu/x.pdf", version: "acceptedVersion", license: "cc-by", host_type: "repository", repository_institution: "Harvard University" },
  ],
});
const OPENALEX = JSON.stringify({
  id: "https://openalex.org/W1",
  title: "Nanometre-scale thermometry in a living cell",
  open_access: { is_oa: true, oa_status: "green", oa_url: "https://europepmc.org/articles/pmc4221854" },
  best_oa_location: { is_oa: true, landing_page_url: "https://europepmc.org/articles/pmc4221854", pdf_url: null, version: "acceptedVersion", license: null, source: { display_name: "Europe PMC" } },
  locations: [{ is_oa: false, landing_page_url: "https://www.nature.com/articles/nature12373" }],
});

function fakeNet(answers) {
  const calls = [];
  const getText = async (url, opts) => {
    calls.push({ url, opts });
    for (const [prefix, r] of answers) if (url.startsWith(prefix)) return typeof r === "function" ? r() : r;
    return { ok: false, status: 500, text: "" };
  };
  return { getText, calls };
}

(async () => {
  await test("what can run depends on the settings", () => {
    assert.deepStrictEqual(F.sources({}), { unpaywall: false, openalex: false, reason: "off" });
    assert.deepStrictEqual(F.sources({ enabled: true }), { unpaywall: false, openalex: false, reason: "no-email" });
    assert.strictEqual(F.sources({ enabled: true, email: "nope" }).reason, "bad-email");
    assert.deepStrictEqual(F.sources({ enabled: true, email: "sven@example.org" }), { unpaywall: true, openalex: false, reason: "" });
    assert.deepStrictEqual(F.sources({ enabled: true, email: "", openalexKey: "k" }), { unpaywall: false, openalex: true, reason: "" });
  });

  await test("only the DOI and the email or key are sent; cache keys leave them out", async () => {
    const { getText, calls } = fakeNet([
      ["https://api.unpaywall.org/", { ok: true, status: 200, text: UNPAYWALL }],
      ["https://api.openalex.org/", { ok: true, status: 200, text: OPENALEX }],
    ]);
    await F.lookUp("10.1038/nature12373", { enabled: true, email: " sven@example.org ", openalexKey: "KEY1" }, getText);
    assert.strictEqual(calls[0].url, "https://api.unpaywall.org/v2/10.1038/nature12373?email=sven%40example.org");
    assert.ok(calls[1].url.startsWith("https://api.openalex.org/works/doi:10.1038/nature12373?select="));
    assert.ok(calls[1].url.endsWith("&api_key=KEY1"));
    assert.deepStrictEqual(calls.map((c) => c.opts.cacheKey), ["Unpaywall:10.1038/nature12373", "OpenAlex:10.1038/nature12373"]);
  });

  await test("copies merged, one per address, PDFs first; links always there", async () => {
    const { getText } = fakeNet([
      ["https://api.unpaywall.org/", { ok: true, status: 200, text: UNPAYWALL }],
      ["https://api.openalex.org/", { ok: true, status: 200, text: OPENALEX }],
    ]);
    const r = await F.lookUp("10.1038/nature12373", { enabled: true, email: "a@b.org", openalexKey: "k" }, getText);
    assert.strictEqual(r.copies.length, 2);
    assert.strictEqual(r.copies[0].url, "https://dash.harvard.edu/x.pdf");
    assert.strictEqual(F.copyLine(r.copies[0]), "accepted manuscript, PDF · CC BY · Harvard University · Unpaywall");
    assert.strictEqual(r.status, "green");
    assert.strictEqual(r.links.library, "https://libkey.io/10.1038/nature12373");
    assert.strictEqual(r.links.doi, "https://doi.org/10.1038/nature12373");
    assert.deepStrictEqual(r.notes, []);
  });

  await test("errors say what to do", async () => {
    const { getText } = fakeNet([
      ["https://api.unpaywall.org/", { ok: false, status: 422, text: "" }],
      ["https://api.openalex.org/", { ok: false, status: 409, text: "" }],
    ]);
    const r = await F.lookUp("10.1/x", { enabled: true, email: "a@b.org", openalexKey: "bad" }, getText);
    assert.deepStrictEqual(r.copies, []);
    assert.match(r.notes[0], /real email/);
    assert.match(r.notes[1], /refused the API key/);
    const down = fakeNet([["https://api.unpaywall.org/", () => Promise.reject(new Error("offline"))]]);
    const r2 = await F.lookUp("10.1/x", { enabled: true, email: "a@b.org" }, down.getText);
    assert.match(r2.notes[0], /couldn't be reached/);
    const none = fakeNet([["https://api.unpaywall.org/", { ok: false, status: 404, text: "" }]]);
    assert.match((await F.lookUp("10.1/x", { enabled: true, email: "a@b.org" }, none.getText)).notes[0], /doesn't know/);
  });

  await test("nothing is looked up when it is off", async () => {
    const { getText, calls } = fakeNet([]);
    const r = await F.lookUp("10.1/x", { enabled: false, email: "a@b.org", openalexKey: "k" }, getText);
    assert.strictEqual(calls.length, 0);
    assert.ok(r.links.library);
  });

  console.log(`\n${passed} passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
