// Automatic active count (B116): once a day, one request with the version
// and OS (and first-this-week, first-this-month marks), nothing else. On by
// default, said on the welcome screen, off in Settings → Help.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path"), fs = require("fs"), os = require("os"), http = require("http");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "node-e2e-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(ok ? "✓" : "✗", name, detail ? `(${detail})` : "");
};
const userData = fs.mkdtempSync(path.join(OUT, "ud-"));

(async () => {
  // A stand-in for the count server that keeps what it receives.
  const got = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      got.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.writeHead(204).end();
    });
  });
  await new Promise((r) => server.listen(8791, "127.0.0.1", r));

  const app = await electron.launch({ executablePath: require("electron"), env: { ...process.env, NODE_FIRST_RUN: "1", NODE_ACTIVE_API: "http://127.0.0.1:8791/api/active" }, args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")] });
  const ui = await app.firstWindow();
  await sleep(1800);

  // First run: the welcome screen says it.
  const welcome = await ui.evaluate(() => ({ shown: !document.getElementById("firstrun").hidden, text: document.getElementById("fr-active")?.textContent || "" }));
  check("the welcome screen says NODE sends one anonymous count a day", welcome.shown && welcome.text === "NODE sends one anonymous count a day: its version and your operating system, nothing else. Turn it off in Settings → Help.", JSON.stringify(welcome));
  await ui.click("#fr-done");
  await sleep(800);
  check("on by default", (await ui.evaluate(() => window.scout.getSettings())).activeCount === true);

  // One count.
  const sent = await app.evaluate(() => global.nodeTest.sendActiveCount());
  await sleep(300);
  const v = await app.evaluate(({ app }) => app.getVersion());
  const osName = { darwin: "mac", win32: "windows", linux: "linux" }[process.platform] || "other";
  check("one request", got.length === 1 && got[0].method === "POST" && got[0].url === "/api/active", JSON.stringify(got.map((g) => g.url)));
  check("with only the version, the OS and the week and month marks", got[0] && got[0].body === JSON.stringify({ v, os: osName, w: true, m: true }), got[0]?.body);
  check("no cookies, no referrer, no id in the headers", got[0] && !got[0].headers.cookie && !got[0].headers.referer && !Object.keys(got[0].headers).some((h) => /id|token|auth/i.test(h)), JSON.stringify(got[0]?.headers));
  check("NODE keeps only the day, week and month it last sent", JSON.stringify(Object.keys(JSON.parse(fs.readFileSync(path.join(userData, "active-count.json"), "utf8")))) === '["day","week","month"]' && sent?.v === v);

  // Once a day.
  await app.evaluate(() => global.nodeTest.sendActiveCount());
  await sleep(300);
  check("no second count the same day", got.length === 1, String(got.length));

  // Settings → Help: the switch and what it sends.
  await ui.evaluate(() => openMenu?.("settings") ?? document.getElementById("settings-open")?.click());
  await sleep(800);
  const help = await ui.evaluate(() => {
    const cb = document.getElementById("active-count");
    return { checked: cb?.checked, label: cb?.closest("label")?.textContent.trim(), help: cb?.closest(".top")?.nextElementSibling?.textContent || "" };
  });
  check("Settings → Help has the switch, on, with what it sends", help.checked === true && help.label === "Send one anonymous count a day" && /version and your operating system \(Mac, Windows or Linux\), and nothing else: no id, pages, addresses or keywords/.test(help.help), JSON.stringify(help));

  // Off: nothing is sent, even on a new day.
  await ui.evaluate(() => window.scout.setSettings({ activeCount: false }));
  fs.rmSync(path.join(userData, "active-count.json"));
  await app.evaluate(() => global.nodeTest.sendActiveCount());
  await sleep(300);
  check("turned off, nothing is sent", got.length === 1, String(got.length));
  check("and it stays off", (await ui.evaluate(() => window.scout.getSettings())).activeCount === false);

  // The server down: no error for the user, tried again later.
  await ui.evaluate(() => window.scout.setSettings({ activeCount: true }));
  server.close();
  await sleep(200);
  const r = await app.evaluate(() => global.nodeTest.sendActiveCount());
  check("server down: nothing breaks, and it isn't marked as sent", r === null && !fs.existsSync(path.join(userData, "active-count.json")));

  await app.close();
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
