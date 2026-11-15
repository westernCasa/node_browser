// Editing a trail's canvas on the phone: the same actions as desktop's canvas
// tools (B105) on core/trail.js, each with an Undo. No React Native imports
// (tested in Node: mobile/test/trail-edit.test.js).
//
// Every action works like desktop's canvasEdit: pending research changes are
// saved first, the store is changed, then the research store reads the
// session again (questions are threads). Opened files are read only.
//
// Each action returns { result, undo, text } or null. undo() takes the change
// back; text is the note shown with the Undo button.

const LABELS = [
  { id: "", label: "No label" },
  { id: "supports", label: "Supports" },
  { id: "contradicts", label: "Contradicts" },
  { id: "answers", label: "Answers" },
  { id: "raises", label: "Raises" },
];

function createEditor({ store, research, by = () => "" }) {
  const id = () => research.current.id;
  const editable = () => store.has(id()) && !store.get(id()).trail.readonly;
  const card = (cid) => store.card(id(), cid);

  // desktop canvasEdit: save, change, read the session again.
  function edit(fn) {
    if (!editable()) return null;
    research.saveNow();
    const out = fn(id());
    research.reload();
    return out || null;
  }
  const wrap = (result, undo, text) => (result ? { result, undo: () => edit(() => (undo(), true)), text } : null);

  return {
    LABELS,
    editable,

    moveCard(cid, x, y) {
      const c = card(cid);
      if (!c) return null;
      const was = { x: c.x, y: c.y, pinned: c.pinned };
      const r = edit((t) => store.moveCard(t, cid, x, y));
      return wrap(r, () => {
        store.moveCard(id(), cid, was.x, was.y);
        if (!was.pinned) store.updateCard(id(), cid, { pinned: false });
      }, "Card moved.");
    },

    moveGroup(gid, x, y) {
      const g = store.get(id())?.groups.find((k) => k.id === gid);
      if (!g) return null;
      const was = { x: g.x, y: g.y };
      const r = edit((t) => store.moveGroup(t, gid, x, y));
      return wrap(r, () => store.moveGroup(id(), gid, was.x, was.y), "Group moved.");
    },

    link(from, to, label = "") {
      if (!from || !to || from === to) return null;
      const before = new Set((store.get(id())?.lines || []).map((l) => l.id));
      const r = edit((t) => store.link(t, from, to, { kind: "you", label }));
      const isNew = r && !before.has(r.id);
      return wrap(r, () => (isNew ? store.unlink(id(), r.id) : null), "Cards linked.");
    },

    labelLine(lineId, label) {
      const l = store.get(id())?.lines.find((k) => k.id === lineId);
      if (!l) return null;
      const was = l.label || "";
      const r = edit((t) => store.labelLine(t, lineId, label));
      return wrap(r, () => store.labelLine(id(), lineId, was), label ? `Labelled “${label}”.` : "Label removed.");
    },

    unlink(lineId) {
      const l = store.get(id())?.lines.find((k) => k.id === lineId);
      if (!l) return null;
      const copy = { ...l };
      const r = edit((t) => store.unlink(t, lineId));
      return wrap(r, () => store.link(id(), copy.from, copy.to, { kind: copy.kind, label: copy.label || "" }), "Link removed.");
    },

    // A group around the chosen cards (desktop's Group tool fits the box).
    group(cardIds, label = "New group") {
      const cs = cardIds.map(card).filter((c) => c && !c.removed);
      if (!cs.length) return null;
      const x1 = Math.min(...cs.map((c) => c.x)), y1 = Math.min(...cs.map((c) => c.y));
      const x2 = Math.max(...cs.map((c) => c.x + c.w)), y2 = Math.max(...cs.map((c) => c.y + c.h));
      const r = edit((t) => store.groupAround(t, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, { label: String(label || "").trim() || "New group" }));
      // core/trail.js has no ungroup; Undo takes the group out of the trail.
      return wrap(r, () => {
        const d = store.get(id());
        d.groups = d.groups.filter((g) => g.id !== r.id);
        store.save(id());
      }, "Group made.");
    },

    renameGroup(gid, label) {
      const g = store.get(id())?.groups.find((k) => k.id === gid);
      if (!g || !String(label || "").trim()) return null;
      const was = g.label;
      const r = edit((t) => store.renameGroup(t, gid, label));
      return wrap(r, () => store.renameGroup(id(), gid, was), "Group renamed.");
    },

    resolveGroup(gid, resolved) {
      const r = edit((t) => store.resolveGroup(t, gid, resolved));
      return wrap(r, () => store.resolveGroup(id(), gid, !resolved), resolved ? "Group resolved." : "Group reopened.");
    },

    note(x, y, text) {
      const r = edit((t) => store.freeNote(t, { x, y, text, by: by() }));
      return wrap(r, () => store.deleteCard(id(), r.id), "Note added.");
    },

    editNote(cid, text) {
      const c = card(cid);
      const t = String(text || "").trim().slice(0, 2000);
      if (!c || c.kind !== "note" || !t) return null;
      const was = c.text;
      const r = edit((tid) => store.updateCard(tid, cid, { text: t }));
      return wrap(r, () => store.updateCard(id(), cid, { text: was }), "Note changed.");
    },

    // A question is a thread, shown as a question card where it was placed.
    question(x, y, title) {
      const t = String(title || "").trim().slice(0, 200);
      if (!t) return null;
      const r = edit((tid) => store.questionCard(tid, { id: `t${Date.now().toString(36)}`, title: t, status: "open", by: by(), at: Date.now(), replies: [] }, { place: { x: Math.round(x), y: Math.round(y) } }));
      return wrap(r, () => store.deleteCard(id(), r.id), "Question added.");
    },

    reply(cid, text) {
      if (!editable() || !String(text || "").trim()) return null;
      research.saveNow();
      const r = research.reply(cid, { by: by(), text });
      research.saveNow();
      return r ? { result: r, undo: null, text: "Reply added." } : null;
    },

    resolveQuestion(cid, resolved, conclusion = "") {
      if (!editable()) return null;
      research.saveNow();
      const r = resolved ? research.resolveThread(cid, conclusion) : research.reopenThread(cid);
      research.saveNow();
      return wrap(r, () => {
        if (resolved) research.reopenThread(cid);
        else research.resolveThread(cid);
        research.saveNow();
      }, resolved ? "Question resolved." : "Question reopened.");
    },

    // Remove from canvas: the card's events and lines are kept; Undo puts it back.
    remove(cid) {
      const r = edit((t) => store.removeCard(t, cid));
      return wrap(r, () => store.restoreCard(id(), cid), "Removed from the canvas.");
    },

    // Put a timeline-only page on the canvas.
    place(url, { title = "" } = {}) {
      const before = store.pageCard(id(), url);
      const r = edit((t) => store.placePage(t, url, { title, reason: "put" }));
      return wrap(r, () => (before && !before.removed ? null : store.removeCard(id(), r.id)), "Put on the canvas.");
    },
  };
}

module.exports = { createEditor, LABELS };
