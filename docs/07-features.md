# NODE: Current Features

As of 2026-10-13 (NODE 0.4). The editable version is the "NODE: Current Features" doc: https://claude.ai/code/artifact/f8e89633-9036-4b9a-9726-10aede2884fd

NODE is a research browser that reads the page you are on, picks out keywords, and suggests the next pages to read. It also plays media in several tabs at once and keeps a trail of your research.

| Build | Status |
| --- | --- |
| Desktop (macOS, Windows, Linux) | Working. Electron 44 (Chromium 152). Run from Terminal; no installer yet |
| Mobile (iPhone, Android) | Working in Expo Go on iPhone, still being tested. Same search and keyword logic as desktop |

## New in 0.4

- Bookmarks: star or Cmd+D, Bookmarks shelf (Cmd+Shift+B), bookmarks first in address-bar suggestions; phone star and list.
- Picture-in-picture: PiP button or Cmd+Shift+P, also for embedded players.
- Ad and tracker blocking (desktop): EasyList and EasyPrivacy, weekly updates, Settings switch, site rule `adblock`.
- Ask AI about the current page (Ask tab in the suggestions widget; phone: Suggestions → Ask AI), local model or Grok; page text sent only when asked.
- Installer: `npm run dist:mac` (.dmg with icon), `npm run dist:win`. Not signed; no automatic updates yet.

## Desktop: tabs and layout

- Tabs are full Chromium pages. Mosaic shows every tab in a grid; Focus shows one.
- Tab bar: drag to reorder, middle-click to close, double-click the empty bar for a new tab.
- Address bar: searches open Brave Search; history suggestions while typing.
- Popups only right after a click or key press; others are blocked and listed.
- Toolbar buttons are icons; hovering shows the name and shortcut. Capture holds Screenshot (or S), Save Page, Save Media and Picture in Picture in one menu.
- Suggestions widget beside the page with Suggest, Ask, Agent and Talk tabs; collapses (Cmd+Shift+.) to give the page the full width, with the result count on the toolbar button.
- Menu (☰, Cmd+,): Library, Bookmarks, History, Downloads, Trail, Settings and Help in one panel over the page.
- Full screen hides the toolbar; it comes back while the pointer is at the top edge.

## Desktop: media and sound

- Autoplay of the page's main media as soon as the page loads, including late players and YouTube video changes. Paused media stays paused.
- Up to 4 tabs play at once; a fifth pauses the oldest (marked ⏸), which resumes when opened.
- Only the current tab has sound by default; "Sound: all" (Cmd+Shift+A) lets all playing tabs be heard. Per-tab speaker button.
- Clicking a video, image or embedded player centers it on screen.

## Desktop: suggestions and search

- Keywords from title, description, headings, selection and visible text; names kept together.
- Pin and hide keywords; selecting text searches for it.
- 2-3 short searches; Wikipedia in about a second, web results after; lazy preview images; hide results.
- Auto re-search on new page, selection or new content.
- Sources: Wikipedia, Brave Search (default, needs a key), SearXNG, DuckDuckGo fallback; failing sources pause.
- Optional AI query ideas from a local model or Grok; page text and addresses are never sent.

## Desktop: trail, history, find, zoom

- Research sessions: pages read with keywords, recurring keywords, opened and hidden results, read marks, pins per session, rename, switch, new, export to Markdown.
- History shelf (Cmd+Y), find in page (Cmd+F), per-tab zoom with badge.

## Desktop: site rules, safety, speed

- Per-site rules file: autoplay, sound, popups, suggest, mosaic, center, extract (areas to read or skip). Live reload, errors shown.
- Permissions always ask; sign-in, banking and payment pages never read or autoplayed; keys encrypted with the keychain; standard Chrome user agent.
- Page re-read only after scroll, resize or selection; hidden tabs stop drawing; 30-minute result cache; requests spaced per site.

## Desktop: everyday browsing

- First start: a short welcome screen for the Brave key, AI choice, reopening tabs and ad blocking.
- New tabs open NODE's start page (search box and most visited pages), or an address set in Settings → Startup.
- Help menu and Settings → Help: Copy diagnostics (version, system, features on, recent errors; no page text or keys), Report a Problem, Open Log Folder.

- Right-click menu: open link in a new or background tab, copy or save links and images, search Brave for or pin selected text, spelling suggestions, back, forward, reload, print, Save as PDF, Inspect.
- Downloads go to the Downloads folder (a number is added when a name is taken); progress in the toolbar, list in Menu → Downloads with Open, Show in folder and Cancel.
- Tabs from last time reopen on start (Settings → Startup); tabs unused for 30 minutes of use sleep to save memory and load again when clicked (time away from the computer does not count; Settings → Tabs: 15 minutes to 2 hours, or never).
- Passwords (B47): after a sign-in NODE asks to save the password (or update it); clicking a sign-in field on that site offers the saved logins, filled only when picked; right-click → Fill Saved Login. Two-step sign-ins work. Stored encrypted with the system's secure storage, never sent. Settings → Passwords: list with Show, Copy (after Touch ID or a confirmation; cleared from the clipboard after a minute) and Remove, Never saved for, Import Passwords… from a file exported by Chrome, Brave, Edge, Safari, Firefox, 1Password or Bitwarden. Use Strong Password on sign-up and change-password forms. Sign-in forms inside frames from another site.
- Sidebar layout (B80): Settings → Tabs → Layout or View → Use Sidebar Layout puts the tabs, tools, current trail, active trails and a media strip in a column on the left. Full, compact rail or hidden (⌘S). The top bar stays the default. See `18-sidebar-chrome.md`.
- Reopen Closed Tab (Cmd/Ctrl+Shift+T), Next and Previous Tab (Ctrl+Tab, Ctrl+Shift+Tab), Cmd/Ctrl+1 to 9, Print (Cmd/Ctrl+P), Save Page as PDF.
- A page that fails to load, or whose tab crashes, shows a NODE page with the reason and Try again.

