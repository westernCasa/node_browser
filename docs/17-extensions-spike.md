# NODE Browser: Chrome Extensions Spike (B48)

Date: 2026-10-25. Question: can NODE run Chrome extensions, starting with uBlock Origin, which a beta tester uses and named as a reason to stay on Zen?

Short answer: not in a way worth shipping. Electron 44 (Chromium 146) loads extensions, but it is missing too many of the extension APIs that ad blockers need, and the one blocking path that works conflicts with NODE's own request handling. The tester's need is better met by making NODE's built-in blocker use uBlock Origin's own filter lists and hide on-page ads (new item B77).

## What was tested

Each extension was loaded into a bare Electron 44.7.0 app on Linux with `session.extensions.loadExtension`, then a page asked for ad and tracker addresses.

| Extension | Result |
| --- | --- |
| uBlock Origin Lite 2026.1021 (Manifest V3, from the official uBOL-home repo) | Loads. Its service worker crashes at start: `chrome.permissions` is missing. `chrome.offscreen` and `chrome.userScripts` are missing too. Nothing is blocked |
| A minimal Manifest V3 test extension with one blocking rule | `chrome.declarativeNetRequest` exists, but its rules are never applied: the static rule list is not enabled, and a dynamic rule is stored but does not block. uBO Lite blocks only through these rules |
| uBlock Origin 1.75.1.18 (Manifest V2, built from the official source with its filter lists) | Loads. Crashes at start: `chrome.browserAction` is missing. With stand-ins for the missing APIs it gets further, then stops at `chrome.alarms`, which Manifest V2 background pages do not get in Electron. Also missing: `contextMenus`, `privacy`, `webNavigation`, `permissions`, `windows` |
| A minimal Manifest V2 test extension with a blocking `webRequest` listener | Works, but only if the app itself registers no `session.webRequest` handler on the same session. As soon as the app has one (NODE's ad blocker does), the extension's listener is never called |

Extension APIs available in a Manifest V3 service worker: `declarativeNetRequest` (present, not enforced), `tabs`, `scripting`, `storage`, `webRequest`, `alarms`, `runtime`, `i18n`, `management`. Missing: `permissions`, `offscreen`, `userScripts`, `windows`, `action`, `contextMenus`, `webNavigation`.

## Options considered

| Option | What it would take | Verdict |
| --- | --- | --- |
| A. Ship uBlock Origin (Manifest V2) | `electron-chrome-extensions` (npm, 4.10.0) fills in tabs, windows, the toolbar button, context menus and webNavigation; stand-ins for the rest; NODE gives up its own request handler on the browsing session; a Chrome Web Store installer (`electron-chrome-web-store`). Manifest V2 is being removed from Chromium, so this could break with any Electron update | Large and fragile. Not now |
| B. Ship uBlock Origin Lite (Manifest V3) | Needs `declarativeNetRequest` to be enforced, which Electron does not do | Not possible on Electron today |
| C. General Chrome Web Store support | Everything in A, plus each extension's own missing APIs | Large; most extensions would half-work |
| D. Make the built-in blocker cover what uBlock Origin does by default | The Ghostery engine NODE already uses reads uBlock Origin's filter lists. Add uBO's own lists (uBlock filters, privacy, badware, quick fixes) and cookie-notice lists, and turn on its on-page hiding (cosmetic filters) and scriptlets, which need its preload script | Small to medium. Recommended (B77) |
| E. Chromium-based build | Full extension support, as Brave and Vivaldi have. Decided against on 2026-10-14 (B51) and paused | Revisit only if extensions become a must-have for many testers |

## Recommendation

1. Build B77: the built-in blocker uses uBlock Origin's default filter lists, hides on-page ad boxes, and blocks cookie notices. Say so plainly in the shield menu and on the welcome screen ("the same filter lists uBlock Origin uses").
2. Ask the tester (u/upforanything67) whether that covers what they use uBlock Origin for, or whether they rely on its custom filters or the element picker.
3. Keep B48 open for a later Chromium-based build. Do not ship Electron extension support.

## How to repeat the test

The spike app and stand-ins were throwaway code in the session workspace, not in the repository. To repeat: load an unpacked extension into a bare Electron app with `session.defaultSession.extensions.loadExtension(path)`, listen to the background page or service worker console, and load a page that asks for an ad address. A blocked request fails with `ERR_BLOCKED_BY_CLIENT`; an unblocked one fails or loads normally. Do not register any `session.webRequest` handler in the test app, or extension listeners are never called.
