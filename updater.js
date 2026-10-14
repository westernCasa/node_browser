// Automatic updates (B46) from the GitHub releases of westernCasa/node_browser,
// using electron-updater. Only in installed builds (not when run from source).
//
// - Checks 10 s after start and every 6 hours, if "Check for updates" is on.
// - Downloads in the background; when ready, NODE offers to restart. If the
//   user does not, the update installs the next time NODE quits.
// - macOS only installs updates for signed and notarized builds. An unsigned
//   build reports the error and the Help menu links to the releases page.
let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
} catch (_) {}

const RELEASES = "https://github.com/westernCasa/node_browser/releases";
const SIX_HOURS = 6 * 60 * 60 * 1000;

function createUpdater({ app, log, notify, isEnabled }) {
  const state = { status: "idle", version: "", error: "", checkedAt: 0 };
  const usable = Boolean(autoUpdater) && app.isPackaged;
  let timer = null;

  if (usable) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = { info: (m) => log.info(`update: ${m}`), warn: (m) => log.warn(`update: ${m}`), error: (m) => log.error(`update: ${m}`), debug: () => {} };
    autoUpdater.on("checking-for-update", () => Object.assign(state, { status: "checking", error: "" }));
    autoUpdater.on("update-not-available", () => Object.assign(state, { status: "current", checkedAt: Date.now() }));
    autoUpdater.on("update-available", (info) => Object.assign(state, { status: "downloading", version: info.version }));
    autoUpdater.on("update-downloaded", (info) => {
      Object.assign(state, { status: "ready", version: info.version, checkedAt: Date.now() });
      notify({ type: "update-ready", version: info.version });
    });
    autoUpdater.on("error", (err) => Object.assign(state, { status: "error", error: String(err?.message || err).split("\n")[0], checkedAt: Date.now() }));
  }

  async function check(manual = false) {
    if (!usable) {
      Object.assign(state, { status: "unavailable", error: app.isPackaged ? "The update module is missing." : "Updates work in installed builds, not when NODE runs from source." });
      return state;
    }
    if (!manual && !isEnabled()) return state;
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      Object.assign(state, { status: "error", error: String(err?.message || err).split("\n")[0] });
    }
    return state;
  }

  function start() {
    if (!usable) return;
    setTimeout(() => check(false), 10000);
    timer = setInterval(() => check(false), SIX_HOURS);
    timer.unref?.();
  }

  function installNow() {
    if (usable && state.status === "ready") autoUpdater.quitAndInstall(false, true);
  }

  return { check, start, installNow, state: () => ({ ...state, usable, current: app.getVersion() }), RELEASES };
}

module.exports = { createUpdater, RELEASES };