## Look

- Follows the NODE brand guideline: black ground, white type, one violet accent, Barlow and JetBrains Mono (bundled), uppercase labels, hairlines instead of boxes and shadows.

## Desktop: Talk

- **Talk** tab in the suggestions widget: Hacker News stories and Bluesky posts that link to the page you are reading, and a Reddit search link. Clicking one opens it in a tab.
- Looked up only while Talk is open, with tracking parameters removed. Never for sign-in, account, payment or banking pages, local addresses, or sites with the rule `"talk": false` or `"suggest": false`.

## Desktop: research agent

- **Agent** tab in the suggestions widget: type a question; NODE plans up to 3 searches, reads the best results in the logged-out agent session, checks its notes for gaps and searches once more if needed (8 pages at most), then writes a short report with numbered sources.
- A small live view shows the page the agent is reading. Follow-up questions keep the earlier sources and their numbers and only read new pages.
- Each step is listed as it happens; Stop ends it between steps.
- Reads only addresses from its own search results, so text on a page cannot send it elsewhere; page text is marked as untrusted for the model; links in the model's text are removed and the sources list is built by NODE.
- The report is saved to the Library and listed in the research session; **Open sources in Mosaic** opens up to 4 sources side by side.
- Uses the model set in Settings → AI (local model or Grok).

## Desktop: AI agents (MCP)

- Off by default. When on, agents on this computer (Claude Code, Codex, Cursor) connect over MCP with a token shown in Settings.
- Tools: web search with NODE's sources, a logged-out page reader that returns Markdown, tabs the user shares, research sessions.
- Read-only. Sign-in, payment and banking pages, password and card forms, and local network addresses are refused in code.
- Every call is logged in Settings and in the research session; the green **Agents** toolbar button stops the server and unshares all tabs.

## Desktop: Google window

- Google sign-in and Google apps open in a separate window of a Chromium-based browser (Brave, Chromium, Edge, Vivaldi or Chrome) with its own NODE profile, because Google refuses sign-in inside Electron.
- The NODE tab shows a placeholder; its button brings the page to the front. Pages already open there are not opened twice.
- A NODE extension in that window adds visits to NODE's history and applies center on click and autoplay. Google Chrome 137 and later may refuse the extension; the window then works for sign-in only.
- Settings: sign-in and apps, sign-in only, or off. Search, YouTube and Scholar searches stay in NODE.
- Not in the Google window: Mosaic, keyword suggestions, the Ask pane and the 4-tab playback limit.

## Desktop: gestures and shortcuts

| Gesture or keys | Action |
| --- | --- |
| Two-finger swipe right / left | Back / forward, with an edge arrow |
| Three-finger swipe (if set in macOS) | Back / forward |
| Mouse side buttons | Back / forward |
| Pinch, Cmd + scroll | Zoom |
| Middle-click or Cmd+click a link | Background tab |
| Middle-click a tab | Close |
| Double-click empty tab bar | New tab |
| Drag a tab | Reorder |
| S, Cmd+Shift+S | Screenshot |
| Cmd+T, Cmd+W, Cmd+L, Cmd+R | New tab, close, address bar, reload |
| Cmd+[ / ] | Back / forward |
| Cmd+F, Cmd+G, Shift+Cmd+G | Find, next, previous |
| Cmd+= / - / 0 | Zoom in, out, reset |
| Cmd+Y | History |
| Cmd+Shift+M / A / U | Mosaic, sound from all tabs, mute tab |

## Mobile app

- Tabs kept loaded; tab list; Mosaic on every screen (up to 4 tiles on a phone in portrait).
- Autoplay per site rule, also on YouTube's mobile site; up to 4 tabs playing; videos paused by the phone are restarted (max 6 a minute, count shown in the tab list).
- iPhone and iPad: only the current tab has sound (iOS rule). Android: "Sound: all".
- Center on tap; address-bar suggestions (Brave search, history, Wikipedia).
- Suggestions, Trail (export via share), Settings; keys in the phone keychain.
- Gestures: swipe address bar to change tabs, swipe a tab left to close, hold tab count for a new tab, Android back; iPhone edge swipe and pull to refresh.

## Not built yet or still to confirm

- Live check of results and an hour of browsing (B26); Google sign-in after the upgrade (B40); iPhone retest (M01, M16).
- Code signing (B46), extensions (B48), chat across tabs (B49), sync (B50), ad blocking on the phone.
- Site rules editor (B28), sleeping background tabs (B29), first-run setup (B30), error log (B31).
- Media in the background when the phone app is not in front (needs a custom build, not Expo Go).
