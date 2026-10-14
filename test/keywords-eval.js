// Keyword test set: pages shaped like what NODE's page script reads from real
// sites (title, description, headings, text blocks), with the keywords each
// should and should not produce. Run: node test/keywords-eval.js
const { analyzePage, KeywordContext } = require("../core/keywords");

const reddit = (title, comments, url) => ({
  url,
  title,
  description: "",
  headings: ["r/NoMansSkyTheGame"],
  blocks: [
    "Join the most real place on the internet",
    "Continue with Google",
    "Continue with Phone Number",
    "By continuing, you agree to our User Agreement and acknowledge that you understand the Privacy Policy.",
    "Join the conversation",
    "r/NoMansSkyTheGame is the unofficial community for No Man's Sky, the procedural space exploration game by Hello Games.",
    ...comments,
  ],
  names: ["No Man's Sky", "Hello Games"],
});

const cases = [
  {
    name: "YouTube home (thin page)",
    page: {
      url: "https://www.youtube.com/",
      title: "YouTube",
      description: "Enjoy the videos and music you love, upload original content, and share it all with friends, family, and the world on YouTube.",
      headings: [],
      blocks: ["Try searching to get started", "Start watching videos to help us build a feed of videos you'll love."],
      names: [],
    },
    thin: true,
  },
  {
    name: "Wikipedia article",
    page: {
      url: "https://en.wikipedia.org/wiki/Memex",
      title: "Memex - Wikipedia",
      description: "",
      headings: ["Memex", "Development", "Associative trails", "Influence on hypertext"],
      blocks: [
        "From Wikipedia, the free encyclopedia",
        "A memex (a portmanteau of \"memory\" and \"index\") is a hypothetical electromechanical device for interacting with microform documents and described in Vannevar Bush's 1945 article \"As We May Think\".",
        "Bush envisioned the memex as a device in which individuals would compress and store all of their books, records, and communications, \"mechanized so that it may be consulted with exceeding speed and flexibility\".",
        "The concept of the memex influenced the development of early hypertext systems and personal knowledge base software. Ted Nelson and Douglas Engelbart both cited Bush's essay.",
        "The hypothetical implementation depicted by Bush for the purpose of concrete illustration was based upon a document bookmark list of static microfilm pages and lacked a true hypertext system.",
      ],
      names: ["Vannevar Bush", "Ted Nelson", "Douglas Engelbart"],
    },
    want: ["memex", "Vannevar Bush", "hypertext"],
    avoid: ["wikipedia", "free", "speed", "individual", "purpose"],
  },
  {
    name: "Reddit thread (sign-up box)",
    page: reddit(
      "Is Light No Fire coming soon? : r/NoMansSkyTheGame",
      [
        "I don't think either of these updates really point to anything major in Light No Fire. Maybe physics object from remnant? Still, I think the more telling indicator would be the anniversary approaching and a potential news drop or release date announcement.",
        "The remnant expedition was probably a test for Hello Games' servers to see what would happen if you had a ton of people on the same planet in Light No Fire.",
        "No Man's Sky only has 32 players per session max, so there would be no need for that in No Man's Sky itself.",
      ],
      "https://www.reddit.com/r/NoMansSkyTheGame/comments/1shaazn/is_light_no_fire_coming_soon/"
    ),
    want: ["Light No Fire", "remnant"],
    avoid: ["join", "continue", "google", "agreement", "conversation", "phone", "internet", "real"],
  },
  {
    name: "Shop product page",
    page: {
      url: "https://shop.example.com/products/hario-v60-dripper",
      title: "Hario V60 Ceramic Dripper, Size 02 | Example Coffee Shop",
      description: "Free shipping on orders over $50.",
      headings: ["Hario V60 Ceramic Dripper", "Add to cart", "You may also like"],
      blocks: [
        "Add to cart",
        "Free shipping on orders over $50. Returns within 30 days.",
        "The Hario V60 is a cone-shaped pour-over dripper with spiral ribs and a single large hole, letting you control extraction through your pouring speed and grind size.",
        "Made from Arita porcelain in Japan, the ceramic dripper holds heat well for a stable brew temperature. Use with V60 02 paper filters.",
      ],
      names: ["Hario V60", "Arita"],
    },
    want: ["Hario V60", "dripper"],
    avoid: ["cart", "shipping", "orders", "returns", "like"],
  },
  {
    name: "News story",
    page: {
      url: "https://news.example.org/science/2026/10/jwst-water-exoplanet",
      title: "Webb telescope finds water vapour on a rocky exoplanet - Example News",
      description: "Astronomers using the James Webb Space Telescope have detected water vapour in the atmosphere of LHS 1140 b.",
      headings: ["Webb telescope finds water vapour on a rocky exoplanet", "What the team saw", "Related stories"],
      blocks: [
        "Astronomers using the James Webb Space Telescope have detected water vapour in the atmosphere of LHS 1140 b, a rocky planet 48 light years away.",
        "The team, led by researchers at the University of Montreal, measured starlight filtering through the planet's atmosphere during a transit.",
        "Sign up for our science newsletter",
        "The finding makes LHS 1140 b one of the best places to look for a habitable world, the researchers said, though more observations are needed.",
      ],
      names: ["James Webb Space Telescope", "University of Montreal"],
    },
    want: ["exoplanet", "James Webb Space Telescope", "vapour"],
    avoid: ["sign", "newsletter", "team", "said", "related"],
  },
];

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
};
const has = (ranked, term) => ranked.some((r) => r.term.toLowerCase() === term.toLowerCase() || r.term.toLowerCase().includes(term.toLowerCase()));

