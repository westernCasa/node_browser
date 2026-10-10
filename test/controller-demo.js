// Checks the shared suggestion controller (used by the mobile app) with fake
// page extraction and fake search results. No browser or network needed.
const { SuggestController } = require("../core/controller.js");
const { ResearchStore } = require("../core/research.js");
const { memoryStorage, prefixedStorage } = require("../core/storage.js");

const pages = {
  "https://bread.example/starters": {
    url: "https://bread.example/starters",
    title: "Why sourdough starters fail | Bread Lab",
    headings: ["Why sourdough starters fail", "Hydration", "Flour choice"],
    text: "A sourdough starter fails most often because of temperature. Wild yeast and lactobacillus bacteria need warmth. Rye flour feeds the culture faster than white flour.",
  },
  "https://bank.example/login": { url: "https://bank.example/login", title: "Sign in" },
};
let clock = 0;
const calls = [];
const files = {};
const research = new ResearchStore(prefixedStorage(memoryStorage({}, (n, t) => (files[n] = t)), "sessions/"));
const c = new SuggestController({
  extract: async (tab) => ({ ...pages[tab.url], selection: tab.selection || "" }),
  suggestFor: async (p) => {
    calls.push(`${p.part}: pins=[${p.pinned}] terms=${p.ranked.slice(0, 3).join(",")}`);
    const r = (n) => Array.from({ length: n }, (_, i) => ({ url: `https://r.example/${p.part}/${i}`, title: `R${i}` }));
    return p.part === "reference" ? { results: r(2), queries: ["q1"] } : { results: r(5), queries: ["q1", "q2"], aiQueries: ["q2"] };
  },
  research,
  now: () => clock,
});

(async () => {
  const tab = { id: "1", url: "https://bread.example/starters", title: "Why sourdough starters fail" };
  await c.onPage(tab, "load");
  console.log("1. after load:", c.state.status, "| keywords:", c.shownKeywords().join(", "));
  clock += 5000;
  await c.onPage(tab, "scroll");
  console.log("2. scroll 5 s later, same keywords -> no new search:", calls.length === 2);
  await c.togglePin("sourdough");
  console.log("3. pinned:", c.state.pinned, "| last call:", calls.at(-1), "| saved in session:", research.current.pins);
  c.dismiss("https://r.example/all/0");
  await c.crawl();
  console.log("4. dismissed result stays hidden:", !c.state.results.some((r) => r.url === "https://r.example/all/0"));
  await c.onPage({ id: "2", url: "https://bank.example/login", title: "Sign in", rule: { suggest: false } }, "load");
  console.log("5. suggest:false page:", c.state.status, "| results:", c.state.results.length);
  console.log("6. trail:", research.current.trail.map((t) => `${t.title} [${t.keywords.join(", ")}]`));
  console.log("7. files written:", Object.keys(files));
})();
