# Scout: Current Features

As of 2026-10-13 (Scout 0.4). The editable version is the "Scout: Current Features" doc: https://claude.ai/code/artifact/f8e89633-9036-4b9a-9726-10aede2884fd

Scout is a research browser that reads the page you are on, picks out keywords, and suggests the next pages to read. It also plays media in several tabs at once and keeps a trail of your research.

| Build | Status |
| --- | --- |
| Desktop (macOS, Windows, Linux) | Working. Electron 44 (Chromium 152). Run from Terminal; no installer yet |
| Mobile (iPhone, Android) | Working in Expo Go on iPhone, still being tested. Same search and keyword logic as desktop |

## New in 0.4

- Bookmarks: star or Cmd+D, Bookmarks shelf (Cmd+Shift+B), bookmarks first in address-bar suggestions; phone star and list.
- Picture-in-picture: PiP button or Cmd+Shift+P, also for embedded players.
- Ad and tracker blocking (desktop): EasyList and EasyPrivacy, weekly updates, Settings switch, site rule `adblock`.
- Ask AI about the current page (sidebar Ask; phone: Suggestions → Ask AI), local model or Grok; page text sent only when asked.
- Installer: `npm run dist:mac` (.dmg with icon), `npm run dist:win`. Not signed; no automatic updates yet.

## Desktop: tabs and layout

- Tabs are full Chromium pages. Mosaic shows every tab in a grid; Focus shows one.
- Tab bar: drag to reorder, middle-click to close, double-click the empty bar for a new tab.
- Address bar: searches open Brave Search; history suggestions while typing.
- Popups only right after a click or key press; others are blocked and listed.
- Library: Shot (or S), Save (page note), Media (download main image or video).

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
- Code signing and automatic updates (B46), passwords (B47), extensions (B48), chat across tabs (B49), sync (B50), ad blocking on the phone.
- Site rules editor (B28), sleeping background tabs (B29), first-run setup (B30), error log (B31).
- Media in the background when the phone app is not in front (needs a custom build, not Expo Go).
