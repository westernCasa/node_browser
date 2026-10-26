// Ad and tracker blocking for the desktop app, using Ghostery's filter engine
// (@ghostery/adblocker-electron) with the EasyList / EasyPrivacy based
// "ads and tracking" lists. Network blocking only: requests for ads and
// trackers are cancelled before they leave the computer.
//
// The lists are downloaded on first use and cached in userData/adblock.bin;
// the cache is refreshed when it is older than 7 days. Without a network the
// cached copy is used; without either, pages load unblocked.
//
// Scout's own request listener decides per request, so the global switch in
// Settings and the site rule `adblock: false` take effect at once.

const fs = require("fs");
const path = require("path");
// Loaded lazily, so a missing package (npm install not run after an update)
// turns blocking off with a clear status instead of stopping the app.
let ElectronBlocker = null;
try {
  ({ ElectronBlocker } = require("@ghostery/adblocker-electron"));
} catch (_) {}

const REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

function createAdblock({ userData, fetch, isEnabled, isAllowedFor, onBlocked = () => {} }) {
  const cacheFile = path.join(userData, "adblock.bin");
  let blocker = null;
  let blocked = 0;
  const perTab = new Map(); // webContents id -> blocked count on the current page
  const perTabHosts = new Map(); // webContents id -> Map(host -> count), for the toolbar menu (B73)
  let status = "loading";

  async function load() {
    if (!ElectronBlocker) {
      status = "not installed: run npm install in the NODE folder";
      return;
    }
    try {
      const st = fs.existsSync(cacheFile) ? fs.statSync(cacheFile) : null;
      if (st && Date.now() - st.mtimeMs > REFRESH_MS) fs.renameSync(cacheFile, cacheFile + ".old");
    } catch (_) {}
    try {
      blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
        path: cacheFile,
        read: fs.promises.readFile,
        write: fs.promises.writeFile,
      });
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

  // Installed once on the default session (all tabs share it).
  function install(session) {
    session.webRequest.onBeforeRequest((details, callback) => {
      if (!blocker || !isEnabled() || details.resourceType === "mainFrame" || !isAllowedFor(details.webContentsId)) {
        return callback({});
      }
      blocker.onBeforeRequest(details, (response) => {
        if (response && response.cancel) {
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
  }

  return {
    load,
    install,
    stats: () => ({ status, blocked }),
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
