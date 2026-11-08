// Replay (B110, handoff spec 5): the steps of a trail, oldest first, built
// from its event log. No Electron or DOM imports.
//
// replaySteps(snapshot, events) -> steps
//   snapshot: TrailStore.snapshot(id): { trail, cards, groups, lines, timeline }
//   events:   TrailStore.events(id), in time order
//
// One step for:
//   - each card on the canvas, at the first event that names it (opened,
//     placed, captured, asked, reported, noted);
//   - each visit that stayed in the timeline only (from the timeline, so a
//     page read twice in one session is one step);
//   - each line you drew, at the time you drew it (lines NODE drew show up
//     with their cards and are named in the card's caption);
//   - each group, at the time it was made, and each time it was renamed;
//   - each question resolved or reopened, and each group marked resolved.
// Moves, removals and unlinked lines are not steps: Replay runs on the
// canvas as it is now. Removed cards, removed lines and removed groups have
// no steps.
//
// Each step: { n, kind: "card" | "visit" | "link" | "group" | "rename" |
// "resolve", at, device, actor, who, card?, line?, group?, title, caption,
// session, first }. `session` counts sessions from 0 (a new one on another
// device or after a 30-minute gap); `first` marks a session's first step.
//
// stepCaption(step, ctx) writes the caption from a template per step kind
// (no AI). ctx: { byId, lines, groups, seen } where seen is the set of card
// ids reached so far (this step included).

