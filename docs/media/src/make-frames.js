// Frames the raw captures with frame.html and saves the README images.
//   node docs/media/src/make-frames.js
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path");
const OUT = path.join(__dirname, "..");
const shots = [
  ["suggestions", "hero.png", true],
  ["suggestions", "suggestions.png", false],
  ["trail", "trail.png", false],
  ["mosaic", "mosaic.png", false],
];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
  for (const [raw, out, hero] of shots) {
    await p.goto(`file://${path.join(__dirname, "frame.html")}?img=raw/${raw}.png${hero ? "&hero=1" : ""}`);
    await p.waitForFunction(() => document.getElementById("shot").complete);
    await (await p.$("#stage")).screenshot({ path: path.join(OUT, out) });
  }
  await b.close();
  console.log("saved", shots.map((s) => s[1]).join(", "));
})();
