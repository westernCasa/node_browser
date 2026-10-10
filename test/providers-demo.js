// Checks the web-source fallback order with fake responses (no network).
const { Registry } = require("../providers.js");

const config = {
  wikipedia: { enabled: true, lang: "en" },
  brave: { enabled: true, key: "test-key" },
  searxng: { enabled: true, url: "https://searx.example.org" },
  ddg: { enabled: true },
};
let braveStatus = 429;
const calls = [];
const getText = async (url) => {
  calls.push(new URL(url).hostname);
  if (url.includes("api.search.brave.com")) {
    if (braveStatus !== 200) return { ok: false, status: braveStatus, text: "" };
    return { ok: true, status: 200, text: JSON.stringify({ web: { results: [{ url: "https://a.example", title: "Brave hit", description: "d" }] } }) };
  }
  if (url.includes("searx.example.org")) return { ok: true, status: 200, text: JSON.stringify({ results: [] }) };
  if (url.includes("duckduckgo")) return { ok: true, status: 200, text: '<a class="result__a" href="https://b.example">DDG hit</a><a class="result__snippet">s</a>' };
  if (url.includes("wikipedia")) return { ok: true, status: 200, text: JSON.stringify({ query: { pages: { 1: { index: 1, title: "Wiki hit", fullurl: "https://en.wikipedia.org/wiki/X" } } } }) };
};
const reg = new Registry({ getText, getConfig: (id) => config[id] });

(async () => {
  console.log("1. Brave rate-limited, SearXNG empty -> DuckDuckGo:", (await reg.web("q1")).map((r) => r.title), calls.join(" > "));
  calls.length = 0;
  console.log("2. Brave paused, so it is skipped:", (await reg.web("q2")).map((r) => r.title), calls.join(" > "));
  console.log("   notes:", reg.notes());
  braveStatus = 200;
  console.log("3. Test button ignores the pause:", await reg.test("brave"));
  calls.length = 0;
  console.log("4. Brave healthy again -> used first:", (await reg.web("q3")).map((r) => r.title), calls.join(" > "));
  console.log("5. Wikipedia:", (await reg.reference("q")).map((r) => r.title));
  config.ddg.enabled = false; config.brave.enabled = false; config.searxng.enabled = false;
  console.log("6. No web source:", await reg.web("q4"), reg.notes());
})();
