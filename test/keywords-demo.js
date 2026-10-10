const k = require("../core/keywords.js");
const page = {
  url: "https://en.wikipedia.org/wiki/Marie_Curie",
  title: "Marie Curie - Wikipedia",
  description: "",
  headings: ["Marie Curie", "Early years", "Life in France", "Radioactivity research", "Nobel Prize in Chemistry", "World War I", "Later years"],
  selection: "",
  text: "Marie Salomea Skłodowska-Curie was a Polish and naturalised-French physicist and chemist who conducted pioneering research on radioactivity. She was the first woman to win a Nobel Prize, the first person to win a Nobel Prize twice, and the only person to win a Nobel Prize in two scientific fields. Her husband, Pierre Curie, was a co-winner of her first Nobel Prize. Marie Curie discovered polonium and radium. Her research on radioactivity at the University of Paris used techniques for isolating radioactive isotopes. Pierre Curie and Marie Curie worked with Henri Becquerel. Jump to content Main menu Search Create account Log in.",
  names: ["Marie Curie", "Pierre Curie", "Henri Becquerel"],
  mediaMeta: ["Marie Curie c1920", "Pierre Curie by Dujardin c1906"],
  mediaLinks: [],
};
const df = new k.SessionDF();
const ranked = k.rankTerms(page, { df });
console.log(ranked.map(r => `${r.term} (${r.score.toFixed(1)}, ${r.kind})`).join("\n"));
console.log(k.buildQueries({ pinned: [], ranked, title: page.title }));
console.log(k.buildQueries({ pinned: ["polonium"], ranked, title: page.title }));
const textOnly = { url: "https://example.com/a", title: "Why sourdough starters fail | Bread Lab", headings:["Temperature","Hydration","Flour choice"], text: "A sourdough starter fails most often because of temperature. Wild yeast and lactobacillus bacteria need warmth. Hydration of the starter matters: a stiff starter ferments slower. Rye flour feeds the culture faster than white flour. Cookie policy. Subscribe to our newsletter.", names: [], mediaMeta: ["IMG_2041", "logo-white"] };
const r2 = k.rankTerms(textOnly, { df });
console.log(r2.map(r=>r.term).join(", "));
console.log(k.buildQueries({ ranked: r2, title: textOnly.title }));
