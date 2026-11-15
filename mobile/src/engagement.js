// Pages becoming cards on the phone, by the desktop rule (B104, handoff spec
// 3): a page becomes a card when the person engages with it: 20 s on screen
// (the shown tab or a Mosaic tile, NODE in front), scrolling it, capturing
// from it or asking AI about it. Shorter visits stay in the timeline as
// "timeline only" with their time on page. The card goes near the page it
// was opened from, with an "opened from" line (core/trail.js placePage).
// Sign-in and payment pages never become cards. Applies to every trail
// (Sven, 2026-11-15). No React Native imports (tested in Node).
const Prov = require("../../core/provenance");

const ENGAGE_MS = 20000;

function createEngagement({ store, trailOf, onCard = () => {}, now = () => Date.now() }) {
  const pages = new Map(); // tab id -> { url, from, via, trail, shownMs, engaged }
  const lastUrl = new Map(); // tab id -> the page before

  function ended(tabId) {
    const p = pages.get(tabId);
    if (!p) return;
    lastUrl.set(tabId, p.url);
    if (!p.engaged && p.shownMs > 0) store.bounce(p.trail, p.url, p.shownMs, { via: p.via, at: now() });
    pages.delete(tabId);
  }

  return {
    ENGAGE_MS,
    // A tab loaded a new page. openedFrom: the page that opened this tab.
    started(tabId, url, { openedFrom = "", title = "" } = {}) {
      const prev = pages.get(tabId);
      if (prev && prev.url === url) return;
      ended(tabId);
      if (!/^https?:/i.test(url || "")) return;
      const from = lastUrl.get(tabId) || openedFrom || "";
      pages.set(tabId, { url, from, via: Prov.fromPage(from), trail: trailOf(), title, shownMs: 0, engaged: false });
    },
    title(tabId, title) {
      const p = pages.get(tabId);
      if (p && title) p.title = title;
    },
    ended,
    closed(tabId) {
      ended(tabId);
      lastUrl.delete(tabId);
    },
    // Once a second, with the tabs on screen. Returns the cards made.
    tick(onScreenIds, ms = 1000) {
      const made = [];
      for (const id of onScreenIds) {
        const p = pages.get(id);
        if (!p || p.engaged) continue;
        p.shownMs += ms;
        if (p.shownMs >= ENGAGE_MS) {
          const c = this.engage(id, "dwell");
          if (c) made.push(c);
        }
      }
      return made;
    },
    // Scrolled, captured, asked about: the page becomes a card now.
    engage(tabId, reason) {
      const p = pages.get(tabId);
      if (!p || p.engaged) return null;
      p.engaged = true;
      const card = store.placePage(p.trail, p.url, { title: p.title, from: p.from, via: p.via, reason, at: now() });
      if (card) onCard(card, p.trail);
      return card;
    },
    page: (tabId) => pages.get(tabId) || null,
  };
}

module.exports = { createEngagement, ENGAGE_MS };
