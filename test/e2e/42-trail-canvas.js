// Trail canvas, step 1 (B100-B103). This file grows with each item.
// B100: research sessions move into the trail store on the first start;
// trail:* channels; research:* still works on top of it; NODE opens on the
// trail that was current.
// B101: the canvas draws the trail (cards, lines, minimap, line key) at its
// saved position; pan, zoom 20%-250%, Fit; the position is saved; an open
// tab's card shows its picture and the Tab mark; 200 cards pan and zoom
// (frame times are printed; the 60 fps check is on an M1 Mac).
// B104: a page becomes a card after 20 s on screen or a scroll by hand, near
// the page it was opened from, with an "opened from" line; a short visit stays
// timeline-only with its time on page; tabs still open when leaving a trail
// become cards; Put on canvas and Remove from canvas, lines kept.
// B102: NODE opens on the canvas; ⌘T and + show it with the search bar ready;
// a search there opens a page tab; it is first in the tab list (⌘1); ⌘E goes
// from a page to its card; closing the last page tab comes back to it; an
// empty trail asks "What are you looking into?" and offers the other trails;
// no custom new tab address and no Most visited.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path"), fs = require("fs"), os = require("os"), http = require("http");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "node-e2e-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(ok ? "✓" : "✗", name, detail ? `(${detail})` : "");
};
// /proofing: one short page. /long?n=…: a long page with a link to the next one.
const server = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/long") {
    const n = u.searchParams.get("n");
    const para = "<p>" + "Levain and starter notes. ".repeat(40) + "</p>";
    return res.end(`<title>Long page ${n}</title><body style='background:#fff'><h1>Long page ${n}</h1><a id="next" href="/long?n=${n}x">Next</a>${para.repeat(30)}</body>`);
  }
  res.end("<title>Proofing box temperatures</title><body style='background:#fff'><h1>Proofing box temperatures</h1><p>Most bakers keep a proofing box between 24 and 27 C.</p></body>");
});
const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ firstRunDone: true }));
const day = (s) => Date.parse(s);
const sessions = path.join(userData, "sessions");
fs.mkdirSync(sessions);
fs.writeFileSync(
  path.join(sessions, "s-sour.json"),
  JSON.stringify({
    id: "s-sour",
    name: "Sourdough starters",
    started: day("2026-10-27T14:00:00Z"),
    updated: day("2026-10-28T09:41:00Z"),
    pins: ["hydration"],
    trail: [
      { url: "https://kingarthurbaking.com/cold", title: "Keeping a starter in a cold kitchen", firstAt: day("2026-10-27T14:10:00Z"), lastAt: day("2026-10-27T14:13:00Z"), visits: 2, keywords: ["temperature"] },
      { url: "https://en.wikipedia.org/wiki/Sourdough", title: "Sourdough", firstAt: day("2026-10-27T14:05:00Z"), lastAt: day("2026-10-27T14:05:00Z"), visits: 1, keywords: [] },
    ],
    opened: [],
    dismissed: [],
    threadList: [{ id: "q1", title: "Why do starters fail in winter?", status: "open", conclusion: "", tags: [], pages: ["https://kingarthurbaking.com/cold"], by: "Sven", at: day("2026-10-27T14:02:00Z"), replies: [] }],
  }),
);
fs.writeFileSync(path.join(sessions, "s-curie.json"), JSON.stringify({ id: "s-curie", name: "Curie / radium", started: day("2026-10-21T19:00:00Z"), updated: day("2026-10-22T21:00:00Z"), pins: [], trail: [{ url: "https://en.wikipedia.org/wiki/Marie_Curie", title: "Marie Curie", firstAt: day("2026-10-21T19:41:00Z"), lastAt: day("2026-10-21T19:45:00Z"), visits: 1, keywords: ["radium"] }], opened: [], dismissed: [] }));
fs.writeFileSync(path.join(sessions, "current.txt"), "s-sour");

async function launch(dir = userData) {
  const app = await electron.launch({ executablePath: require("electron"), args: ["--no-sandbox", `--user-data-dir=${dir}`, path.join(__dirname, "..", "..")] });
  await app.evaluate(() => {
    const o = globalThis.fetch;
    globalThis.fetch = async (u, opt) => (/wikipedia|duckduckgo|brave\.com/.test(String(u)) ? new Response("{}", { status: 200 }) : o(u, opt));
  });
  const ui = await app.firstWindow();
  await sleep(1800);
  return { app, ui };
}

