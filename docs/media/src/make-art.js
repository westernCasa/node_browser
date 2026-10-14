// Renders the illustrations in art.html to site/img/*.jpg.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  await p.goto("file://" + require("path").join(__dirname, "art.html"));
  for (const id of await p.$$eval(".art", (e) => e.map((x) => x.id))) await (await p.$("#" + id)).screenshot({ path: require("path").join(__dirname, "site", "img", id + ".jpg"), quality: 88, type: "jpeg" });
  await b.close();
})();
