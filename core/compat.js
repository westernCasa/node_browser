// Small helpers for features that differ between Node/Electron and the mobile
// JavaScript engine (Hermes).

/** An AbortSignal that fires after ms. Uses AbortSignal.timeout when present. */
function timeoutSignal(ms) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const ctrl = new AbortController();
  setTimeout(() => {
    const err = new Error("The operation timed out.");
    err.name = "TimeoutError";
    ctrl.abort(err);
  }, ms);
  return ctrl.signal;
}

module.exports = { timeoutSignal };
