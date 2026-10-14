// 16:9 images for posting on X: node docs/media/src/make-social.js
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path");
const fs = require("fs");
const OUT = path.join(__dirname, "..", "social");
// The "-zoom" captures are crops of the right side of the window (ImageMagick:
//   convert raw/suggestions.png -crop 1000x620+440+112 +repage raw/suggestions-zoom.png).
const posts = [
  ["suggestions", "1-node.png", "Read one page. Find the next.", "NODE reads the page you are on, picks out the keywords and suggests what to read next."],
  ["suggestions-zoom", "2-suggestions.png", "Suggestions from the page", "Keywords come from the part of the page in view. Pin one, hide one, or select text to search."],
  ["mosaic", "3-mosaic.png", "Four tabs. All playing.", "Mosaic tiles your tabs. Media starts on its own in up to four of them, and you can hear all four."],
  ["trail-zoom", "4-trail.png", "A trail of what you read", "Each research session keeps the pages read and the keywords that recur across them, ready to export as Markdown."],
];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  for (const [raw, out, title, sub] of posts) {
    const q = new URLSearchParams({ img: `raw/${raw}.png`, title, sub });
    await p.goto(`file://${path.join(__dirname, "social.html")}?${q}`);
    await p.waitForFunction(() => document.getElementById("shot").complete);
    await (await p.$("#stage")).screenshot({ path: path.join(OUT, out) });
  }
  await b.close();
  console.log("saved", fs.readdirSync(OUT).join(", "));
})();
