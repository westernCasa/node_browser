// Phone trail screens (CM1-CM5): the logic, with no React Native imports so it
// runs in Node tests (mobile/test/trail-flow.test.js). Built on the shared
// core/ trail modules; core/ itself is not changed.
const TrailFile = require("../../core/trail-file");
const Replay = require("../../core/replay");
const { isSensitiveUrl } = require("../../core/urls");

const FILE_MAX = 5 * 1024 * 1024; // same limit as desktop
const NOTE_MAX = 300;

// "2 min ago", "3 h ago", "yesterday", "Oct 27".
function ago(at, now = Date.now()) {
  if (!at) return "";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 2 * 86400) return "yesterday";
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function hhmm(at) {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function dayLabel(at, now = Date.now()) {
  const d = new Date(at);
  const n = new Date(now);
  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, n)) return "Today";
  const y = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
  if (same(d, y)) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const DEVICE = { phone: "Phone", desktop: "Desktop", tablet: "Tablet" };

// Sessions for the timeline list (CM1): newest first, each item with the
// card it points at (for the preview) and a short line under the title.
function timelineRows(snap, now = Date.now()) {
  if (!snap) return [];
  const byId = new Map(snap.cards.map((c) => [c.id, c]));
  return (snap.timeline || []).map((s) => ({
    id: s.id,
    label: `${dayLabel(s.startAt, now)} · ${DEVICE[s.device] || s.device} · ${hhmm(s.startAt)}–${hhmm(s.endAt)}`,
    items: s.items.map((it) => {
      const card = it.card ? byId.get(it.card) || null : null;
      const bits = [];
      if (it.url) bits.push(hostOf(it.url));
      if (it.type === "opened" && typeof it.dwell === "number") bits.push(Replay.dwellText(it.dwell));
      if (it.timelineOnly) bits.push("timeline only");
      else if (card) bits.push(KIND_LABEL[card.kind] || "card");
      return { key: it.event || `${s.id}:${it.at}:${it.title}`, at: it.at, time: hhmm(it.at), title: it.title, url: it.url || card?.url || "", card, sub: bits.filter(Boolean).join(" · "), timelineOnly: Boolean(it.timelineOnly) };
    }),
  }));
}

