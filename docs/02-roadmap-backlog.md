# NODE Browser: Roadmap and Backlog

Last updated: 2026-10-26 (B26 done: AI query ideas confirmed on the Mac. B78 added and fixed: tabs switching by themselves, tabs sleeping while away. All open checks done; usability test under way. 2026-10-27: B80 sidebar and CommandBar built; Mac signing works (B46); 0.9.6 released, the first signed Mac release. B47 done: saving and filling passwords, strong passwords, import, show and copy. 0.9.5 released with B47 and B78. Earlier, 2026-10-25: 0.9.2 released, B67-B72. B73-B76 restored: added this morning from the survey as B71-B74 in another chat, lost when this file was synced, and renumbered because B71 and B72 were taken by the tab overview and gestures). The editable version (with status dropdowns) is in the review doc: https://claude.ai/code/artifact/b6ec4995-3117-41d0-a3c4-948c16e699fc

## Roadmap

Each phase ends at a gate that must pass before the next phase starts. No dates are set.

| Phase | Goal | Items | Gate (exit criteria) | Status |
| --- | --- | --- | --- | --- |
| 0. Safety and basics | No silent permissions, shortcuts work inside pages, one tab plays sound at a time | B01-B06 | Camera and mic prompt per site; S works on any page; popups need a click | Done |
| 1. Keyword engine | Keywords come from the page text, and the user's pins and hides stick | B07-B11 | Text-only articles give relevant keywords; a pinned word survives scrolling | Done |
| 2. Network layer | Cached, rate-limited search through swappable sources | B12-B15 | An hour of browsing with no search blocks; repeat pages load previews from cache | Done. Gate passed 2026-10-18 (an hour of browsing on the Mac, no problems) |
| 3. Behaviour shell | Per-site rules, research session, WebContentsView, history and find, AI query ideas | B16-B20, B25 | A new site behaviour can be added by editing a rules file, without code changes | Done. Gate passed in testing (rules edited live) |
| 4. Desktop release readiness | Installable, stable and easy to set up on macOS and Windows | B26-B50 | NODE is your daily research browser for a week with no blocking bugs | Next |
| 5. Mobile app | React Native (Expo) app reusing `core/`; see `06-mobile-plan.md` | M01-M15 | To be set when Phase 5 starts | Planning and groundwork done; build waits for the Phase 4 gate. M01-M02 (try it on a phone) can run now |

## Backlog

Effort: XS under 1 hour, S half a day, M 1-2 days, L 3+ days. Finding IDs (C1, K1, ...) refer to `04-review-findings.md`.

