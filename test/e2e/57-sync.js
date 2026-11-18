// Sync (B50): Settings → Sync pairs with a QR code; trails sync both ways with
// a "phone" (core/ running in this test) through the relay (the share
// Worker's code on a local server). Deleting a trail on the phone deletes it
// here, with Undo. Removing the phone stops it syncing; Stop syncing keeps
// this computer's trails.
const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const path = require("path"), fs = require("fs"), os = require("os"), http = require("http");
const { TrailStore } = require("../../core/trail");
const { memoryStorage } = require("../../core/storage");
const { SyncEngine } = require("../../core/sync");
const { RelayClient, syncOnce } = require("../../core/sync-relay");
const Crypto = require("../../core/sync-crypto");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "node-e2e-"));
const RELAY_PORT = 8793;
const RELAY = `http://127.0.0.1:${RELAY_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(ok ? "✓" : "✗", name, detail ? `(${detail})` : "");
};
const userData = fs.mkdtempSync(path.join(OUT, "ud-"));
fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ firstRunDone: true }));

// The relay: the Worker's code with an in-memory bucket, on a local port.
async function startRelay() {
  const { default: worker } = await import("../../worker/src/index.js");
  const items = new Map();
  const relay = { delay: 0 };
  const env = {
    TRAILS: {
      items,
      async put(k, body, o) { items.set(k, { bytes: new Uint8Array(body), customMetadata: o?.customMetadata }); },
      async get(k) { const it = items.get(k); return it ? { customMetadata: it.customMetadata, body: new Blob([it.bytes]).stream(), arrayBuffer: async () => it.bytes.buffer.slice(0) } : null; },
      async delete(k) { items.delete(k); },
      async list({ prefix = "", startAfter } = {}) { return { objects: [...items.keys()].filter((k) => k.startsWith(prefix) && (!startAfter || k > startAfter)).sort().map((key) => ({ key })), truncated: false }; },
    },
  };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    if (relay.delay) await sleep(relay.delay); // a slow connection
    const r = await worker.fetch(new Request(`${RELAY}${req.url}`, { method: req.method, headers: req.headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : body }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise((r) => server.listen(RELAY_PORT, "127.0.0.1", r));
  return Object.assign(relay, { server, items });
}

(async () => {
  const relay = await startRelay();
  const app = await electron.launch({ executablePath: require("electron"), env: { ...process.env, NODE_SHARE_API: RELAY }, args: ["--no-sandbox", `--user-data-dir=${userData}`, path.join(__dirname, "..", "..")] });
  await app.evaluate(() => {
    const o = globalThis.fetch;
    globalThis.fetch = async (u, opt) => (/wikipedia|duckduckgo|brave\.com|x\.ai|11434/.test(String(u)) ? new Response("{}", { status: 200 }) : o(u, opt));
  });
  const ui = await app.firstWindow();
  await sleep(1800);
  const notice = () => ui.evaluate(() => (document.getElementById("notice").hidden ? "" : document.querySelector("#notice > div")?.textContent || ""));
  await ui.evaluate(() => window.scout.trailRename("Levain"));
  const levain = (await ui.evaluate(() => window.scout.trailGet())).trail.id;
  await ui.evaluate(() => window.scout.trailNote({ x: 0, y: 0, text: "Feed at 25°C" }));
  await sleep(400);

  // Settings → Sync: off, then Pair a device… shows the QR code.
  await ui.evaluate(() => openMenu("settings"));
  await sleep(800);
  let state = await ui.evaluate(() => document.getElementById("sync-state").textContent);
  check("Settings → Sync starts off, and says what it does", state === "Off. Your trails stay on this computer." && /can't read them/.test(await ui.evaluate(() => document.getElementById("sync-help").textContent)), state);
  await ui.click("#sync-pair-btn");
  await sleep(1500);
  const code = await ui.evaluate(() => document.getElementById("sync-qr").dataset.code);
  const qr = await ui.evaluate(() => ({ svg: Boolean(document.querySelector("#sync-qr svg .qr-fg")), shown: !document.getElementById("sync-pair").hidden }));
  check("Pair a device… shows a QR code with the pairing code", /^NODE-SYNC1:[A-Za-z0-9_-]{43}$/.test(code || "") && qr.svg && qr.shown, JSON.stringify(qr));
  await ui.locator("#sync-box").screenshot({ path: path.join(OUT, "57-pair.png") });
  const stored = fs.readFileSync(path.join(userData, "sync", "pairing.json"), "utf8");
  check("the code is kept on this computer (encrypted where the system allows), never in settings", !fs.readFileSync(path.join(userData, "settings.json"), "utf8").includes(code) && JSON.parse(stored) && (JSON.parse(stored).enc || JSON.parse(stored).plain === code));

  // The "phone" scans the code.
  const keys = Crypto.keysFrom(code);
  const phoneStore = new TrailStore(memoryStorage(), { device: "phone" });
  const phoneId = Crypto.newDeviceId();
  const phone = {
    engine: new SyncEngine(phoneStore, memoryStorage(), { device: phoneId }),
    client: new RelayClient({ api: RELAY, group: keys.group, auth: keys.auth, device: phoneId }),
    state: {},
  };
  const phoneRound = () => syncOnce({ engine: phone.engine, client: phone.client, key: keys.key, state: phone.state, me: { name: "Test iPhone", kind: "phone" } });
  phoneStore.current();
  await phoneRound(); // joins, sends everything, asks for everything
  await ui.click("#sync-now-btn");
  await sleep(1500);
  await phoneRound();
  check("the phone gets this computer's trail", phoneStore.get(levain)?.trail.name === "Levain" && phoneStore.snapshot(levain).cards.some((c) => c.text === "Feed at 25°C"));
  check("the phone knows this computer's name", Object.values(phone.state.peers || {}).some((p) => p.kind === "desktop" && p.name));
  await ui.click("#sync-now-btn");
  await sleep(1200);
  const rows = await ui.evaluate(() => [...document.querySelectorAll("#sync-list li")].map((li) => li.textContent));
  check("Settings lists this computer and the phone", rows.length === 2 && /This computer/.test(rows[0]) && /^Test iPhone Phone · last synced/.test(rows[1]), JSON.stringify(rows));
  check("once the phone shows up, the code closes and a notice says so", (await ui.evaluate(() => document.getElementById("sync-pair").hidden)) && (await notice()) === "Paired with Test iPhone. Trails now sync both ways.", await notice());
  state = await ui.evaluate(() => document.getElementById("sync-state").textContent);
  check("the state says when it last synced", /^On · synced (just now|\d+ min ago)$/.test(state), state);
  await ui.locator("#sync-box").screenshot({ path: path.join(OUT, "57-paired.png") });

  // The phone adds to the trail: a visit and a note.
  phoneStore.visit(levain, "https://example.com/phone-page", { title: "Read on the bus" });
  phoneStore.freeNote(levain, { x: 300, y: 0, text: "From the phone" });
  await phoneRound();
  await ui.evaluate(() => window.scout.syncNow());
  await sleep(800);
  const snap = await ui.evaluate(() => window.scout.trailGet());
  check("the phone's note arrives on the canvas", snap.cards.some((c) => c.text === "From the phone"));
  const tl = await ui.evaluate(() => window.scout.trailTimeline());
  check("its visit shows in the timeline as a phone session", tl.some((s) => s.device === "phone" && s.items.some((i) => i.title === "Read on the bus")), JSON.stringify(tl.map((s) => s.device)));

  // This computer renames the trail and moves a card: the phone gets both.
  await ui.evaluate(() => window.scout.trailRename("Levain notes"));
  const note = snap.cards.find((c) => c.text === "Feed at 25°C");
  await ui.evaluate((id) => window.scout.trailMove(id, 640, 320), note.id);
  await sleep(300);
  await ui.evaluate(() => window.scout.syncNow());
  await phoneRound();
  const pn = phoneStore.card(levain, note.id);
  check("a rename and a move here reach the phone", phoneStore.get(levain).trail.name === "Levain notes" && pn.x === 640 && pn.y === 320, JSON.stringify({ name: phoneStore.get(levain).trail.name, x: pn.x }));

  // No Sync now: an edit here goes out by itself a moment later.
  await ui.evaluate(() => window.scout.trailNote({ x: 0, y: 400, text: "Sent by itself" }));
  await sleep(3500);
  await phoneRound();
  check("an edit here reaches the phone by itself, without Sync now", phoneStore.snapshot(levain).cards.some((c) => c.text === "Sent by itself"));

  // Sync now on a slow connection: "Syncing…" at once, button greyed out.
  await ui.evaluate(() => openMenu("settings"));
  await sleep(500);
  relay.delay = 600;
  await ui.click("#sync-now-btn");
  await sleep(150);
  const during = await ui.evaluate(() => ({ state: document.getElementById("sync-state").textContent, label: document.getElementById("sync-now-btn").textContent, disabled: document.getElementById("sync-now-btn").disabled }));
  await sleep(3000);
  relay.delay = 0;
  const after = await ui.evaluate(() => ({ state: document.getElementById("sync-state").textContent, label: document.getElementById("sync-now-btn").textContent, disabled: document.getElementById("sync-now-btn").disabled }));
  check("Sync now shows Syncing… with the button greyed out, then Synced just now", during.state === "On · syncing…" && during.label === "Syncing…" && during.disabled && /^On · synced just now/.test(after.state) && after.label === "Sync now" && !after.disabled, JSON.stringify({ during, after }));
  await ui.evaluate(() => closeMenu());

  // A trail made on the phone, then deleted there.
  const bus = phoneStore.create("Bus reading", { current: false }).trail.id;
  phoneStore.freeNote(bus, { x: 0, y: 0, text: "rye malt" });
  await phoneRound();
  await ui.evaluate(() => window.scout.syncNow());
  check("a trail made on the phone arrives here", (await ui.evaluate(() => window.scout.trailList())).some((t) => t.id === bus && t.name === "Bus reading"));
  phoneStore.remove(bus);
  await phoneRound();
  await ui.evaluate(() => window.scout.syncNow());
  await sleep(500);
  const said = await notice();
  check("deleted on the phone: gone here, with a notice naming the phone", !(await ui.evaluate(() => window.scout.trailList())).some((t) => t.id === bus) && said === "“Bus reading” was deleted on Test iPhone.", said);
  await ui.evaluate(() => [...document.querySelectorAll("#notice button")].find((b) => b.textContent === "Undo").click());
  await sleep(800);
  check("Undo brings it back here", (await ui.evaluate(() => window.scout.trailList())).some((t) => t.id === bus));
  await ui.evaluate(() => window.scout.syncNow());
  await phoneRound();
  check("and on the phone", phoneStore.has(bus));

  // Nothing readable on the relay.
  const raw = Buffer.concat([...relay.items.values()].map((v) => Buffer.from(v.bytes))).toString("latin1") + JSON.stringify([...relay.items].map(([k, v]) => [k, v.customMetadata]));
  check("the relay holds nothing readable: no trail names, notes, device names or the code", !/Levain|Feed at|From the phone|Bus reading|Test iPhone/.test(raw) && !raw.includes(code.split(":")[1]));

  // Remove the phone: it is told to pair again.
  await ui.evaluate(() => openMenu("settings"));
  await sleep(600);
  await ui.evaluate(() => [...document.querySelectorAll("#sync-list li")].find((li) => /Test iPhone/.test(li.textContent)).querySelector("button").click());
  await sleep(800);
  let phoneErr = null;
  await phoneRound().catch((e) => (phoneErr = e));
  check("Remove: the phone can no longer sync", phoneErr?.unpaired === true && (await ui.evaluate(() => document.querySelectorAll("#sync-list li").length)) === 2, phoneErr?.message);

  // Stop syncing: off again, trails stay.
  await ui.click("#sync-stop-btn");
  await sleep(800);
  state = await ui.evaluate(() => document.getElementById("sync-state").textContent);
  check("Stop syncing turns it off and keeps this computer's trails", state === "Off. Your trails stay on this computer." && (await ui.evaluate(() => window.scout.trailList())).some((t) => t.id === levain) && !fs.existsSync(path.join(userData, "sync", "pairing.json")), state);
  check("and the relay no longer has the group", ![...relay.items.keys()].some((k) => k.includes(keys.group)));

  await app.close();
  relay.server.close();
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