function hostOf(url) {
  const m = /^[a-z]+:\/\/([^/?#:]+)/i.exec(String(url || ""));
  return m ? m[1].replace(/^www\./, "") : "";
}

const KIND_LABEL = { page: "page", video: "video", capture: "capture", report: "report", question: "question", note: "note", voice: "voice note", search: "search", media: "media" };

// What a card shows: a kicker, a title and up to a few lines of text.
function cardFace(c) {
  const title = TrailFile.cardTitle(c);
  let text = "";
  if (c.kind === "capture") text = c.quote ? `“${c.quote}”` : "";
  else if (c.kind === "question") text = c.status === "resolved" ? `Resolved${c.conclusion ? `: ${c.conclusion}` : ""}` : lastReplyText(c.replies) || "Open question";
  else if (c.kind === "report") text = c.text || c.excerpt || "";
  else if (c.kind === "note") text = c.title ? c.text || "" : "";
  else text = c.excerpt || c.text || (c.keywords || []).join(", ");
  const kicker = [KIND_LABEL[c.kind === "media" ? "media" : c.kind] || "card", hostOf(c.url)].filter(Boolean).join(" · ");
  return { kicker, title, text: String(text || "").replace(/\s+/g, " ").trim() };
}

function lastReplyText(list) {
  let last = null;
  const walk = (l) => (l || []).forEach((r) => ((last = r), walk(r.replies)));
  walk(list);
  return last?.text || "";
}

// The area every card and group covers, in world units.
function worldBounds(snap) {
  const boxes = [...(snap?.cards || []), ...(snap?.groups || []).filter((g) => !g.suggested)].filter((b) => [b.x, b.y, b.w, b.h].every(Number.isFinite));
  if (!boxes.length) return { x: 0, y: 0, w: 600, h: 400 };
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

const Z_MIN = 0.1;
const Z_MAX = 2.5;
const clampZ = (z) => Math.min(Z_MAX, Math.max(Z_MIN, z));

// A view {x, y, z} (screen = world * z + offset) that shows the whole box.
function fitView(box, width, height, pad = 24) {
  const z = clampZ(Math.min((width - pad * 2) / Math.max(1, box.w), (height - pad * 2) / Math.max(1, box.h), 1));
  return { z, x: (width - box.w * z) / 2 - box.x * z, y: (height - box.h * z) / 2 - box.y * z };
}

// Zoom by `factor` keeping the screen point (fx, fy) still.
function zoomAt(view, factor, fx, fy) {
  const z = clampZ(view.z * factor);
  const k = z / view.z;
  return { z, x: fx - (fx - view.x) * k, y: fy - (fy - view.y) * k };
}

// Centre the screen on a world point.
function centreOn(view, wx, wy, width, height) {
  return { z: view.z, x: width / 2 - wx * view.z, y: height / 2 - wy * view.z };
}

// ---- opened files (CM3) ----

// Reads a picked file's text and opens it as a read-only trail. Returns
// { id } or { error } with a message that can be shown as is.
function openTrailText(store, text, { file = "", size } = {}) {
  if (size > FILE_MAX || String(text || "").length > FILE_MAX) return { error: "The file is too large for a trail (over 5 MB)." };
  let parsed;
  try {
    parsed = TrailFile.parseTrailMd(text);
  } catch (err) {
    return { error: err.message };
  }
  const data = store.importFile(parsed, { file, current: false });
  return { id: data.trail.id };
}

// Replay for a trail: the steps with captions, and what is on the canvas at
// step i.
function replayFor(store, id) {
  const snap = store.snapshot(id);
  if (!snap) return { steps: [], shownAt: () => null };
  const steps = Replay.replaySteps(snap, store.events(id));
  return { steps, shownAt: (i) => (steps.length ? Replay.shownAt(steps, Math.max(0, Math.min(i, steps.length - 1))) : null) };
}

// Save as new trail: an editable copy named "<name> · <sender>".
function saveAsNew(store, id) {
  const d = store.get(id);
  if (!d?.trail.readonly) return null;
  return store.saveAsNew(id).trail.id;
}

// ---- sharing (CM4, CM5) ----

function safeFileName(name) {
  return `${String(name || "Trail").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Trail"}.trail.md`;
}

// What goes in the file, for the share sheet's summary.
function shareSummary(snap) {
  const cards = (snap?.cards || []).filter((c) => !(c.url && isSensitiveUrl(c.url)));
  const items = (snap?.timeline || []).flatMap((s) => s.items).filter((i) => i.type === "opened" && !(i.url && isSensitiveUrl(i.url)));
  return {
    cards: cards.length,
    groups: (snap?.groups || []).filter((g) => !g.suggested).length,
    links: (snap?.lines || []).filter((l) => l.kind !== "suggested").length,
    timeline: items.length,
    timelineOnly: items.filter((i) => i.timelineOnly).length,
    startChoices: cards.map((c) => ({ id: c.id, title: TrailFile.cardTitle(c) })),
  };
}

// The file text. opts: { by, note, startHere, timeline (true) }.
function shareText(store, id, { by = "", note = "", startHere = "", timeline = true, at } = {}) {
  const snap = store.snapshot(id);
  if (!snap) return null;
  const d = snap.trail;
  return TrailFile.toTrailMd(snap, {
    by: by || (d.readonly ? d.from : ""),
    at: at ?? Date.now(),
    note: String(note || "").slice(0, NOTE_MAX),
    startHere: startHere || "",
    timeline: timeline !== false,
  });
}

function sizeText(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const byteLength = (text) => {
  let n = 0;
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
};

module.exports = {
  FILE_MAX,
  NOTE_MAX,
  ago,
  hhmm,
  dayLabel,
  hostOf,
  timelineRows,
  cardFace,
  worldBounds,
  fitView,
  zoomAt,
  centreOn,
  clampZ,
  openTrailText,
  replayFor,
  saveAsNew,
  safeFileName,
  shareSummary,
  shareText,
  sizeText,
  byteLength,
};
