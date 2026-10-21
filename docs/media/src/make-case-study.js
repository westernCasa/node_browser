// Screenshots and short recordings of NODE for the design case study.
// Linux only: needs Xvfb, ImageMagick (import), ffmpeg and Playwright.
//   node docs/media/src/make-case-study.js [output folder]
// Uses the "Abyssal Notes" demo site (make-site.js), served locally; search
// results point at it, so nothing comes from the web. The window is
// 1440 x 900 at 2x, so stills are 2880 x 1800. Each recording is saved as an
// MP4 (full quality) and a GIF (1200 px wide, or the crop size).
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { spawn, execFileSync } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { related } = require("./make-site");

const ROOT = path.join(__dirname, "..", "..", "..");
const SITE = path.join(__dirname, "site");
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), "node-case-study"));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "node-rec-"));
const W = 1440, H = 900, SCALE = 2, SW = W * SCALE, SH = H * SCALE;
const PORT = 8771, DISPLAY = ":78";
const HOST = "abyssalnotes.example";
const BASE = `http://${HOST}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(path.join(OUT, "stills"), { recursive: true });
fs.mkdirSync(path.join(OUT, "gifs"), { recursive: true });
fs.mkdirSync(path.join(OUT, "mp4"), { recursive: true });

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

const still = (name) => execFileSync("import", ["-display", DISPLAY, "-window", "root", path.join(OUT, "stills", name + ".png")]);

// Record the whole display; stop() writes an MP4 and a GIF. crop: a part of
// the window in CSS pixels {x, y, w, h}.
// Resolves once ffmpeg is writing frames, so the action is not missed.
async function record(name, crop) {
  const raw = path.join(TMP, name + ".mkv");
  const t0 = Date.now();
  const p = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "x11grab", "-draw_mouse", "0", "-framerate", "30", "-video_size", `${SW}x${SH}`, "-i", `${DISPLAY}.0+0,0`, "-c:v", "libx264", "-preset", "ultrafast", "-qp", "0", raw], { stdio: ["pipe", "ignore", "inherit"] });
  for (let i = 0; i < 100 && !(fs.existsSync(raw) && fs.statSync(raw).size > 50000); i++) await sleep(100);
  await sleep(300);
  // Skip the frames from before the action (ffmpeg takes about 0.6 s to start).
  const skip = String(Math.max(0, (Date.now() - t0) / 1000 - 0.9).toFixed(2));
  return async () => {
    await new Promise((r) => {
      p.on("exit", r);
      p.stdin.write("q");
    });
    const c = crop ? `crop=${crop.w * SCALE}:${crop.h * SCALE}:${crop.x * SCALE}:${crop.y * SCALE},` : "";
    const gifW = crop ? Math.min(crop.w * SCALE, 960) : 1200;
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", skip, "-i", raw, "-vf", `${c}scale=${crop ? crop.w * SCALE : 1440}:-2:flags=lanczos`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", path.join(OUT, "mp4", name + ".mp4")]);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", skip, "-i", raw, "-vf", `${c}fps=24,scale=${gifW}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, path.join(OUT, "gifs", name + ".gif")]);
    fs.rmSync(raw, { force: true });
  };
}