const Prov = require("./provenance");
const clockOf = (t) => {
  t = Math.max(0, Math.round(Number(t) || 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};
const SESSION_GAP_MS = 30 * 60 * 1000;
const CARD_EVENTS = new Set(["opened", "placed", "captured", "asked", "reported", "noted"]);

const who = (actor) => (!actor || actor === "me" ? "You" : String(actor));
const site = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const cardTitle = (c) => (c ? String(c.title || c.text || c.quote || c.url || "a card").replace(/\s+/g, " ").trim() : "a card");
const q = (s) => `“${String(s).replace(/^Search:\s*/, "")}”`;
const centreIn = (c, g) => {
  const x = c.x + c.w / 2, y = c.y + c.h / 2;
  return x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h;
};
// "12 s", "3 min", "1 h 5 min".
function dwellText(ms) {
  if (typeof ms !== "number" || !(ms >= 0)) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
}
// A quote that ends with its own ?, ! or . needs no second full stop.
const tidy = (t) => t.replace(/([?!.])”\./g, "$1”").replace(/([?!.])\.$/, "$1").replace(/\s+/g, " ").trim();

function replaySteps(snapshot, events) {
  const cards = (snapshot?.cards || []).filter((c) => !c.removed);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const lines = (snapshot?.lines || []).filter((l) => byId.has(l.from) && byId.has(l.to));
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const groups = (snapshot?.groups || []).filter((g) => !g.suggested);
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const evs = (events || []).slice().sort((a, b) => a.at - b.at);
  const steps = [];
  let order = 0; // keeps steps at the same time in log order

  // Cards: the first event that names each one.
  const cardAt = new Map();
  for (const e of evs) {
    if (!e.card || !CARD_EVENTS.has(e.type) || !byId.has(e.card) || cardAt.has(e.card)) continue;
    cardAt.set(e.card, e);
    steps.push({ kind: "card", at: e.at, device: e.device, actor: e.actor, card: e.card, ev: e.type, o: order++ });
  }
  // A card with no event of its own (older data) goes first, in card order.
  for (const c of cards) if (!cardAt.has(c.id)) steps.push({ kind: "card", at: -Infinity, device: "desktop", actor: "me", card: c.id, ev: "placed", o: order++ });

  // Visits that stayed in the timeline only.
  const visitEvent = new Map(evs.map((e) => [e.id, e]));
  for (const s of snapshot?.timeline || []) {
    for (const it of s.items || []) {
      if (it.type !== "opened" || !it.timelineOnly) continue;
      const e = visitEvent.get(it.event) || {};
      steps.push({ kind: "visit", at: it.at, device: s.device, actor: e.actor, url: it.url || "", visitTitle: it.title || it.url || "a page", dwell: it.dwell, via: it.via, played: it.played, o: order++ });
    }
  }

  // Lines you drew, groups, renames and resolves, at their own times.
  const linked = new Set();
  const grouped = new Set();
  for (const e of evs) {
    if (e.type === "linked" && e.line && lineById.get(e.line)?.kind === "you" && !linked.has(e.line)) {
      linked.add(e.line);
      steps.push({ kind: "link", at: e.at, device: e.device, actor: e.actor, line: e.line, o: order++ });
    } else if (e.type === "grouped" && e.group && groupById.has(e.group) && !grouped.has(e.group)) {
      grouped.add(e.group);
      steps.push({ kind: "group", at: e.at, device: e.device, actor: e.actor, group: e.group, o: order++ });
    } else if (e.type === "renamed" && e.group && groupById.has(e.group)) {
      steps.push({ kind: "rename", at: e.at, device: e.device, actor: e.actor, group: e.group, label: e.data?.label || "", o: order++ });
    } else if (e.type === "resolved" && (byId.has(e.card) || groupById.has(e.group))) {
      const reopened = e.card ? e.data?.status === "open" : e.data?.resolved === false;
      steps.push({ kind: "resolve", at: e.at, device: e.device, actor: e.actor, card: e.card || undefined, group: e.group || undefined, reopened, conclusion: e.data?.conclusion || "", o: order++ });
    }
  }

  steps.sort((a, b) => a.at - b.at || a.o - b.o);

  // Sessions, captions and numbers.
  const seen = new Set();
  let session = -1, last = null;
  steps.forEach((st, i) => {
    const device = st.device || "desktop";
    if (!last || device !== last.device || (Number.isFinite(st.at) && Number.isFinite(last.at) && st.at - last.at > SESSION_GAP_MS)) {
      session++;
      st.first = true;
    } else st.first = false;
    last = { device, at: st.at };
    st.session = session;
    st.device = device;
    st.n = i + 1;
    st.who = who(st.actor);
    if (st.kind === "card") seen.add(st.card);
    st.title = stepTitle(st, byId, lineById, groupById);
    st.caption = stepCaption(st, { byId, lines, groups: groupById, lineById, seen });
    if (!Number.isFinite(st.at)) st.at = null;
    delete st.o;
  });
  return steps;
}

function stepTitle(st, byId, lineById, groupById) {
  if (st.kind === "card") return cardTitle(byId.get(st.card));
  if (st.kind === "visit") return st.visitTitle;
  if (st.kind === "link") {
    const l = lineById.get(st.line);
    return `${cardTitle(byId.get(l.from))} → ${cardTitle(byId.get(l.to))}`;
  }
  if (st.card) return cardTitle(byId.get(st.card));
  return groupById.get(st.group)?.label || "New group";
}

// A page card's caption says how the page was reached (B83). An "opened
// from" line on the canvas names the page or search card instead.
function pageCaption(w, c, title, fromTitle) {
  const on = site(c.url) ? ` on ${site(c.url)}` : "";
  const v = Prov.clean(c.via);
  const qq = v?.query ? ` for “${v.query}”` : "";
  let t;
  if (v?.how === "suggested") t = `NODE suggested ${q(title)}${on}${qq}, and ${w === "You" ? "you" : w} opened it.`;
  else if (v?.how === "agent") t = `The research agent found ${q(title)}${on}.`;
  else if (v?.how === "next") t = `${site(c.url) || "The site"} played ${q(title)} next by itself.`;
  else if (fromTitle) t = `${w} opened ${q(title)}${on}, from ${q(fromTitle)}.`;
  else if (v?.how === "search") t = `${w} opened ${q(title)}${on}, from a search${qq}.`;
  else if (v?.how === "link") t = `${w} opened ${q(title)}${on}, from a link on ${v.host || "another page"}.`;
  else if (v?.how === "typed") t = `${w} typed the address of ${q(title)}${on}.`;
  else t = `${w} opened ${q(title)}${on}.`;
  if (c.played) t += " NODE started its video or audio.";
  return t;
}

function stepCaption(st, ctx) {
  const { byId, lines = [], groups = new Map(), lineById = new Map(lines.map((l) => [l.id, l])), seen = new Set() } = ctx || {};
  const w = st.who || who(st.actor);
  if (st.kind === "visit") {
    if (/^voice note\b/i.test(st.visitTitle || "")) return `${w} recorded a voice note. It is not on the canvas.`;
    const d = dwellText(st.dwell);
    const via = Prov.viaText(st.via, st.played);
    return tidy(`${w} visited ${q(st.visitTitle || "a page")}${d ? ` for ${d}` : ""}${via ? ` (${via})` : ""}. It stayed in the timeline only.`);
  }
  if (st.kind === "link") {
    const l = lineById.get(st.line);
    if (!l) return `${w} linked two cards.`;
    return tidy(`${w} linked ${q(cardTitle(byId.get(l.from)))} to ${q(cardTitle(byId.get(l.to)))}${l.label ? ` as “${l.label}”` : ""}.`);
  }
  if (st.kind === "group") {
    const g = groups.get(st.group);
    const n = g ? [...byId.values()].filter((c) => centreIn(c, g)).length : 0;
    return tidy(`${w} grouped ${n} ${n === 1 ? "card" : "cards"} as “${g?.label || "New group"}”.`);
  }
  if (st.kind === "rename") return tidy(`${w} renamed a group to “${st.label || groups.get(st.group)?.label || "New group"}”.`);
  if (st.kind === "resolve") {
    if (st.card) {
      const t = q(cardTitle(byId.get(st.card)));
      return tidy(st.reopened ? `${w} reopened ${t}.` : `${w} resolved ${t}${st.conclusion ? `: ${st.conclusion}` : ""}.`);
    }
    const g = groups.get(st.group);
    return tidy(`${w} marked “${g?.label || "New group"}” ${st.reopened ? "open again" : "resolved"}.`);
  }
  const c = byId.get(st.card);
  if (!c) return `${w} added a card.`;
  const title = cardTitle(c);
  let t;
  const nav = lines.find((l) => l.to === c.id && l.kind === "nav" && seen.has(l.from));
  if (c.kind === "page") t = pageCaption(w, c, title, nav && cardTitle(byId.get(nav.from)));
  else if (c.kind === "video") t = `${w} watched ${q(title)}${site(c.url) ? ` on ${site(c.url)}` : ""}.`;
  else if (c.kind === "capture") t = c.quote ? `${w} captured a line from ${c.source || site(c.url) || "a page"}: “${c.quote}”.` : `${w} captured ${c.source || site(c.url) || "a page"}.`;
  else if (c.kind === "report") t = `${w} asked NODE for a report: ${q(title)}.`;
  else if (c.kind === "question") t = `${w} asked: ${q(title)}${c.status === "resolved" || c.resolved ? " (later resolved)." : ""}`;
  else if (c.kind === "note") t = `${w} wrote a note: ${q(title)}`;
  else if (c.kind === "voice") t = `${w} recorded a voice note.`;
  else if (c.kind === "search") t = `${w} searched: ${q(title)}.`;
  else if (c.kind === "moment") t = `${w} saved a moment of ${q(title)}, ${clockOf(c.a)} to ${clockOf(c.b)}.`;
  else if (c.kind === "media") {
    const from = site(c.url) ? ` from ${site(c.url)}` : "";
    t = {
      screenshot: `${w} took a screenshot${from}: ${q(title)}.`,
      image: `${w} saved an image${from}: ${q(title)}.`,
      video: `${w} saved a video clip${from}: ${q(title)}.`,
      audio: `${w} saved audio${from}: ${q(title)}.`,
    }[c.media] || `${w} saved ${q(title)}.`;
  }
  else t = `${w} added ${q(title)}.`;
  // Lines NODE drew to cards already shown (captured or reported from).
  const auto = lines.filter((l) => l.kind === "auto" && ((l.from === c.id && seen.has(l.to)) || (l.to === c.id && seen.has(l.from))));
  for (const l of auto.slice(0, 2)) t += ` NODE linked it to ${q(cardTitle(byId.get(l.from === c.id ? l.to : l.from)))}${l.label ? ` (${l.label})` : ""}.`;
  return tidy(t);
}

// The cards, lines and groups shown at step index i (0-based): cards reached,
// NODE's lines once both ends are shown, drawn lines once drawn, groups once
// made (groups with no step are always shown).
function shownAt(steps, i) {
  const cards = new Set(), lines = new Set(), groups = new Set(), stepGroups = new Set();
  for (const st of steps) if (st.kind === "group") stepGroups.add(st.group);
  for (const st of steps.slice(0, i + 1)) {
    if (st.kind === "card") cards.add(st.card);
    else if (st.kind === "link") lines.add(st.line);
    else if (st.kind === "group") groups.add(st.group);
  }
  return { cards, lines, groups, stepGroups };
}

module.exports = { replaySteps, stepCaption, shownAt, dwellText, SESSION_GAP_MS };
