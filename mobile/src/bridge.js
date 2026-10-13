// Scripts injected into each tab's WebView, built from core/page-scripts.js.
const { extractionScript, autoplayScript, blockAutoplayScript, centerOnClickScript, pauseForLimitScript, resumeScript } = require("../../core/page-scripts");

// Runs before the page's own scripts: reports text selection and scroll stops,
// so the app knows when to read the page again.
export const BRIDGE = `(function () {
  if (window.__scoutBridge) return;
  window.__scoutBridge = true;
  var post = function (m) { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} };
  var t1 = null, t2 = null;
  document.addEventListener("selectionchange", function () {
    clearTimeout(t1);
    t1 = setTimeout(function () {
      var s = String(window.getSelection ? window.getSelection() : "").trim();
      if (s.length > 2) post({ type: "selection", text: s.slice(0, 600) });
    }, 700);
  });
  // Media state for the playback limit (up to 4 tabs playing at once).
  var t3 = null, last = null;
  var media = function () {
    clearTimeout(t3);
    t3 = setTimeout(function () {
      var playing = Array.prototype.some.call(document.querySelectorAll("video, audio"), function (el) { return !el.paused && !el.ended; });
      if (playing !== last) { last = playing; post({ type: "media", playing: playing }); }
    }, 300);
  };
  ["play", "playing", "pause", "ended", "emptied"].forEach(function (ev) { document.addEventListener(ev, media, true); });
  window.addEventListener("load", media);
  window.addEventListener("scroll", function () {
    clearTimeout(t2);
    t2 = setTimeout(function () { post({ type: "scroll" }); }, 1200);
  }, { passive: true });
})();
true;`;

// Reads the page and posts the result back with the request id.
export function extractCall(ruleExtract, requestId) {
  const id = JSON.stringify(requestId);
  return `(function () {
  try {
    var d = ${extractionScript(ruleExtract)};
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "extract", id: ${id}, data: d }));
  } catch (e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "extract", id: ${id}, error: String(e) }));
  }
})();
true;`;
}

export function autoplayCall(mode) {
  return `${mode === "off" ? blockAutoplayScript() : autoplayScript(mode || "on")};\ntrue;`;
}

// WebViews have no mute switch, so background tabs mute their media from inside.
export const MUTE_ALL = `document.querySelectorAll("video, audio").forEach(function (el) { el.muted = true; });\ntrue;`;

// Playback limit: pause this tab's media (marked so it can resume), or resume it.
export const PAUSE_FOR_LIMIT = `${pauseForLimitScript()};\ntrue;`;
export const RESUME = `${resumeScript()};\ntrue;`;

// Tapping a video, image or embedded player scrolls it to the middle (site rule "center").
export const CENTER_ON_TAP = `${centerOnClickScript()};\ntrue;`;