for (const c of cases) {
  const res = analyzePage(c.page, { context: new KeywordContext(), limit: 12 });
  const top = res.ranked.slice(0, 8);
  const list = top.map((r) => r.term).join(", ");
  if (c.thin) {
    check(c.name, res.thin, `thin=${res.thin} words=${res.words} | ${list || "(none)"}`);
    continue;
  }
  const missing = (c.want || []).filter((w) => !has(top, w));
  const bad = (c.avoid || []).filter((w) => top.some((r) => r.term.toLowerCase() === w));
  check(c.name, !res.thin && !missing.length && !bad.length, `| ${list}${missing.length ? " | missing: " + missing.join(", ") : ""}${bad.length ? " | should not have: " + bad.join(", ") : ""}`);
}

// Site furniture: the second thread on the same site leaves out the sidebar text.
{
  const ctx = new KeywordContext();
  analyzePage(cases[2].page, { context: ctx });
  const second = reddit(
    "Hello Games teases Light No Fire trailer date : r/NoMansSkyTheGame",
    ["Sean Murray posted a cryptic image of a mountain range, which people think is the Light No Fire trailer coming at The Game Awards in December."],
    "https://www.reddit.com/r/NoMansSkyTheGame/comments/2abcd/hello_games_teases/"
  );
  const res = analyzePage(second, { context: ctx });
  const terms = res.ranked.slice(0, 8).map((r) => r.term.toLowerCase());
  check("Same-site sidebar left out on 2nd page", !terms.some((t) => /procedural|exploration|unofficial|community/.test(t)), "| " + terms.join(", "));
}

// Running topic: a word on pages from two sites ranks higher, and a thin page
// falls back to it.
{
  const ctx = new KeywordContext();
  const page = (url, title, text) => ({ url, title, headings: [title], blocks: [text], names: [] });
  analyzePage(page("https://a.example/levain", "Levain basics", "A sourdough levain is a portion of starter mixed with flour and water hours before the dough. Bakers adjust the levain hydration and temperature to control sourness and timing in the final loaf."), { context: ctx });
  analyzePage(page("https://b.example/hydration", "Dough hydration explained", "Sourdough hydration is the ratio of water to flour. Higher hydration sourdough gives an open crumb but is harder to shape; whole grain flour absorbs more water than white flour."), { context: ctx });
  const topic = ctx.topic(6).map((t) => t.term);
  check("Topic from two sites", topic.includes("sourdough"), "| " + topic.join(", "));
  const thin = analyzePage(cases[0].page, { context: ctx });
  check("Thin page detected with a topic waiting", thin.thin && ctx.topic(6).length > 0, `| fallback: ${ctx.topic(6).map((t) => t.term).join(", ")}`);
}

// Bot-check pages (ResearchGate's DataDome page) give no keywords.
{
  const res = analyzePage(
    {
      url: "https://www.researchgate.net/publication/289734426_Geothermal_anomalies",
      title: "researchgate.net",
      headings: ["Access is temporarily restricted"],
      blocks: ["We detected unusual activity from your device or network.", "Automated (bot) activity on your network (IP 38.81.113.136)"],
      names: ["Device Check"],
    },
    { context: new KeywordContext() }
  );
  check("Bot-check page gives no keywords", res.blocked && !res.ranked.length, `| blocked=${res.blocked}`);
}

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
