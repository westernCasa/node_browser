// Trail canvas renderer (B101). Draws one trail from trail:get: cards, groups
// and lines in one transformed layer over a dot grid, with zoom controls, Fit,
// a line key and a minimap. Pan and zoom only change transforms, so they stay
// on the compositor.
//
// The view is { x, y, z }: a world point (wx, wy) shows at
// (x + wx * z, y + wy * z) in the canvas. World units are pixels at 100%.
//
// The pure helpers at the top have no DOM use and are tested in
// test/canvas-demo.js. Behaviour follows the handoff's prototype (board C1);
// the markup and styles are NODE's own (renderer/styles.css, .cv-*).
(function (root) {
  "use strict";

  const Z_MIN = 0.2;
  const Z_MAX = 2.5;
  const DOT_GAP = 24; // dot grid spacing at 100%
  const MINI = { w: 180, h: 116 };

  const clampZ = (z) => Math.max(Z_MIN, Math.min(Z_MAX, Number(z) || 1));

  // Zoom to nz keeping the canvas point (px, py) over the same world point.
  function zoomAt(v, nz, px, py) {
    nz = clampZ(nz);
    return { x: px - (px - v.x) * (nz / v.z), y: py - (py - v.y) * (nz / v.z), z: nz };
  }

  // The box around every card and group, or null when there are none.
  function worldBounds(cards, groups) {
    const all = [...(cards || []), ...(groups || [])];
    if (!all.length) return null;
    const x = Math.min(...all.map((o) => o.x));
    const y = Math.min(...all.map((o) => o.y));
    const x2 = Math.max(...all.map((o) => o.x + o.w));
    // Group names sit 28 px above the group.
    const y0 = Math.min(y, ...(groups || []).map((g) => g.y - 28));
    const y2 = Math.max(...all.map((o) => o.y + o.h));
    return { x, y: y0, w: x2 - x, h: y2 - y0 };
  }

  // Fit everything in a canvas of size (w, h) with a 40 px margin, centred.
  // Never zooms in past 100%.
  function fitView(bounds, w, h) {
    if (!bounds) return { x: w / 2, y: h / 2, z: 1 };
    const z = clampZ(Math.min(1, (w - 80) / Math.max(1, bounds.w), (h - 80) / Math.max(1, bounds.h)));
    return { x: (w - bounds.w * z) / 2 - bounds.x * z, y: (h - bounds.h * z) / 2 - bounds.y * z, z };
  }

  // Centre the world point (wx, wy) in a canvas of size (w, h) at zoom z.
  function centreOn(wx, wy, w, h, z) {
    return { x: w / 2 - wx * z, y: h / 2 - wy * z, z };
  }

  // A line from card a to card b, cut where it leaves each card plus a gap.
  // nav lines stop 4 px short of the target to leave room for the arrow.
  function lineEnds(a, b, kind) {
    const acx = a.x + a.w / 2, acy = a.y + a.h / 2, bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
    const dx = bcx - acx, dy = bcy - acy;
    const exit = (r, gap) => Math.min(dx === 0 ? Infinity : (r.w / 2 + gap) / Math.abs(dx), dy === 0 ? Infinity : (r.h / 2 + gap) / Math.abs(dy));
    const ta = exit(a, 6), tb = exit(b, kind === "nav" ? 4 : 6);
    if (ta + tb >= 1) return null; // the cards overlap: no line
    return { x1: acx + dx * ta, y1: acy + dy * ta, x2: bcx - dx * tb, y2: bcy - dy * tb };
  }

  // The minimap: scale m, world-to-map positions and the visible box.
  function minimap(bounds, view, w, h) {
    const pad = 80;
    const b = bounds ? { x: bounds.x - pad, y: bounds.y - pad, w: bounds.w + pad * 2, h: bounds.h + pad * 2 } : { x: 0, y: 0, w: 1000, h: 640 };
    const m = Math.min(MINI.w / b.w, MINI.h / b.h);
    const ox = (MINI.w - b.w * m) / 2, oy = (MINI.h - b.h * m) / 2;
    const map = (r) => ({ x: ox + (r.x - b.x) * m, y: oy + (r.y - b.y) * m, w: r.w * m, h: r.h * m });
    const seen = map({ x: -view.x / view.z, y: -view.y / view.z, w: w / view.z, h: h / view.z });
    const toWorld = (mx, my) => ({ x: b.x + (mx - ox) / m, y: b.y + (my - oy) / m });
    return { m, map, seen, toWorld };
  }

  // Dot grid: spacing on screen and the offset that keeps dots on world points.
  // Below 50% every other dot is left out so the grid does not turn to noise.
  function gridFor(v) {
    const gap = DOT_GAP * v.z * (v.z < 0.5 ? 2 : 1);
    const mod = (n) => ((n % gap) + gap) % gap;
    return { gap, ox: mod(v.x), oy: mod(v.y) };
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (_) {
      return "";
    }
  }

  const KIND_LABEL = { page: "Page", video: "Video", capture: "Capture", report: "Report", question: "Question", note: "Note", voice: "Voice", search: "Search" };

  const helpers = { Z_MIN, Z_MAX, DOT_GAP, clampZ, zoomAt, worldBounds, fitView, centreOn, lineEnds, minimap, gridFor, hostOf };
  if (typeof module === "object" && module.exports) {
    module.exports = helpers;
    return;
  }

  // ---- DOM ----
  const SVG = "http://www.w3.org/2000/svg";
  const h = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  };
  const svg = (tag, attrs) => {
    const el = document.createElementNS(SVG, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  };
  const reducedMotion = () => root.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const FLY_MS = 320;

  class TrailCanvas {
    constructor(el, api, hooks = {}) {
      this.el = el;
      this.api = api;
      this.hooks = hooks;
      this.v = { x: 0, y: 0, z: 1 };
      this.data = null;
      this.previews = {};
      this.selected = null;
      this.build();
    }

    build() {
      const el = this.el;
      el.textContent = "";
      this.vp = h("div", "cv-vp");
      this.vp.tabIndex = 0;
      this.vp.setAttribute("role", "application");
      this.vp.setAttribute("aria-roledescription", "trail canvas");
      this.grid = h("div", "cv-grid");
      this.grid.setAttribute("aria-hidden", "true");
      this.layer = h("div", "cv-layer");
      this.lines = svg("svg", { class: "cv-lines", width: "1", height: "1", "aria-hidden": "true" });
      this.groupsEl = h("div", "cv-groups");
      this.labelsEl = h("div", "cv-labels");
      this.cardsEl = h("div", "cv-cards");
      this.cardsEl.setAttribute("role", "list");
      this.layer.append(this.groupsEl, this.lines, this.labelsEl, this.cardsEl);
      this.vp.append(this.grid, this.layer);

      // Line key, bottom left.
      const key = h("div", "cv-key");
      key.setAttribute("aria-label", "Line key");
      for (const [kind, text] of [
        ["nav", "Opened from"],
        ["auto", "Captured or reported from"],
        ["you", "Drawn by you"],
        ["suggested", "Suggested"],
      ]) {
        const row = h("div", "cv-key-row");
        const s = svg("svg", { width: "28", height: "8", "aria-hidden": "true" });
        s.append(svg("line", { class: `cv-line ${kind}`, x1: "2", y1: "4", x2: kind === "nav" ? "20" : "26", y2: "4" }));
        if (kind === "nav") s.append(svg("polygon", { class: "cv-arrow", points: "20,0 28,4 20,8" }));
        if (kind === "you") s.append(svg("circle", { class: "cv-end", cx: "2", cy: "4", r: "3" }), svg("circle", { class: "cv-end", cx: "26", cy: "4", r: "3" }));
        row.append(s, h("span", "", text));
        key.append(row);
      }

      // Minimap and zoom controls, bottom right.
      const corner = h("div", "cv-corner");
      this.mini = h("div", "cv-mini");
      this.mini.setAttribute("role", "img");
      this.mini.setAttribute("aria-label", "Minimap. Click to move there.");
      this.miniRects = h("div", "cv-mini-rects");
      this.miniSeen = h("div", "cv-mini-seen");
      this.mini.append(this.miniRects, this.miniSeen);
      const zoom = h("div", "cv-zoom");
      zoom.setAttribute("role", "toolbar");
      zoom.setAttribute("aria-label", "Zoom");
      const btn = (cls, text, label, fn) => {
        const b = h("button", `cv-zbtn ${cls}`, text);
        b.type = "button";
        b.setAttribute("aria-label", label);
        b.title = label;
        b.addEventListener("click", fn);
        return b;
      };
      this.zoomLabel = h("button", "cv-zbtn cv-zpct", "100%");
      this.zoomLabel.type = "button";
      this.zoomLabel.title = "Zoom to 100%";
      this.zoomLabel.setAttribute("aria-label", "Zoom to 100%");
      this.zoomLabel.addEventListener("click", () => this.zoomCentre(1, true));
      zoom.append(
        btn("cv-zout", "−", "Zoom out", () => this.zoomCentre(this.v.z / 1.25, true)),
        this.zoomLabel,
        btn("cv-zin", "+", "Zoom in", () => this.zoomCentre(this.v.z * 1.25, true)),
        btn("cv-fit", "Fit", "Fit the trail on screen", () => this.fit(true)),
      );
      corner.append(this.mini, zoom);

      this.empty = h("p", "cv-empty", "No cards on this trail yet.");
      this.empty.hidden = true;
      el.append(this.vp, key, corner, this.empty);
      this.bind();
    }

    bind() {
      const vp = this.vp;
      // Wheel: two-finger scroll pans; pinch (ctrl-wheel) and ⌘-wheel zoom at the pointer.
      vp.addEventListener(
        "wheel",
        (e) => {
          e.preventDefault();
          const r = vp.getBoundingClientRect();
          if (e.ctrlKey || e.metaKey) this.setView(zoomAt(this.v, this.v.z * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top));
          else this.setView({ x: this.v.x - e.deltaX, y: this.v.y - e.deltaY, z: this.v.z });
        },
        { passive: false },
      );
      // Drag on the background pans. A click on a card selects it.
      let drag = null;
      vp.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        const card = e.target.closest?.(".cv-card");
        if (card) {
          this.select(card.dataset.id);
          return;
        }
        drag = { sx: e.clientX, sy: e.clientY, x: this.v.x, y: this.v.y, moved: false };
        vp.setPointerCapture(e.pointerId);
        vp.classList.add("panning");
      });
      vp.addEventListener("pointermove", (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        this.setView({ x: drag.x + dx, y: drag.y + dy, z: this.v.z });
      });
      const end = () => {
        if (!drag) return;
        if (!drag.moved) this.select(null);
        drag = null;
        vp.classList.remove("panning");
      };
      vp.addEventListener("pointerup", end);
      vp.addEventListener("pointercancel", end);
      vp.addEventListener("dblclick", (e) => {
        const card = e.target.closest?.(".cv-card");
        if (card) this.openCard(card.dataset.id);
      });
      vp.addEventListener("keydown", (e) => {
        const step = e.shiftKey ? 240 : 60;
        const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
        if (moves[e.key] && !e.target.closest(".cv-card")) {
          e.preventDefault();
          this.setView({ x: this.v.x + moves[e.key][0], y: this.v.y + moves[e.key][1], z: this.v.z });
        } else if ((e.key === "=" || e.key === "+") && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          this.zoomCentre(this.v.z * 1.25, true);
        } else if (e.key === "-" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          this.zoomCentre(this.v.z / 1.25, true);
        } else if (e.key === "0" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          this.fit(true);
        } else if (e.key === "Enter" && e.target.closest(".cv-card")) {
          this.openCard(e.target.closest(".cv-card").dataset.id);
        }
      });
      this.cardsEl.addEventListener("focusin", (e) => {
        const card = e.target.closest(".cv-card");
        if (card && this.selected !== card.dataset.id) this.select(card.dataset.id, { reveal: true });
      });
      // Minimap: click or drag moves the view there.
      let miniDrag = false;
      const miniGo = (e) => {
        const r = this.mini.getBoundingClientRect();
        const mm = this.miniMap();
        const p = mm.toWorld(e.clientX - r.left, e.clientY - r.top);
        const s = this.size();
        this.setView(centreOn(p.x, p.y, s.w, s.h, this.v.z));
      };
      this.mini.addEventListener("pointerdown", (e) => {
        miniDrag = true;
        this.mini.setPointerCapture(e.pointerId);
        miniGo(e);
      });
      this.mini.addEventListener("pointermove", (e) => miniDrag && miniGo(e));
      this.mini.addEventListener("pointerup", () => (miniDrag = false));
      root.addEventListener("resize", () => this.data && this.paintView());
    }

    size() {
      return { w: this.vp.clientWidth || 1, h: this.vp.clientHeight || 1 };
    }

    // ---- data ----
    // snap: the trail:get result. previews: { url: { thumb, tabId } } for open tabs.
    show(snap, previews = {}) {
      this.data = snap;
      this.previews = previews || {};
      this.selected = snap?.view?.selected || null;
      this.bounds = worldBounds(snap?.cards, snap?.groups);
      this.render();
      const v = snap?.view;
      if (v && typeof v.z === "number" && (v.x || v.y || v.z !== 1)) this.setView({ x: v.x, y: v.y, z: v.z }, { save: false });
      else this.fit(false, { save: false });
    }

    render() {
      const d = this.data || { cards: [], groups: [], lines: [] };
      const byId = new Map(d.cards.map((c) => [c.id, c]));
      this.empty.hidden = d.cards.length > 0 || d.groups.length > 0;

      // Groups.
      const gFrag = document.createDocumentFragment();
      for (const g of d.groups) {
        const el = h("div", "cv-group");
        if (g.resolved) el.classList.add("resolved");
        if (g.suggested) el.classList.add("suggested");
        el.style.transform = `translate(${g.x}px, ${g.y}px)`;
        el.style.width = `${g.w}px`;
        el.style.height = `${g.h}px`;
        el.dataset.id = g.id;
        const name = h("div", "cv-group-name", (g.label || "New group") + (g.resolved ? " · Resolved" : ""));
        el.append(name);
        gFrag.append(el);
      }
      this.groupsEl.replaceChildren(gFrag);

      // Lines and their labels.
      const lFrag = document.createDocumentFragment();
      const labFrag = document.createDocumentFragment();
      for (const ln of d.lines) {
        const a = byId.get(ln.from), b = byId.get(ln.to);
        if (!a || !b) continue;
        const p = lineEnds(a, b, ln.kind);
        if (!p) continue;
        const kind = ["nav", "auto", "you", "suggested"].includes(ln.kind) ? ln.kind : "auto";
        const g = svg("g", { class: `cv-ln ${kind}`, "data-id": ln.id });
        let x2 = p.x2, y2 = p.y2;
        if (kind === "nav") {
          // Arrowhead 10 x 10 at the target end; the line stops at its base.
          const len = Math.hypot(p.x2 - p.x1, p.y2 - p.y1) || 1;
          const ux = (p.x2 - p.x1) / len, uy = (p.y2 - p.y1) / len;
          x2 = p.x2 - ux * 10;
          y2 = p.y2 - uy * 10;
          g.append(svg("polygon", { class: "cv-arrow", points: `${p.x2},${p.y2} ${x2 - uy * 5},${y2 + ux * 5} ${x2 + uy * 5},${y2 - ux * 5}` }));
        }
        g.prepend(svg("line", { class: `cv-line ${kind}`, x1: p.x1, y1: p.y1, x2, y2 }));
        if (kind === "you") g.append(svg("circle", { class: "cv-end", cx: p.x1, cy: p.y1, r: 4 }), svg("circle", { class: "cv-end", cx: p.x2, cy: p.y2, r: 4 }));
        lFrag.append(g);
        if (ln.label) {
          const lab = h("div", `cv-line-label ${kind}`, ln.label);
          lab.style.transform = `translate(${(p.x1 + p.x2) / 2}px, ${(p.y1 + p.y2) / 2}px) translate(-50%, -50%)`;
          labFrag.append(lab);
        }
      }
      this.lines.replaceChildren(lFrag);
      this.labelsEl.replaceChildren(labFrag);

      // Cards.
      const cFrag = document.createDocumentFragment();
      for (const c of d.cards) cFrag.append(this.cardEl(c));
      this.cardsEl.replaceChildren(cFrag);
      this.paintMiniRects();
    }

    cardEl(c) {
      const el = h("div", `cv-card k-${c.kind}`);
      el.dataset.id = c.id;
      el.tabIndex = 0;
      el.setAttribute("role", "listitem");
      el.style.transform = `translate(${c.x}px, ${c.y}px)`;
      el.style.width = `${c.w}px`;
      el.style.height = `${c.h}px`;
      if (c.id === this.selected) el.classList.add("selected");
      if (c.kind === "question" && c.status === "resolved") el.classList.add("resolved");
      const pv = c.url ? this.previews[c.url] : null;
      if (pv) el.classList.add("open");

      const head = h("div", "cv-card-head");
      const label = [KIND_LABEL[c.kind] || "Card"];
      if (c.kind === "page" || c.kind === "video") label.push(hostOf(c.url));
      if (c.kind === "capture" && c.source) label.push(c.source);
      if (c.kind === "question") {
        const n = (c.replies || []).length;
        label.push(c.status === "resolved" ? "Resolved" : "Open", `${n} ${n === 1 ? "reply" : "replies"}`);
      }
      if (c.kind === "report" && c.sources?.length) label.push(`${c.sources.length} sources`);
      head.append(h("span", "cv-card-kind", label.filter(Boolean).join(" · ")));
      if (pv) head.append(h("span", "cv-tab-mark", "Tab"));
      el.append(head);

      if (pv?.thumb) {
        const img = h("img", "cv-shot");
        img.alt = "";
        img.decoding = "async";
        img.draggable = false;
        img.src = pv.thumb;
        el.append(img);
      }
      const title =
        c.kind === "note" ? c.text : c.kind === "capture" && c.quote ? `“${c.quote}”` : c.title || c.text || (c.url ? hostOf(c.url) : KIND_LABEL[c.kind]);
      el.append(h("div", "cv-card-title", title || ""));
      const sub = this.cardSub(c);
      if (sub && !pv?.thumb) el.append(h("div", "cv-card-sub", sub));
      const foot = this.cardFoot(c);
      if (foot) el.append(h("div", "cv-card-foot", foot));
      el.setAttribute("aria-label", `${KIND_LABEL[c.kind] || "Card"}: ${title || ""}${pv ? ", open in a tab" : ""}`);
      return el;
    }

    cardSub(c) {
      if (c.kind === "question") {
        if (c.conclusion) return c.conclusion;
        const last = (c.replies || []).at(-1);
        return last ? `${last.by ? last.by + ": " : ""}${last.text || ""}` : "No replies yet.";
      }
      if (c.excerpt) return c.excerpt;
      return "";
    }

    cardFoot(c) {
      if (c.kind === "page" || c.kind === "video") return (c.keywords || []).slice(0, 4).join(" · ");
      if (c.kind === "note" && c.author) return `— ${c.author}`;
      if (c.kind === "question" && c.by) return c.by;
      return "";
    }

    // ---- view ----
    setView(v, { save = true } = {}) {
      this.stopFly();
      this.v = { x: v.x, y: v.y, z: clampZ(v.z) };
      this.paintView();
      if (save) this.saveSoon();
    }

    paintView() {
      const v = this.v;
      // Promote the layer while it moves; drop the hint once it settles so
      // text is drawn sharp at the new zoom.
      this.layer.classList.add("moving");
      clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => this.layer.classList.remove("moving"), 160);
      this.layer.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
      const g = gridFor(v);
      if (g.gap !== this.gridGap) {
        this.gridGap = g.gap;
        this.grid.style.backgroundSize = `${g.gap}px ${g.gap}px`;
        this.grid.style.width = `calc(100% + ${g.gap * 2}px)`;
        this.grid.style.height = `calc(100% + ${g.gap * 2}px)`;
      }
      this.grid.style.transform = `translate(${g.ox - g.gap}px, ${g.oy - g.gap}px)`;
      const pct = `${Math.round(v.z * 100)}%`;
      if (this.zoomLabel.textContent !== pct) this.zoomLabel.textContent = pct;
      this.el.dataset.zoom = String(Math.round(v.z * 100));
      this.paintMiniSeen();
    }

    zoomCentre(z, animate) {
      const s = this.size();
      const to = zoomAt(this.v, z, s.w / 2, s.h / 2);
      animate ? this.fly(to) : this.setView(to);
    }

    fit(animate, opts) {
      const s = this.size();
      const to = fitView(this.bounds, s.w, s.h);
      animate ? this.fly(to) : this.setView(to, opts);
    }

    // Fly-to: 320 ms, interpolated each frame (transform only). Reduced motion: jump.
    fly(to) {
      if (reducedMotion()) return this.setView(to);
      this.stopFly();
      const from = { ...this.v };
      const t0 = performance.now();
      const ease = (t) => 1 - Math.pow(1 - t, 3);
      const step = (now) => {
        const t = Math.min(1, (now - t0) / FLY_MS);
        const e = ease(t);
        // Zoom moves in log space so the speed looks even.
        const z = Math.exp(Math.log(from.z) + (Math.log(to.z) - Math.log(from.z)) * e);
        this.v = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, z };
        this.paintView();
        if (t < 1) this.flyRaf = requestAnimationFrame(step);
        else {
          this.flyRaf = 0;
          this.v = { ...to };
          this.paintView();
          this.saveSoon();
        }
      };
      this.flyRaf = requestAnimationFrame(step);
    }

    stopFly() {
      if (this.flyRaf) cancelAnimationFrame(this.flyRaf);
      this.flyRaf = 0;
    }

    saveSoon() {
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.api?.trailView?.({ x: Math.round(this.v.x), y: Math.round(this.v.y), z: Math.round(this.v.z * 1000) / 1000, selected: this.selected }), 400);
    }

    // ---- selection and opening ----
    select(id, { reveal = false } = {}) {
      if (this.selected === id) return;
      this.cardsEl.querySelector(".cv-card.selected")?.classList.remove("selected");
      this.selected = id || null;
      const el = id && this.cardsEl.querySelector(`.cv-card[data-id="${CSS.escape(id)}"]`);
      if (el) el.classList.add("selected");
      if (reveal && el) {
        const c = this.data.cards.find((k) => k.id === id);
        const s = this.size();
        const sx = this.v.x + c.x * this.v.z, sy = this.v.y + c.y * this.v.z;
        if (sx < 0 || sy < 0 || sx + c.w * this.v.z > s.w || sy + c.h * this.v.z > s.h) this.fly(centreOn(c.x + c.w / 2, c.y + c.h / 2, s.w, s.h, this.v.z));
      }
      this.saveSoon();
    }

    openCard(id) {
      const c = this.data?.cards.find((k) => k.id === id);
      if (!c?.url) return;
      this.hooks.open?.(c, this.previews[c.url] || null);
    }

    // ---- minimap ----
    miniMap() {
      const s = this.size();
      return minimap(this.bounds, this.v, s.w, s.h);
    }

    paintMiniRects() {
      const mm = this.miniMap();
      const frag = document.createDocumentFragment();
      const d = this.data || { cards: [], groups: [] };
      const put = (r, cls) => {
        const p = mm.map(r);
        const el = h("div", cls);
        el.style.transform = `translate(${p.x}px, ${p.y}px)`;
        el.style.width = `${Math.max(1, p.w)}px`;
        el.style.height = `${Math.max(1, p.h)}px`;
        frag.append(el);
      };
      for (const g of d.groups) put(g, g.suggested ? "cv-mini-group suggested" : "cv-mini-group");
      for (const c of d.cards) put(c, "cv-mini-card");
      this.miniRects.replaceChildren(frag);
    }

    paintMiniSeen() {
      const p = this.miniMap().seen;
      const s = this.miniSeen.style;
      s.transform = `translate(${p.x}px, ${p.y}px)`;
      s.width = `${p.w}px`;
      s.height = `${p.h}px`;
    }
  }

  root.TrailCanvas = TrailCanvas;
  root.TrailCanvasHelpers = helpers;
})(typeof window !== "undefined" ? window : globalThis);
