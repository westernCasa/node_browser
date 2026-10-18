# 08 — Engine decision: Electron vs a Chromium-based build (B51)

Date: 2026-10-13. Status: **staged plan agreed. First step built: the Google window (B52)**, a separate Chromium-based window for Google account pages with a NODE extension. That extension is the same one step 1 below needs.

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

## Step 1 results (2026-10-13): NODE as a Chromium extension

Built `chromium/` (NODE for Chromium, a Manifest V3 extension with a side panel) from the shared `core/` code and tested it in Playwright's Chromium (`npm run build:chromium`, `npm run test:chromium`, test 19). Google sign-in could not be checked here (no access to Google); a Chromium-based browser is the setup Google accepts, so this needs one check on the Mac.

| Feature | In the extension | Result | Work to finish |
| --- | --- | --- | --- |
| Keywords from the visible page | Same `core/keywords.js` and page script | Same 8 keywords as the desktop test on the same page | None |
| Search sources and fallback | Same `core/providers.js`, `core/suggest.js` in the side panel | Wikipedia and web results shown | Brave key setting added; SearXNG and AI query ideas not wired yet (S) |
| Autoplay | Same autoplay page script as a content script | Plays on load | None |
| 4-tab playback limit | Same `core/playback.js` in the service worker, across real tabs | 5 video tabs: 4 playing, the oldest paused | Resume when a paused tab is opened works through `tabs.onActivated`; check on a real profile |
| Center on click | Same page script | Scrolled the clicked image to the middle | None |
| Talk | Same `core/talk.js` | Hacker News row shown | None |
| Sound: only the active tab | Not built | Chrome plays every tab's sound by default (the desktop "Sound: all") | `tabs.update({muted})` on tab switch (S) |
| Ad blocking | Not built | — | `declarativeNetRequest` rule lists, or recommend uBlock Origin Lite (M) |
| Research trail, Library | Not built | — | `core/research.js` with `chrome.storage` (M) |
| Ask AI, research agent | Not built | A side panel can call a local model or Grok | The agent's logged-out reader needs its own profile; a normal extension reads with the user's cookies (M–L) |
| MCP server for agents | Not possible in an extension | Extensions cannot open a local port | Native messaging helper app (M) |
| Address-bar suggestions | Not possible | Extensions only get a keyword mode in the address bar | Chromium patch (L) |
| Mosaic (4 tiles) | Not possible | Chrome's split view shows 2 tabs | Chromium patch (L), or 4 windows tiled by the extension (S, rough) |
| Google sign-in | Works in any Chromium browser | Not testable here | Check on the Mac |

What this shows:

1. NODE's research core (keywords, suggestions, autoplay, the playback limit, center on click, Talk) carries over to Chromium almost unchanged: about a day of work, because `core/` was already shared. Google Chrome 137 and later only loads unpacked extensions in developer mode; distribution would go through the Chrome Web Store or Brave, Edge and Chromium.
2. The parts that make NODE more than an extension (Mosaic, address-bar suggestions, the MCP server, the logged-out agent reader) are exactly the parts that need a Chromium build or a helper app.

## Decision (2026-10-18)

Sven: start the full Chromium build (option B), on ungoogled-chromium rather than BrowserOS (BrowserOS is AGPL-3.0; NODE is MIT). The Electron app stays the daily and release build until the Chromium build reaches parity. NODE's panel is built into the browser as a component extension, which is what the extension work above was for. Plan and status: `13-chromium-build.md`; code: `browser/`.

## Decision (2026-10-14, replaced)

Sven: the features an extension cannot have (Mosaic, address-bar suggestions, the MCP server, the logged-out agent reader) are must-haves, so NODE does not ship as an extension. The extension code was removed from the repo (it stays in the git history, commit 9441fd3). NODE stays on Electron, with the Google window for Google accounts, and the next work is finishing this build for release. A full Chromium build stays the long-term option for Google sign-in inside NODE itself.

Earlier recommendation, for the record: keep the Electron app as NODE's main build (it has Mosaic, agents and MCP today) and the Google window for Google accounts. Ship "NODE for Chromium" as a second, lighter product for people who want NODE's research panel inside Chrome, Brave or Edge; it also reaches users who will not switch browsers. Revisit a full Chromium build only if Mosaic or the address bar become the reason people choose NODE.