// A menu item, chosen as a person would (its keys do the same).
function menu(app, label) {
  return app.evaluate(({ Menu, BrowserWindow }, label) => {
    const find = (items) => {
      for (const it of items) {
        if (it.label === label) return it;
        const sub = it.submenu && find(it.submenu.items);
        if (sub) return sub;
      }
    };
    find(Menu.getApplicationMenu().items).click(undefined, BrowserWindow.getAllWindows()[0]);
  }, label);
}
const canvasShown = (ui) => ui.evaluate(() => !document.getElementById("canvas").hidden);
const pageViews = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length);
const tabCount = (ui) => ui.evaluate(() => tabs.length);

(async () => {
  let { app, ui } = await launch();
  const trails = path.join(userData, "trails");
  check("first start makes userData/trails/ with one folder per session", fs.existsSync(path.join(trails, "index.json")) && fs.existsSync(path.join(trails, "s-sour", "trail.json")) && fs.existsSync(path.join(trails, "s-sour", "events.jsonl")) && fs.existsSync(path.join(trails, "s-curie", "view.json")));
  check("the old sessions/ files are left in place", fs.existsSync(path.join(sessions, "s-sour.json")));
  let t = await ui.evaluate(() => window.scout.trailGet());
  check("NODE opens on the trail that was current", t?.trail.id === "s-sour", t?.trail.id);
  const kinds = (t?.cards || []).map((c) => c.kind).sort().join();
  check("existing session data shows as cards: the read page and the thread", kinds === "page,question", kinds);
  const only = t.timeline.flatMap((s) => s.items).filter((i) => i.timelineOnly).map((i) => i.title);
  check("a quick visit stays timeline-only", only.join() === "Sourdough", only.join());
  const r = await ui.evaluate(() => window.scout.researchGet());
  check("research:get still works over the trail store", r?.trail?.length === 2 && r.threadList?.[0]?.id === "q1" && r.pins.join() === "hydration");
  const list = await ui.evaluate(() => window.scout.trailList());
  check("trail:list has both trails, current first", list.length === 2 && list[0].id === "s-sour" && list[0].current && list[1].name === "Curie / radium", JSON.stringify(list.map((x) => x.name)));

  await ui.evaluate(() => window.scout.researchVisit("https://example.com/new-page", "A new page", ["new"]));
  t = await ui.evaluate(() => window.scout.trailGet());
  check("a visit through research:* lands in the trail's event log", t.timeline.flatMap((s) => s.items).some((i) => i.title === "A new page") && fs.readFileSync(path.join(trails, "s-sour", "events.jsonl"), "utf8").includes("example.com/new-page"));

  await ui.evaluate(() => window.scout.trailView({ x: -120, y: 60, z: 0.6, selected: "q1" }));
  const sw = await ui.evaluate(() => window.scout.trailSwitch("s-curie"));
  check("trail:switch changes the current trail", sw?.trail.id === "s-curie" && (await ui.evaluate(() => window.scout.researchGet())).name === "Curie / radium");
  await ui.evaluate(() => window.scout.trailSwitch("s-sour"));
  await app.close();

  ({ app, ui } = await launch());
  t = await ui.evaluate(() => window.scout.trailGet());
  check("after a restart NODE opens on the last trail at its saved position", t.trail.id === "s-sour" && t.view.x === -120 && t.view.z === 0.6 && t.view.selected === "q1", JSON.stringify(t.view));
  const evCount = fs.readFileSync(path.join(trails, "s-sour", "events.jsonl"), "utf8").trim().split("\n").length;
  check("the migration does not run twice", (await ui.evaluate(() => window.scout.trailList())).length === 2 && evCount < 12, String(evCount));

  // ---- B101, B102: the canvas ----
  await ui.waitForSelector("#canvas:not([hidden]) .cv-card", { timeout: 5000 });
  await sleep(300);
  const cv = await ui.evaluate(() => {
    const el = document.getElementById("canvas");
    return {
      shown: !el.hidden,
      cards: el.querySelectorAll(".cv-card").length,
      kinds: [...el.querySelectorAll(".cv-card")].map((c) => c.className.match(/k-(\w+)/)[1]).sort().join(),
      you: el.querySelectorAll(".cv-ln.you line").length,
      ends: el.querySelectorAll(".cv-ln.you .cv-end").length,
      key: el.querySelectorAll(".cv-key-row").length,
      mini: el.querySelectorAll(".cv-mini-card").length,
      layer: el.querySelector(".cv-layer").style.transform,
      zoom: el.dataset.zoom,
      selected: el.querySelector(".cv-card.selected")?.dataset.id,
      dot: getComputedStyle(el.querySelector(".cv-grid")).backgroundImage,
    };
  });
  const cardsNow = (await ui.evaluate(() => window.scout.trailGet())).cards.length;
  check("NODE opens on the trail's canvas, showing its cards", cv.shown && cv.cards === cardsNow && cv.kinds === "page,question", JSON.stringify(cv));
  check("a thread's page is joined to its question by a drawn line with end dots", cv.you === 1 && cv.ends === 2);
  check("the canvas opens at the trail's saved position, zoom and selection", cv.layer === "translate(-120px, 60px) scale(0.6)" && cv.zoom === "60" && cv.selected === "q1", cv.layer);
  check("line key with four line types, minimap with every card, dot grid in the canvas-dot token", cv.key === 4 && cv.mini === cv.cards && /rgb\(35, 35, 38\)/.test(cv.dot), cv.dot);

  const box = await ui.locator("#canvas .cv-vp").boundingBox();
  await ui.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await ui.mouse.wheel(40, 100);
  await sleep(100);
  const panned = await ui.evaluate(() => document.querySelector("#canvas .cv-layer").style.transform);
  check("two-finger scroll pans", panned === "translate(-160px, -40px) scale(0.6)", panned);
  const zoomBy = (dy) =>
    ui.evaluate((dy) => {
      const vp = document.querySelector("#canvas .cv-vp");
      const r = vp.getBoundingClientRect();
      vp.dispatchEvent(new WheelEvent("wheel", { deltaY: dy, ctrlKey: true, clientX: r.left + 300, clientY: r.top + 200, bubbles: true, cancelable: true }));
      return document.getElementById("canvas").dataset.zoom;
    }, dy);
  const zIn = await zoomBy(-1000), zOut = await zoomBy(1000);
  check("pinch zooms and stops at 250% and 20%", zIn === "250" && zOut === "20", `${zIn} ${zOut}`);
  await ui.click("#canvas .cv-fit");
  await sleep(500);
  const fitted = await ui.evaluate(() => {
    const vp = document.querySelector("#canvas .cv-vp").getBoundingClientRect();
    const inside = [...document.querySelectorAll("#canvas .cv-card")].every((c) => {
      const r = c.getBoundingClientRect();
      return r.left >= vp.left && r.top >= vp.top && r.right <= vp.right && r.bottom <= vp.bottom;
    });
    return { inside, zoom: Number(document.getElementById("canvas").dataset.zoom) };
  });
  check("Fit puts every card on screen at 100% or less", fitted.inside && fitted.zoom <= 100 && fitted.zoom >= 20, JSON.stringify(fitted));
  await ui.click("#canvas .cv-zin");
  await sleep(900);
  const saved = (await ui.evaluate(() => window.scout.trailGet())).view;
  check("the new position and zoom are saved to the trail", Math.round(saved.z * 100) === Math.min(250, Math.round(fitted.zoom * 1.25)), JSON.stringify(saved));
  const firstRow = await ui.evaluate(() => {
    const cv = document.getElementById("canvas-tab");
    return { shown: !cv.hidden, before: Boolean(cv.compareDocumentPosition(document.getElementById("tabs")) & Node.DOCUMENT_POSITION_FOLLOWING), active: cv.classList.contains("active"), pageActive: document.querySelectorAll("#tabs .tab.active").length };
  });
  check("the canvas is first in the tab list and marked as the open one", firstRow.shown && firstRow.before && firstRow.active && firstRow.pageActive === 0, JSON.stringify(firstRow));
  check("no custom new tab address in Settings", (await ui.evaluate(() => !document.getElementById("start-page") && !("startPage" in window.scout))) && !("startPage" in (await ui.evaluate(() => window.scout.getSettings()))));

  // ⌘T: the canvas with its search bar ready; no page tab opens.
  const before = await tabCount(ui);
  await menu(app, "New Tab");
  await sleep(400);
  const focused = await ui.evaluate(() => document.activeElement?.closest(".cv-search") !== null);
  check("⌘T shows the canvas with the cursor in its search bar, and opens no page tab", (await canvasShown(ui)) && focused && (await tabCount(ui)) === before);
  await ui.keyboard.type("http://127.0.0.1:1/x");
  await ui.keyboard.press("Enter");
  await sleep(800);
  const typed = { shown: await canvasShown(ui), tabs: await tabCount(ui), views: await pageViews(app) };
  check("an address typed there opens in a new page tab and leaves the canvas", !typed.shown && typed.tabs === before + 1, JSON.stringify({ before, ...typed }));
  await menu(app, "Tab 1");
  await sleep(300);
  check("⌘1 goes back to the canvas", await canvasShown(ui));
  await menu(app, "Tab 2");
  await sleep(300);
  check("⌘2 is the first page tab", !(await canvasShown(ui)));
  await ui.evaluate(() => window.scout.closeTab(activeId));
  await sleep(500);
  check("closing the last page tab comes back to the canvas", (await canvasShown(ui)) && (await tabCount(ui)) === 0);

  // An empty trail.
  await ui.evaluate(() => window.scout.trailNew("Proofing"));
  await ui.waitForFunction(() => document.getElementById("canvas").classList.contains("is-empty"), null, { timeout: 4000 }).catch(() => {});
  const empty = await ui.evaluate(() => ({
    heading: getComputedStyle(document.querySelector("#canvas .cv-heading")).display !== "none" ? document.querySelector("#canvas .cv-heading").textContent : "",
    resume: [...document.querySelectorAll("#canvas .cv-resume-item .cv-resume-name")].map((e) => e.textContent),
    resumeShown: !document.querySelector("#canvas .cv-resume").hidden,
  }));
  check("a new trail opens empty: \"What are you looking into?\" and \"Pick up where you left off\"", empty.heading === "What are you looking into?" && empty.resumeShown && empty.resume.includes("Sourdough starters"), JSON.stringify(empty));
  await ui.click("#canvas .cv-resume-item");
  await ui.waitForFunction(() => document.querySelectorAll("#canvas .cv-card").length > 0, null, { timeout: 4000 }).catch(() => {});
  check("picking a trail there opens its canvas", (await ui.evaluate(() => window.scout.trailGet())).trail.id === "s-sour" && (await ui.evaluate(() => document.querySelectorAll("#canvas .cv-card").length)) > 0);
  await app.close();

  // An open tab's card: its picture and the Tab mark.
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const pageUrl = `http://127.0.0.1:${server.address().port}/proofing`;
  const ud2 = fs.mkdtempSync(path.join(OUT, "ud-"));
  fs.writeFileSync(path.join(ud2, "settings.json"), JSON.stringify({ firstRunDone: true }));
  fs.mkdirSync(path.join(ud2, "sessions"));
  const pages = Array.from({ length: 200 }, (_, i) => ({ url: i ? `https://example.com/p${i}` : pageUrl, title: i ? `Page ${i} about sourdough starters and how they behave` : "Proofing box temperatures", firstAt: day("2026-10-27T14:00:00Z") + i * 60000, lastAt: day("2026-10-27T14:00:00Z") + i * 60000 + 30000, visits: 2, keywords: ["starter", "levain", "hydration"] }));
  const threads = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, title: `Question ${i}`, status: i % 4 ? "open" : "resolved", conclusion: "", tags: [], pages: pages.slice(i * 9, i * 9 + 3).map((p) => p.url), by: "Sven", at: day("2026-10-27T14:00:00Z"), replies: [{ by: "Sven", text: "Still reading.", at: day("2026-10-27T15:00:00Z") }] }));
  fs.writeFileSync(path.join(ud2, "sessions", "s-big.json"), JSON.stringify({ id: "s-big", name: "Big trail", started: day("2026-10-27T14:00:00Z"), updated: day("2026-10-28T14:00:00Z"), pins: [], trail: pages, opened: [], dismissed: [], threadList: threads }));
  fs.writeFileSync(path.join(ud2, "sessions", "current.txt"), "s-big");
  ({ app, ui } = await launch(ud2));
  await ui.evaluate((u) => window.scout.createTab(u), pageUrl);
  await sleep(2000);
  await menu(app, "Trail Canvas");
  await ui.waitForSelector("#canvas:not([hidden]) .cv-card", { timeout: 5000 });
  await sleep(500);
  const sel = await ui.evaluate(() => document.querySelector("#canvas .cv-card.selected .cv-card-title")?.textContent);
  check("⌘E from a page shows the canvas with that page's card selected", sel === "Proofing box temperatures", sel);
  const tabCard = await ui.evaluate((u) => {
    const cards = [...document.querySelectorAll("#canvas .cv-card")];
    const open = cards.filter((c) => c.classList.contains("open"));
    return { total: cards.length, open: open.length, mark: open[0]?.querySelector(".cv-tab-mark")?.textContent, shot: (open[0]?.querySelector(".cv-shot")?.src || "").slice(0, 22) };
  }, pageUrl);
  check("200 page cards and 20 questions are drawn", tabCard.total === 220, String(tabCard.total));
  check("the card of a page open in a tab shows its picture and the Tab mark", tabCard.open === 1 && tabCard.mark === "Tab" && tabCard.shot === "data:image/jpeg;base64", JSON.stringify(tabCard));
  await menu(app, "Trail Canvas");
  await sleep(400);
  check("⌘E on the canvas goes back to the page", !(await canvasShown(ui)) && (await ui.evaluate(() => tabs.find((t) => t.id === activeId)?.url)) === pageUrl);
  await menu(app, "Trail Canvas");
  await ui.waitForSelector("#canvas:not([hidden]) .cv-card", { timeout: 5000 });
  await sleep(300);

  // Frame times while panning and zooming 220 cards, one wheel event a frame.
  const perf = await ui.evaluate(
    () =>
      new Promise((done) => {
        const vp = document.querySelector("#canvas .cv-vp");
        const r = vp.getBoundingClientRect();
        const times = [];
        let last = performance.now(), i = 0;
        const frame = (now) => {
          times.push(now - last);
          last = now;
          const zoom = i % 120 >= 60;
          vp.dispatchEvent(new WheelEvent("wheel", zoom ? { deltaY: i % 120 < 90 ? -4 : 4, ctrlKey: true, clientX: r.left + 400, clientY: r.top + 300 } : { deltaX: 6, deltaY: 4 }));
          if (++i < 240) requestAnimationFrame(frame);
          else {
            const t = times.slice(2).sort((a, b) => a - b);
            done({ avg: t.reduce((a, b) => a + b, 0) / t.length, p95: t[Math.floor(t.length * 0.95)], frames: t.length });
          }
        };
        requestAnimationFrame(frame);
      }),
  );
  console.log(`  frame times with 220 cards: average ${perf.avg.toFixed(1)} ms, 95th percentile ${perf.p95.toFixed(1)} ms over ${perf.frames} frames`);
  check("panning and zooming 220 cards keeps frames under 50 ms here (60 fps is checked on an M1 Mac)", perf.p95 < 50, `${perf.p95.toFixed(1)} ms`);
  await app.close();

  // ---- B104: pages becoming cards ----
  const ud3 = fs.mkdtempSync(path.join(OUT, "ud-"));
  fs.writeFileSync(path.join(ud3, "settings.json"), JSON.stringify({ firstRunDone: true }));
  ({ app, ui } = await launch(ud3));
  const BASE2 = `http://127.0.0.1:${server.address().port}`;
  const cardsNow2 = async () => (await ui.evaluate(() => window.scout.trailGet())).cards;
  const focus = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
  const pageView = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.find((v) => v.webContents && /\/long|\/proofing/.test(v.webContents.getURL())));
  await ui.evaluate((u) => window.scout.createTab(u), `${BASE2}/long?n=a`);
  await sleep(2000);
  await focus();
  // A scroll by hand: wheel events on the page.
  await app.evaluate(async ({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children.find((x) => x.webContents && /\/long/.test(x.webContents.getURL()));
    for (let i = 0; i < 12; i++) {
      v.webContents.sendInputEvent({ type: "mouseWheel", x: 300, y: 300, deltaX: 0, deltaY: -120 });
      await new Promise((r) => setTimeout(r, 60));
    }
  });
  await sleep(1500);
  let cs = await cardsNow2();
  const a = cs.find((c) => /n=a$/.test(c.url || ""));
  check("a page scrolled by hand becomes a card", Boolean(a), JSON.stringify(cs.map((c) => c.url)));
  // A link from it: the next page, kept on screen 20 s.
  await app.evaluate(async ({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children.find((x) => x.webContents && /\/long/.test(x.webContents.getURL()));
    await v.webContents.executeJavaScript(`window.scrollTo(0,0); document.getElementById("next").click()`);
  });
  await sleep(4000);
  check("before 20 s it is not a card yet", !(await cardsNow2()).some((c) => /n=ax$/.test(c.url || "")));
  for (let i = 0; i < 20; i++) {
    await focus();
    await sleep(1000);
  }
  await sleep(1500);
  const t3 = await ui.evaluate(() => window.scout.trailGet());
  const b = t3.cards.find((c) => /n=ax$/.test(c.url || ""));
  check("after 20 s on screen the page becomes a card", Boolean(b), JSON.stringify(t3.cards.map((c) => c.url)));
  check("with an \"opened from\" line from the page it was opened from", b && t3.lines.some((l) => l.kind === "nav" && l.from === a?.id && l.to === b.id), JSON.stringify(t3.lines));
  check("placed next to it without overlapping", b && a && Math.hypot(b.x - a.x, b.y - a.y) < 700 && !(b.x < a.x + a.w && a.x < b.x + b.w && b.y < a.y + a.h && a.y < b.y + b.h), JSON.stringify({ a: [a?.x, a?.y], b: [b?.x, b?.y] }));
  // A short visit.
  await ui.evaluate((u) => window.scout.navigate(activeId, u), `${BASE2}/proofing`);
  await sleep(3500);
  await ui.evaluate((u) => window.scout.navigate(activeId, u), `${BASE2}/long?n=c`);
  await sleep(1500);
  const items = (await ui.evaluate(() => window.scout.trailTimeline())).flatMap((x) => x.items);
  const short = items.find((i) => /proofing/.test(i.url || ""));
  check("a short visit stays timeline-only, with its time on page", short?.timelineOnly && short.dwell >= 1000 && short.dwell < 20000, JSON.stringify(short));
  // Put on canvas and Remove from canvas.
  await ui.evaluate((u) => window.scout.trailPlace({ url: u }), `${BASE2}/proofing`);
  cs = await cardsNow2();
  const p = cs.find((c) => /proofing/.test(c.url || ""));
  check("Put on canvas makes a timeline-only page a card", Boolean(p));
  await ui.evaluate((id) => window.scout.trailRemove(id), b.id);
  let t4 = await ui.evaluate(() => window.scout.trailGet());
  check("Remove from canvas takes the card off and hides its lines", !t4.cards.some((c) => c.id === b.id) && t4.removed.includes(b.id));
  check("the removed page shows in the timeline as removed", (await ui.evaluate(() => window.scout.trailTimeline())).flatMap((x) => x.items).some((i) => /n=ax$/.test(i.url || "") && i.removedFromCanvas));
  await ui.evaluate((id) => window.scout.trailPlace({ card: id }), b.id);
  t4 = await ui.evaluate(() => window.scout.trailGet());
  check("putting it back brings its lines back", t4.cards.some((c) => c.id === b.id) && t4.lines.some((l) => l.kind === "nav" && l.to === b.id));
  // Canvas: the selected card's actions, and new cards in violet.
  await ui.evaluate(() => window.scout.canvasShow());
  await sleep(1200);
  await ui.click(`#canvas .cv-card[data-id="${p.id}"]`);
  await sleep(300);
  check("a selected card shows Open and Remove from canvas", await ui.evaluate(() => !document.querySelector("#canvas .cv-selbar").hidden && document.querySelector("#canvas .cv-selbar").textContent.includes("Remove from canvas")));
  await ui.click("#canvas .cv-selbar .quiet");
  await sleep(800);
  check("Remove from canvas on the canvas removes it", !(await ui.evaluate((id) => Boolean(document.querySelector(`#canvas .cv-card[data-id="${id}"]`)), p.id)));
  // Tabs still open when leaving the trail become cards.
  await ui.evaluate(() => tabs.length && window.scout.activateTab(tabs[0].id));
  await sleep(500);
  const before4 = (await cardsNow2()).length;
  const trailA = (await ui.evaluate(() => window.scout.trailGet())).trail.id;
  await ui.evaluate(() => window.scout.trailNew("Other"));
  await sleep(800);
  const old = await ui.evaluate((id) => window.scout.trailGet(id), trailA);
  check("a tab still open when leaving the trail becomes a card there", old.cards.filter((c) => !c.removed).length === before4 + 1 && old.cards.some((c) => /n=c$/.test(c.url || "")), JSON.stringify(old.cards.map((c) => c.url)));
  await app.close();
  server.close();
  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
