// Renders the toolbar button icon (the kit's `suggest` icon, SPEC.md section 3)
// as PNG at 16 and 32 px, since chrome.action needs raster icons. Two
// versions: white strokes for a dark toolbar, black for a light one.
// Run after changing src/ui/icons/suggest.svg (needs Playwright):
//   node browser/extension/make-toolbar-icons.js
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const fs = require("fs"), path = require("path");
const ICONS = path.join(__dirname, "src", "ui", "icons");
const OUT = path.join(ICONS, "png");

(async () => {
  const svg = fs.readFileSync(path.join(ICONS, "suggest.svg"), "utf8");
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const [name, colour] of [["on-dark", "#ffffff"], ["on-light", "#000000"]]) {
    for (const size of [16, 32]) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      const sized = svg.replace('width="20" height="20"', `width="${size}" height="${size}"`).replace(/currentColor/g, colour);
      await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${sized}`);
      await page.screenshot({ path: path.join(OUT, `suggest-${name}-${size}.png`), omitBackground: true });
      await page.close();
    }
  }
  await browser.close();
  console.log("Wrote", fs.readdirSync(OUT).join(", "));
})();