(async () => {
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  const xvfb = spawn("Xvfb", [DISPLAY, "-screen", "0", `${SW}x${SH}x24`, "-nolisten", "tcp"], { stdio: "ignore" });
  await sleep(800);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "node-case-"));
  const launch = async () => {
    const app = await electron.launch({
      executablePath: require("electron"),
      args: ["--no-sandbox", `--force-device-scale-factor=${SCALE}`, `--host-resolver-rules=MAP ${HOST} 127.0.0.1:${PORT}`, `--user-data-dir=${userData}`, ROOT],
      env: { ...process.env, DISPLAY, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
    });
    await app.evaluate(({ screen }, { base, related, host, port }) => {
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
      globalThis.__cursor = { x: 700, y: 500 };
      screen.getCursorScreenPoint = () => globalThis.__cursor;
    }, { base: BASE, related, host: HOST, port: PORT });
    await app.evaluate(({ BrowserWindow }, { W, H }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 0, y: 0, width: W, height: H }), { W, H });
    const ui = await app.firstWindow();
    await sleep(1500);
    return { app, ui };
  };
  const tidy = (ui) => ui.evaluate(() => {
    const n = document.getElementById("notice");
    if (n) n.hidden = true;
    document.activeElement?.blur();
  });
  const box = (ui, sel) => ui.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });

  let { app, ui } = await launch();
  const go = async (url, wait = 2500) => {
    await ui.fill("#omni", url);
    await ui.press("#omni", "Enter");
    await sleep(wait);
  };
  const cursor = (y) => app.evaluate(({ BrowserWindow }, y) => {
    const b = BrowserWindow.getAllWindows()[0].getContentBounds();
    globalThis.__cursor = { x: b.x + 600, y: b.y + y };
  }, y);

  // 1. Suggestions beside an article.
  await go(`${BASE}/article.html`, 8000);
  await tidy(ui);
  await sleep(800);
  still("01-suggestions");

  // 2. Pin a keyword, hide another (motion 06).
  let stop = await record("pin-and-hide-keywords");
  await sleep(500);
  await ui.click("#keys .key:nth-child(3) .label");
  await sleep(1400);
  await ui.click("#keys .key:nth-child(5) button");
  await sleep(1600);
  await stop();
  await tidy(ui);
  still("02-pinned-keyword");

  // 3. Bookmark star (motion 04), cropped around the address bar end.
  const star = await box(ui, "#star-btn");
  stop = await record("bookmark-star", { x: Math.round(star.x - 56), y: Math.round(star.y - 8), w: Math.round(star.w + 112), h: Math.round(star.h + 16) });
  await sleep(400);
  await ui.click("#star-btn");
  await sleep(800);
  await ui.click("#star-btn");
  await sleep(700);
  await ui.click("#star-btn");
  await sleep(900);
  await stop();

  // 4. Suggestions widget collapses and comes back (motion 10).
  stop = await record("suggestions-widget");
  await sleep(400);
  await ui.click("#suggest-toggle");
  await sleep(1100);
  await ui.click("#suggest-toggle");
  await sleep(1100);
  await stop();
  await ui.click("#suggest-toggle");
  await sleep(900);
  await tidy(ui);
  still("03-widget-collapsed");
  await ui.click("#suggest-toggle");
  await sleep(900);

  // 5. A new page: keywords change and new cards arrive (motion 07).
  stop = await record("new-page-suggestions");
  await go(`${BASE}/squid.html`, 7500);
  await stop();
  for (const f of ["lure.html", "plankton.html", "sub.html", "jelly.html", "article.html"]) await go(`${BASE}/${f}`, 4000);

  // 6. Screenshot into the Library, then the menu (motion 11).
  await ui.evaluate(() => document.getElementById("shot-btn").click());
  await sleep(2000);
  await tidy(ui);
  still("05-menu-library");
  await ui.keyboard.press("Escape");
  await sleep(800);
  stop = await record("menu");
  await sleep(400);
  await ui.click("#menu-btn");
  await sleep(1000);
  await ui.click('.mnav[data-section="trail"]');
  await sleep(1200);
  await ui.click('.mnav[data-section="settings"]');
  await sleep(1000);
  await ui.keyboard.press("Escape");
  await sleep(900);
  await stop();
  await ui.click("#menu-btn");
  await sleep(800);
  await ui.click('.mnav[data-section="trail"]');
  await sleep(1200);
  await tidy(ui);
  still("06-menu-trail");
  await ui.click('.mnav[data-section="settings"]');
  await sleep(1000);
  await ui.evaluate(() => document.getElementById("rule-this-site")?.scrollIntoView({ block: "start" }));
  await sleep(600);
  still("07-site-rules");
  await ui.keyboard.press("Escape");
  await sleep(900);

  // 7. Full screen: the toolbar slides over a still page (motion 09).
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit("enter-full-screen"));
  await sleep(700);
  still("08-fullscreen-entering");
  await sleep(2200);
  await tidy(ui);
  still("09-fullscreen-page");
  stop = await record("fullscreen-toolbar");
  await sleep(500);
  await cursor(1);
  await sleep(1100);
  await cursor(500);
  await sleep(1500);
  await stop();
  await cursor(1);
  await sleep(900);
  still("10-fullscreen-toolbar");
  await cursor(500);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit("leave-full-screen"));
  await sleep(800);
  await app.close();

  // 8. Mosaic: four videos (motion 08).
  ({ app, ui } = await launch());
  await go(`${BASE}/v-jelly.html`, 2500);
  for (const v of ["v-plankton", "v-vent", "v-squid"]) {
    await ui.evaluate((u) => window.scout.createTab(u), `${BASE}/${v}.html`);
    await sleep(2500);
  }
  await tidy(ui);
  stop = await record("mosaic");
  await sleep(500);
  await ui.click("#layout-btn");
  await sleep(1500);
  await ui.click("#layout-btn");
  await sleep(1200);
  await ui.click("#layout-btn");
  await sleep(1500);
  await stop();
  await ui.click("#sound-btn").catch(() => {});
  await sleep(2500);
  await tidy(ui);
  still("04-mosaic");
  await app.close();

  xvfb.kill();
  server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  for (const d of ["stills", "gifs", "mp4"]) console.log(d, fs.readdirSync(path.join(OUT, d)).map((f) => `${f} ${(fs.statSync(path.join(OUT, d, f)).size / 1e6).toFixed(1)}MB`).join(", "));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
