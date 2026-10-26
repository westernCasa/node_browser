// Ad and tracker blocking for the desktop app, using Ghostery's filter engine
// (@ghostery/adblocker-electron). The lists are the ones uBlock Origin turns on
// by default: uBlock filters, badware, privacy, quick fixes and unbreak, plus
// EasyList, EasyPrivacy and Peter Lowe's list ("ads and tracking"). With
// "Also hide cookie notices" on, the cookie-notice and annoyance lists are
// added ("full").
//
// Two parts (B77):
// - Requests for ads and trackers are cancelled, or swapped for a harmless
//   stand-in, before they leave the computer (NODE's own request listener).
// - On the page, leftover ad boxes are hidden and small scripts (scriptlets)
//   defuse ad and tracking code, through the engine's preload script.
//
// The lists are downloaded on first use and cached in userData/adblock.bin
// (adblock-full.bin with cookie notices); the cache is refreshed when it is
// older than 7 days. Without a network the cached copy is used; without
// either, pages load unblocked.
//
// NODE's listeners decide per page, so the switch in Settings and the site
// rule `adblock: false` take effect at once, for both parts.

const fs = require("fs");
const path = require("path");
// Loaded lazily, so a missing package (npm install not run after an update)
// turns blocking off with a clear status instead of stopping the app.
let ElectronBlocker = null;
let PRELOAD_PATH = "";
try {
  ({ ElectronBlocker } = require("@ghostery/adblocker-electron"));
  PRELOAD_PATH = require.resolve("@ghostery/adblocker-electron-preload");
} catch (_) {}

const REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const COSMETIC = "@ghostery/adblocker/inject-cosmetic-filters";
const OBSERVER = "@ghostery/adblocker/is-mutation-observer-enabled";

function createAdblock({ userData, fetch, isEnabled, isAllowedFor, isPage = () => true, onBlocked = () => {}, cookieNotices = () => false, ipcMain = null }) {
  let blocker = null;
  let blocked = 0;
  let mode = "";
  const perTab = new Map(); // webContents id -> blocked count on the current page
  const perTabHosts = new Map(); // webContents id -> Map(host -> count), for the toolbar menu (B73)
  let status = "loading";

  async function load() {
    if (!ElectronBlocker) {
      status = "not installed: run npm install in the NODE folder";
      return;
    }
    const full = Boolean(cookieNotices());
    mode = full ? "full" : "ads and tracking";
    const cacheFile = path.join(userData, full ? "adblock-full.bin" : "adblock.bin");
    try {
      const st = fs.existsSync(cacheFile) ? fs.statSync(cacheFile) : null;
      if (st && Date.now() - st.mtimeMs > REFRESH_MS) fs.renameSync(cacheFile, cacheFile + ".old");
    } catch (_) {}
    const caching = { path: cacheFile, read: fs.promises.readFile, write: fs.promises.writeFile };
    try {
      blocker = await (full ? ElectronBlocker.fromPrebuiltFull(fetch, caching) : ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, caching));
      status = "ready";
    } catch (err) {
      // Offline with an expired cache: fall back to the old copy if there is one.
      try {
        blocker = ElectronBlocker.deserialize(new Uint8Array(fs.readFileSync(cacheFile + ".old")));
        status = "ready (old lists)";
      } catch (_) {
        status = "lists could not be downloaded: " + String(err.message || err);
      }
    }
  }

  // Blocking applies to this web page (the switch, the site rule).
  const on = (wcId) => Boolean(blocker) && isEnabled() && isAllowedFor(wcId);

  // Installed once on the default session (all tabs share it).
  function install(session) {
    session.webRequest.onBeforeRequest((details, callback) => {
      if (details.resourceType === "mainFrame" || !on(details.webContentsId)) return callback({});
      blocker.onBeforeRequest(details, (response) => {
        if (response && (response.cancel || response.redirectURL)) {
          blocked++;
          perTab.set(details.webContentsId, (perTab.get(details.webContentsId) || 0) + 1);
          let host = "";
          try {
            host = new URL(details.url).hostname.replace(/^www\./, "");
          } catch (_) {}
          if (host) {
            const hosts = perTabHosts.get(details.webContentsId) || new Map();
            if (hosts.size < 200 || hosts.has(host)) hosts.set(host, (hosts.get(host) || 0) + 1);
            perTabHosts.set(details.webContentsId, hosts);
          }
          onBlocked(details.webContentsId);
        }
        callback(response || {});
      });
    });
    // Filters that tighten a page's own security policy (stop inline trackers).
    session.webRequest.onHeadersReceived((details, callback) => {
      if (!on(details.webContentsId)) return callback({});
      blocker.onHeadersReceived(details, callback);
    });
    // On-page hiding and scriptlets (B77): the engine's preload script asks
    // for the rules of each frame; NODE answers only where blocking is on.
    if (PRELOAD_PATH && ipcMain && session.registerPreloadScript) {
      try {
        session.registerPreloadScript({ type: "frame", filePath: PRELOAD_PATH });
        // Only in web pages shown in tabs: general hiding rules ("hide anything
        // called .ads") must never touch NODE's own window.
        const pageOn = (id) => isPage(id) && on(id);
        ipcMain.handle(COSMETIC, (event, url, msg) => (pageOn(event.sender.id) ? blocker.onInjectCosmeticFilters(event, url, msg) : undefined));
        ipcMain.handle(OBSERVER, (event) => (pageOn(event.sender.id) ? blocker.onIsMutationObserverEnabled(event) : false));
      } catch (_) {}
    }
  }

  return {
    load,
    install,
    stats: () => ({ status, blocked, mode }),
    blockedIn: (wcId) => perTab.get(wcId) || 0,
    // The sites blocked most on the page, most first: [{ host, count }].
    topHosts: (wcId, n = 6) => [...(perTabHosts.get(wcId) || new Map())].sort((a, b) => b[1] - a[1]).slice(0, n).map(([host, count]) => ({ host, count })),
    resetTab: (wcId) => {
      perTab.delete(wcId);
      perTabHosts.delete(wcId);
    },
  };
}

module.exports = { createAdblock };
