// Takes the README screenshots of NODE with the demo site.
// Linux only: needs Xvfb, ImageMagick (import) and Playwright.
//   node docs/media/src/make-shots.js
// Writes raw window captures to docs/media/src/raw/*.png. frame.html then
// frames them and make-frames.js saves the final images in docs/media/.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { spawn, execFileSync } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { related } = require("./make-site");

const ROOT = path.join(__dirname, "..", "..", "..");
const SITE = path.join(__dirname, "site");
const RAW = path.join(__dirname, "raw");
const W = 1440, H = 900, PORT = 8770, DISPLAY = ":77";
// The demo site is shown under a reserved .example name instead of 127.0.0.1.
const HOST = "abyssalnotes.example";
const BASE = `http://${HOST}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(RAW, { recursive: true });

const types = { ".html": "text/html", ".jpg": "image/jpeg", ".webm": "video/webm" };
const server = http.createServer((req, res) => {
  const file = path.join(SITE, decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname));
  if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
  const data = fs.readFileSync(file);
  const range = req.headers.range;
  if (range) {
    const [s, e] = range.replace("bytes=", "").split("-");
    const start = +s, end = e ? +e : data.length - 1;
    res.writeHead(206, { "content-type": types[path.extname(file)], "content-range": `bytes ${start}-${end}/${data.length}`, "accept-ranges": "bytes", "content-length": end - start + 1 });
    return res.end(data.subarray(start, end + 1));
  }
  res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream", "accept-ranges": "bytes" });
  res.end(data);
});

const shot = (name) => execFileSync("import", ["-display", DISPLAY, "-window", "root", path.join(RAW, name + ".png")]);

(async () => {
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  const xvfb = spawn("Xvfb", [DISPLAY, "-screen", "0", `${W}x${H}x24`, "-nolisten", "tcp"], { stdio: "ignore" });
  await sleep(800);
  // One data folder for both launches, so one-time notices show only once.
  const userData = fs.mkdtempSync(path.join(require("os").tmpdir(), "node-shots-"));
  const launch = async () => {
    const app = await electron.launch({
      executablePath: require("electron"),
      args: ["--no-sandbox", `--host-resolver-rules=MAP ${HOST} 127.0.0.1:${PORT}`, `--user-data-dir=${userData}`, ROOT],
      env: { ...process.env, DISPLAY, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
    });
    // Search results come from the demo site instead of the web.
    await app.evaluate(({}, { base, related, host, port }) => {
      const orig = globalThis.fetch;
      const items = related.map(([file, title, dek]) => ({ url: `${base}/${file}`, title, dek }));
      globalThis.fetch = async (url, opts) => {
        const u = String(url);
        if (u.includes("wikipedia.org")) {
          const pages = {};
          items.slice(0, 3).forEach((it, i) => (pages[i] = { index: i, title: it.title, fullurl: it.url, extract: it.dek }));
          return new Response(JSON.stringify({ query: { pages } }), { status: 200 });
        }
        if (u.includes("duckduckgo.com")) {
          const html = items.slice(3).map((it) => `<a class="result__a" href="${it.url}">${it.title}</a><a class="result__snippet">${it.dek}</a>`).join("");
          return new Response(html, { status: 200 });
        }
        if (u.startsWith(`http://${host}/`)) return orig(u.replace(host, `127.0.0.1:${port}`), opts);
        if (/^https?:\/\//.test(u)) return new Response("", { status: 404 });
        return orig(url, opts);
      };
    }, { base: BASE, related, host: HOST, port: PORT });
    await app.evaluate(({ BrowserWindow }, { W, H }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 0, y: 0, width: W, height: H }), { W, H });
    const ui = await app.firstWindow();
    await sleep(1500);
    return { app, ui };
  };
  const tidy = (ui) => ui.evaluate(() => {
    document.getElementById("notice").hidden = true;
    document.activeElement?.blur();
  });

  // 1. Article with suggestions.
  let { app, ui } = await launch();
  const go = async (url, wait = 2500) => {
    await ui.fill("#omni", url);
    await ui.press("#omni", "Enter");
    await sleep(wait);
  };
  await go(`${BASE}/article.html`, 8000);
  await tidy(ui);
  await sleep(1000);
  shot("suggestions");

  // 2. Trail after reading a few pages.
  for (const f of ["squid.html", "lure.html", "plankton.html", "sub.html", "jelly.html", "article.html"]) await go(`${BASE}/${f}`, 4000);
  await ui.click("#trail-btn");
  await sleep(1500);
  await tidy(ui);
  shot("trail");
  await app.close();

  // 3. Mosaic with four videos playing, sound from all.
  ({ app, ui } = await launch());
  await go(`${BASE}/v-jelly.html`, 2500);
  for (const v of ["v-plankton", "v-vent", "v-squid"]) {
    await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/${v}.html`);
    await sleep(2500);
  }
  await ui.click("#layout-btn");
  await ui.click("#sound-btn").catch(() => {});
  await sleep(4000);
  await tidy(ui);
  shot("mosaic");
  await app.close();
  xvfb.kill();
  server.close();
  console.log("raw captures in", RAW, fs.readdirSync(RAW));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
