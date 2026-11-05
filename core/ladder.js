// The zoom ladder (B107, handoff spec 8): page → Mosaic → Gallery → canvas.
// A pinch that zooms out climbs one level; one that zooms in goes back down
// one level. One level per gesture: a gesture ends after 400 ms without wheel
// events. On the canvas a pinch zooms the canvas, so the ladder stops there.
// No platform imports; renderer/index.html loads this file too (window.NodeLadder).
(function (root) {
  "use strict";
  const LEVELS = ["page", "mosaic", "gallery", "canvas"];
  const GESTURE_END_MS = 400;
  const OUT = 0.82; // accumulated scale that counts as zooming out
  const IN = 1.22; // and zooming in

  // The level one step from `level`; dir "out" climbs, "in" goes down. null:
  // no step (the page zooms itself, the canvas zooms itself).
  function step(level, dir) {
    const i = LEVELS.indexOf(level);
    if (i < 0) return null;
    if (dir === "out") return i < LEVELS.length - 1 ? LEVELS[i + 1] : null;
    if (dir === "in") return i > 0 && level !== "canvas" ? LEVELS[i - 1] : null;
    return null;
  }

  // Groups wheel events into gestures and fires once per gesture.
  // feed(scale, now): scale > 1 zooms in, < 1 zooms out. Returns "in", "out"
  // or null.
  class Gesture {
    constructor({ endMs = GESTURE_END_MS } = {}) {
      this.endMs = endMs;
      this.last = -Infinity;
      this.acc = 1;
      this.fired = false;
    }
    feed(scale, now) {
      if (now - this.last > this.endMs) {
        this.acc = 1;
        this.fired = false;
      }
      this.last = now;
      if (this.fired) return null;
      this.acc *= Math.max(0.5, Math.min(2, Number(scale) || 1));
      if (this.acc <= OUT) return (this.fired = true), "out";
      if (this.acc >= IN) return (this.fired = true), "in";
      return null;
    }
  }

  // The Gallery opened from Mosaic starts with the Mosaic's pages chosen:
  // the tiles picked for Mosaic, or the tabs Mosaic shows when none were.
  function galleryChoice({ tiles = [], shown = [] } = {}) {
    return (tiles.length ? tiles : shown).slice();
  }

  // A trackpad pinch arrives as a wheel event with ctrlKey; its scale is
  // exp(-deltaY / 100). Ctrl with a mouse wheel gives whole steps of 10 or
  // more and is not a pinch.
  function pinchScale(e) {
    if (!e.ctrlKey) return null;
    if (Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 10) return null;
    return Math.exp(-e.deltaY / 100);
  }

  const api = { LEVELS, GESTURE_END_MS, step, Gesture, galleryChoice, pinchScale };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.NodeLadder = api;
})(typeof window !== "undefined" ? window : globalThis);