| ID | Phase | Item | Priority | Effort | Status |
| --- | --- | --- | --- | --- | --- |
| B01 | 0 | Ask before granting camera or microphone; deny by default (C1) | P0 | XS | Done |
| B02 | 0 | Handle S, Cmd+T, Cmd+W, Cmd+L, Cmd+R inside web pages (C5) | P0 | S | Done |
| B03 | 0 | Per-tab mute; in Mosaic only the active tile plays sound | P1 | S | Done |
| B04 | 0 | Open popups as tabs only after a user click; block the rest | P1 | S | Done |
| B05 | 0 | Media download: extension from content-type; clear error for stream URLs | P2 | XS | Done |
| B06 | 0 | Align version labels, remove duplicate CSS, fix README path | P2 | XS | Done |
| B07 | 1 | Extract title, description, headings, visible text, selection (K1-K3) | P0 | M | Done |
| B08 | 1 | Score terms against a common-word baseline; merge names and tokens (K5) | P0 | M | Done |
| B09 | 1 | Query builder: 2-4 terms per query, 2-3 queries per crawl (K4) | P0 | S | Done |
| B10 | 1 | Pinned and hidden keywords that auto-crawl never overwrites (K6) | P0 | S | Done |
| B11 | 1 | Crawl on navigation or real viewport change only; 20 s minimum gap | P0 | S | Done |
| B12 | 2 | Cache search results and previews, 30 min TTL (C6) | P0 | S | Done |
| B13 | 2 | Rate limit and timeout on all outbound requests (C6) | P0 | S | Done |
| B14 | 2 | Load previews only for cards in view, 3 at a time | P1 | S | Done |
| B15 | 2 | Search provider interface: Wikipedia, Brave API or SearXNG, DDG fallback (K7) | P1 | M | Done |
| B16 | 3 | Per-site behaviour rules: autoplay, mute, extraction recipe, Mosaic | P1 | M | Done |
| B17 | 3 | Research session: keyword trail across pages, visited suggestions | P1 | L | Done |
| B18 | 3 | Move from BrowserView to WebContentsView | P1 | M | Done |
| B19 | 3 | History, find-in-page, zoom | P2 | M | Done |
| B20 | 3 | Optional AI query expansion (local model or Grok) | P2 | M | Done |
| B21 | 5 | Add tauri.conf.json, withGlobalTauri, icons (C2) | P2 | S | Replaced (React Native plan) |
| B22 | 5 | Make Rust commands async; fix argument names (C3, C4) | P2 | S | Replaced (React Native plan) |
| B23 | 5 | Port Library, Shot, Save, Media to Rust | P2 | M | Replaced by M05 |
| B24 | 5 | Decide the mobile tab model | P2 | M | Done in planning: one WebView per tab, Mosaic on tablets (`06-mobile-plan.md`) |
| B25 | 3 | Show Wikipedia results first while web results load (web requests are spaced 2.5 s apart, so a search can take 6 s) | P1 | S | Done |
| B26 | 4 | Check on a real machine: live Wikipedia, DuckDuckGo, Brave, Grok and local model results, and an hour of browsing (Phase 2 gate) | P0 | S | Done 2026-10-26: hour of browsing and Brave results with a key confirmed on the Mac 2026-10-18; AI query ideas confirmed on the Mac 2026-10-26 |
| B27 | 4 | Installable builds for macOS (.dmg) and Windows (.exe) with an app icon | P0 | M | Done (0.4): `npm run dist:mac` / `dist:win`; not signed; automatic updates are B46 |
| B28 | 4 | Visual editor for site rules in Settings, so no JSON editing is needed | P1 | M | Done |
| B29 | 4 | Sleep background tabs that are not playing media, to save memory with many tabs open | P1 | M | Done: after 30 minutes unused (only time NODE is in use counts; Settings → Tabs: 15 min to 2 h, or never); never while playing, on screen or shared |
| B30 | 4 | First-run setup: start page, search sources, AI option | P1 | S | Done: welcome screen (Brave key, AI choice, reopen tabs, ad blocking) and a NODE new tab page |
| B31 | 4 | Error log and a Copy diagnostics button for bug reports | P1 | S | Done: logs/node.log, Settings → Help, Help menu with Report a Problem |
| B32 | 4 | Speed (feedback: "a little laggy"): read the page on the 5 s timer only after scroll, resize or selection; measure only elements near the viewport; stop drawing hidden tabs and allow background throttling | P0 | S | Done |
| B33 | 4 | Brave Search as the default: on by default (also for older settings), address-bar searches open Brave Search, one-time notice to add the key | P1 | XS | Done |
| B34 | 4 | Play media directly: start the main video or embed as soon as the page is parsed, with sound; catch late and single-page players; leave paused media paused | P1 | S | Done |
| B35 | 4 | Autoplay in several tabs at once, limit 4: the oldest playing tab pauses when a fifth starts, resumes when opened (desktop and mobile) | P1 | S | Done |
| B36 | 4 | Closing a tab while its video played crashed the app (found while testing B35; also in earlier versions) | P0 | XS | Done |
| B37 | 4 | Sound from all playing tabs at once: toolbar toggle and Cmd/Ctrl+Shift+A (desktop; mobile later) | P2 | XS | Done |
| B38 | 4 | Clicking a video, image or embedded player scrolls it to the middle of the view; site rule `center` (desktop and mobile) | P2 | S | Done |
| B39 | 4 | Standard browser gestures: trackpad swipe back/forward with an edge arrow, three-finger swipe, mouse side buttons, middle-click tab to close, double-click tab bar for a new tab, drag tabs to reorder (mobile gestures: see M16) | P2 | S | Done |
| B40 | 4 | Google sign-in said "This browser or app may not be secure": upgraded Electron 32 to 44 and made the user agent a standard Chrome one. Still refused: Google blocks Electron-based apps. NODE now explains this and offers the default browser. A real fix means building NODE on Chromium itself rather than Electron (B51) | P0 | S | Done as far as Electron allows |
| B41 | 4 | Bookmarks: star and Cmd+D, Bookmarks shelf, bookmarks first in address-bar suggestions; mobile star and list | P1 | S | Done (0.4) |
| B42 | 4 | Picture-in-picture: toolbar button and Cmd+Shift+P, works for embedded players | P1 | XS | Done (0.4) |
| B43 | 4 | Ad and tracker blocking (EasyList, EasyPrivacy) with a Settings switch and site rule `adblock` | P1 | M | Done (0.4, desktop; mobile needs a custom build) |
| B44 | 4 | Ask AI about the current page (local model or Grok): sidebar pane and mobile sheet | P1 | M | Done (0.4) |
| B45 | 4 | Competitor matrix and gap list (NODE: Current Features doc) | P1 | S | Done |
| B46 | 4 | Code signing (Apple Developer ID, Windows) and automatic updates | P1 | M | macOS done 2026-10-27: Developer ID certificate and notarization secrets added; Actions → Test Mac signing passed (signed, notarized, stapled, Gatekeeper accepts); first signed release 0.9.6, Macs update themselves from then on. Windows signing still optional (needs a code-signing certificate; SmartScreen warns once without it) |
| B47 | 4 | Passwords and autofill | P2 | L | Done 2026-10-26. Part 1 (PR #15): save after sign-in (new, update, never for this site), offer saved logins on a sign-in field and fill only when picked, right-click Fill Saved Login, two-step sign-ins, Settings → Passwords. Part 2 (PR #16): Use Strong Password on sign-up and change-password forms, sign-in forms inside frames (saved under the frame's site), import from a passwords file exported by Chrome, Brave, Edge, Safari, Firefox, 1Password or Bitwarden (offers to move the file to the Trash), Show and Copy in Settings after Touch ID (or a confirmation without it), copied passwords cleared after a minute. Encrypted with the system's secure storage, never sent. Not planned: reading other browsers' password stores directly (Chrome's encryption changes and is locked to Chrome on Windows), sync |
| B48 | 4 | Chrome Web Store extensions | P2 | L | Spike done 2026-10-25: not on Electron (see `17-extensions-spike.md`); revisit with a Chromium-based build |
| B49 | 4 | AI chat across tabs and cited summaries of a research session | P2 | M | Done (0.9.4) |
| B50 | 4 | Sync across devices | P3 | L | Not started |
| B51 | 5+ | Decide whether to move NODE from Electron to a Chromium-based browser build (as Brave, Vivaldi and Arc do), which Google sign-in accepts; large effort. See `08-engine-decision.md` | P1 | L | Decided 2026-10-14: stay on Electron and finish this build; extension dropped (see 08) |
| B53 | 4.5 | Agent view: a page's main content as Markdown (`core/markdown.js`), for agents and later for mobile and exports | P1 | S | Done |
| B54 | 4.5 | Read-only MCP server for AI agents: search, logged-out page reader, shared tabs, research sessions as resources; token, localhost only, hard blocks, rate limits, activity log, stop switch | P1 | M | Done |
| B55 | 4.5 | Trail: recurring keywords use each page's own topic words (the session weighting hid them) | P1 | S | Done |
| B56 | 6 | Built-in research agent, read-only: question in, searches, reads up to 6 pages logged out, report with numbered sources saved to the Library and the session; sources open in Mosaic | P1 | M | Done (v1) |
| S01-S03 | 4 | Talk, stage 1 of the social layer plan: Hacker News and Bluesky discussions of the current page and a Reddit search link, looked up only while Talk is open; site rule `talk` | P1 | S | Done |
| B57 | 6 | Research agent v2: follow-up questions on a report (earlier sources and notes kept), a second round of searching when the notes leave gaps, a live view of the page being read | P1 | M | Done |
| B58 | 6 | Prompt-injection red-team set (12 pages) run before each release; reader leaves out text a person cannot see; agent drops search queries that look like addresses or encoded data | P1 | S | Done |
| B61 | 4 | Browser basics: right-click menu, downloads (Library → Downloads), reopen closed tab, tab shortcuts, print and Save as PDF, error and crashed-tab pages, reopen last session's tabs | P0 | M | Done |
| B62 | 4 | Passkeys on macOS: Apple Developer ID signing, Apple's web-browser passkey entitlement (com.apple.developer.web-browser.public-key-credential), and a native bridge to AuthenticationServices (as electron-webauthn-mac does) | P1 | L | Not started; passkeys off on Mac until then |
| B63 | 4 | Watch: tab name stayed the same after moving to another page (reported once on the Mac, 2026-10-14; cleared up by itself; not reproduced on Linux with link clicks, single-page sites, restored and sleeping tabs, or Mosaic). If it happens again, note the site and how the page was left, and copy diagnostics | P2 | S | Watching |
| B64 | 4 | Usage summary for the beta survey: NODE counts locally (suggestions shown and opened, pins, hides, trail pages, sessions, agent runs, Ask AI questions, days used, version, OS); Settings → Help → Copy usage summary puts the counts on the clipboard. No pages, addresses or keywords; nothing sent automatically. See `10-beta-survey.md` | P1 | S | Done (0.9.1) |
| B65 | 4 | Beta survey prompt: after NODE has been used on 3 different days, a one-time sidebar notice (Take survey / Later / Don't ask again) opens the survey in a tab; link also in Settings → Help. Survey address in `core/urls.js` (`SURVEY_URL`) | P1 | XS | Done (0.9.1) |
| B66 | 4 | Trail skips sign-in pages: pages the sign-in, account, payment and banking rule blocks are not added to the research session, so their addresses never reach `get_research_session` or exports. Found in the MCP test (2026-10-18): X passkey and password pages and `github.com/session` were listed as pages read. Also remove them from existing sessions when they load | P0 | S | Done (0.9.1) |
| B67 | 4 | Keyword noise: leave out the signed-in user's own name taken from a site's interface (X showed "Isaac Sven Manzanarez" on every page), keyboard-shortcut help text ("shortcuts", "keyboard"), and image alt text or file names that describe interface graphics ("Brave Logo Small", "Snoo Map", "Google Button", "Semi Protection Shackle"). Add these cases to `test/keywords-eval.js`. Found in the MCP test (2026-10-18) | P1 | S | Done (0.9.2) |
| B68 | 4.5 | Agent reader (`core/markdown.js`): See also, References, Further reading and Categories lists come back as empty bullets. Keep link-only and citation list items (link text, or drop the empty list). Found with `fetch_page` on a Wikipedia article (2026-10-18) | P2 | XS | Done (0.9.2) |
| B69 | 4 | Mosaic: choose which tabs show, and at most 4 tiles. Right-click a tab → Show in Mosaic / Remove from Mosaic / Show All Tabs in Mosaic; chosen tabs carry a small Mosaic mark and are kept across restarts. Settings → Tabs → Tiles in Mosaic: up to 4 (default), 6, 9 or every tab. Opening a tab without a tile leaves Mosaic. Tester request on Reddit (2026-10-21), and Mosaic is the favourite feature in the first survey response | P1 | M | Done (0.9.2) |
| B70 | 4 | Loop a section of a video, for example one minute, in a tab. Tester request on Reddit (2026-10-21) | P2 | M | Done (0.9.2) |
| B71 | 4 | Tab overview: zoom out to every open tab as a grid of pictures and pick the Mosaic tiles like selecting photos (click or Space picks, a check and a signal border mark picked tabs, Done shows them in Mosaic, Esc cancels). Opens with ⌘⇧\\ / Ctrl+Shift+\\, View → Choose Tabs for Mosaic…, right-click on the Mosaic button or on a tab. Sven's idea (2026-10-25), builds on B69 | P1 | M | Done (0.9.2) |
| B72 | 4 | Gestures, shortcuts and a tutorial for Mosaic and the video loop. Trackpad pinch: in Focus, pinch out zooms the page and pinch in zooms it back to 100%, then to Mosaic; in Mosaic, pinch in opens the tab overview and pinch out focuses the tile under the fingers; in the overview, pinch out = Done. Ctrl + mouse wheel stays page zoom. ⌘1-⌘4 focus a tile in Mosaic. ⌘⇧L loops the next minute of video, again to stop (not plain L: YouTube uses L to skip ahead). Tutorial: 8 steps on 4 practice tabs, coach band at the bottom, waits for each gesture or shortcut, then puts the user's tabs back; offered once after the update or after setup; Help → Learn gestures and shortcuts. Prototype: "NODE Gestures" artifact. Sven's request (2026-10-25) | P1 | M | Done (0.9.2) |
| B73 | 4 | Make NODE's privacy features visible: a toolbar count of ads and trackers blocked on the page (click for details and the on/off switch), one line about blocking on the welcome screen, and a "What NODE sends" section in the README and release notes. Both survey responses named privacy as the reason not to switch, and one tester uses uBlock Origin for ads, so testers may not know NODE already blocks ads and trackers (B43). Added 2026-10-25 as B71; renumbered | P1 | S | Done (0.9.4) |
| B74 | 4 | Privacy settings page: list everything NODE sends and where (search sources, result previews, Talk, AI provider, update checks, Google window), with a switch for each, plus a "Private research" preset (local AI only, no previews fetched from pages, Talk off, Google window off). Scope it after asking testers what "more privacy" means (follow-up DMs, subreddit post). From survey responses, 2026-10-22 and 2026-10-25. Added as B72; renumbered | P1 | M | Not started; waiting on tester answers |
| B75 | 4 | Many open tabs: tab management for people who keep lots of tabs open, as Zen does (for example a vertical tab list, tab groups or workspaces, pinned tabs). A tester uses Zen for this and would switch if NODE covered it (survey, 2026-10-25). Decide the scope after the follow-up with u/upforanything67. Added as B73; renumbered | P2 | L | Not started; waiting on tester answers |
| B76 | 4 | Usability test round 1: 5 remote moderated think-aloud sessions run solo, with task success, a 1-7 ease rating per task and SUS at the end. Plan, script and note sheet in `16-usability-test.md`. Added as B74; renumbered | P1 | M | Under way (2026-10-26); survey sent to Reddit testers |
| B77 | 4 | Built-in blocker covers what uBlock Origin does by default: add uBO's own filter lists (uBlock filters, privacy, badware, quick fixes) and cookie-notice lists to the Ghostery engine, and turn on on-page hiding (cosmetic filters) and scriptlets through its preload script. Say "the same filter lists uBlock Origin uses" in the shield menu and on the welcome screen. From the B48 spike: Chrome extensions do not work on Electron 44. A tester uses uBlock Origin (survey, 2026-10-25) | P1 | M | Done (0.9.4) |
| B78 | 4 | Tabs switched by themselves after a while, and tabs went to sleep and reloaded after stepping away (Sven, Mac, 0.9.4). A Mosaic tile loading a new page by itself (next video, page refresh) took focus and became the active tab; sleep counted time away from the computer | P0 | S | Done 2026-10-26 (PR #13, merged): focus switches tabs only after a click or key press in that tab; only time in use counts toward sleep; default 30 minutes; Settings → Tabs choice. To confirm on the Mac with 0.9.5 (released 2026-10-26) |
| B79 | 4 | Full screen: the toolbar stayed on screen the whole time the menu was open, and went away only after the menu was closed (Sven, Mac, 0.9.5) | P1 | XS | Done 2026-10-26 (PR #19): the menu no longer holds the toolbar; it slides away and comes back with the pointer, as over a page. 3 checks added to `22-ui-refresh`. To confirm on the Mac with 0.9.6 |
| B80 | 4 | Sidebar chrome: another view of the browser chrome, with tabs, tools and trails in a column on the left (`18-sidebar-chrome.md`). The top bar stays and is the default | P1 | L | First version built 2026-10-27 (PR #20): layout switch, window row, address, trail header, 8 tool tiles, vertical tabs, active trails, media strip, full / rail / hidden widths, ⌘S. CommandBar built 2026-10-27 (PR #21). Trails keep their own tabs 2026-10-27 (PR #29). Still to build: MosaicGroup, width by dragging |
| B81 | 4 | Captchas switched back to the previous tab (Sven, Mac, 0.9.6). Since 0.9.5 the page script also runs in frames (B47); Chromium can host frames of one site from several tabs in one process, and the script read its tab id from its process, so a click in a captcha frame could name another tab, which NODE then made active | P0 | XS | Done 2026-10-27 (PR #25): page messages (click, activity, pinch, swipe, shortcut) name their tab by the webContents that sent them. New test `35-frames-tabs` (fails without the fix). To confirm on the Mac with 0.9.7 |
| B60 | 5 | NODE for Chromium extension | — | — | Dropped 2026-10-14: missing must-have features |
| B59 | 6 | Research agent v3: gated actions with confirmation (forms, downloads) | P2 | L | Not started |
| B52 | 4 | Google window: Google sign-in and Google apps open in a separate window of a Chromium-based browser on the computer, with its own NODE profile and a NODE extension (history, center on click, autoplay, no duplicate tabs). The extension is also the first step of B51 | P0 | M | Done; to test sign-in on the Mac |

## Open checks

- ~~Browse for an hour to check the Phase 2 gate (no search blocks).~~ Done on the Mac, 2026-10-18.
- ~~Run NODE on a real machine and confirm live results from Wikipedia and DuckDuckGo.~~ Done on the Mac, 2026-10-26 (Brave too).
- ~~Add a Brave Search API key under Settings and confirm Brave results appear.~~ Done on the Mac, 2026-10-18.
- ~~Check that browsing feels smooth with several tabs open, and that video sites (YouTube, Vimeo, news sites) start playing on their own (B32, B34). ~~ Smooth browsing and autoplay confirmed on the Mac, 2026-10-26; found B78.
- ~~Turn on AI query ideas with Ollama or Grok, press Test, and check the "(AI)" queries give useful results.~~ Done on the Mac, 2026-10-26.

These checks were backlog item B26 (done 2026-10-26). All are done.

## Mobile backlog

M01-M15 are listed in `06-mobile-plan.md`. The first two only need a phone: run the skeleton with Expo Go (M01) and check WebView behaviour on iPhone and Android (M02).
