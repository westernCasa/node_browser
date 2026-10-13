# 08 — Engine decision: Electron vs a Chromium-based build (B51)

Date: 2026-10-13. Status: **proposed — waiting on Sven's pick.**

## Why this came up

Google blocks sign-in inside Electron apps ("This browser or app may not be secure"). NODE sends an honest Chrome-style user agent, but Google also checks other signals that identify embedded frameworks. The only real fix is to be a real browser built on Chromium, like Brave, Vivaldi, Arc and BrowserOS. Faking Chrome harder is ruled out: it breaks Google's terms and the agent research's own rule ("don't spoof user agents to dodge blocks").

## What the agent research says, and how each path fits it

| Research item | Stay on Electron | Chromium-based build |
|---|---|---|
| MCP server inside the browser | Easy: runs in `main.js` | Extension + native-messaging helper, or C++ patch |
| CDP without a debugging port | `webContents.debugger`, built in | `chrome.debugger` extension API (shows a warning bar) or a patch |
| Separate agent session (`persist:scout-agent`) | One line | Separate profile; works, more plumbing |
| Markdown / accessibility views of pages | Already have `readableTextScript` | Same script as a content script |
| Research sessions as MCP resources | Easy | Same, via the helper |
| Mosaic agent dashboard | Already built | Needs a C++ patch for 4 tiles (Chrome's split view is 2 panes) |
| Honest identification | Fine | Fine, and Google sign-in works |
| Maintenance | Electron update every 8 weeks (flagged as a permanent cost) | Chromium rebase every 4 weeks; 100 GB+ checkout, multi-hour builds |
| Same-origin safety for agents | Must build ourselves | BrowserOS already has SOPGuard work (research cites it) |
| Mobile | No change: iOS needs WebKit either way | No change |

Short version: the research plan was written for Electron and is cheapest there. A Chromium build fixes Google and gains "real browser" status, but makes the agent features and Mosaic harder.

## Keeping NODE's features on a Chromium build

| Feature | Carries over as |
|---|---|
| Keyword extraction, rules, providers, history ranking, AI/chat (`core/`) | Same JS, run in an extension service worker |
| Autoplay on up to 4 tabs, sound on all | Content scripts + autoplay policy flag; limiter in the service worker |
| Center media on click, gestures, PiP | Content scripts / native Chromium |
| Ad blocking | Built-in Ghostery/uBlock-style engine (MV3 rules) |
| Ask pane, Library, research trails | Side panel |
| Bookmarks, history, find, zoom | Native Chromium |
| Address-bar suggestions | **Needs a C++ omnibox patch** (extensions only get a keyword mode) |
| Mosaic (4 live tiles) | **Needs a C++ patch** |
| Google sign-in | **Works** |

Two features need real Chromium C++ work. Everything else ports.

## Options

**A. Stay on Electron, send Google sign-in to the system browser.** Smallest cost. Google sites stay signed-out inside NODE. Agent roadmap goes fastest.

**B. Build on an existing open-source Chromium browser (recommended path if moving).** Start from BrowserOS or ungoogled-chromium, ship NODE's features as a built-in extension, then add the two C++ patches (omnibox, Mosaic). Someone else carries most of the rebase work. Check the base project's license first (BrowserOS is AGPL as far as known; verify).

**C. Our own Chromium fork from scratch.** What Brave and Vivaldi do, with full teams. Not workable for one person.

## Recommendation

Move, but staged so nothing is lost:

1. **Spike (1–2 weeks):** load NODE's features as an extension in a BrowserOS / Chromium build. Confirm Google sign-in, autoplay x4, ad blocking, Ask pane. Measure how hard the omnibox and Mosaic patches are.
2. **Keep Electron NODE as the daily build** until the Chromium build reaches parity. `core/` stays shared, so work isn't duplicated.
3. **Switch** once the spike passes and both patches work. Then build the research's MCP server on the new base.
4. If the patches turn out too costly, fall back to A and revisit later.
