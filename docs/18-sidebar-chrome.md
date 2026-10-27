# Sidebar chrome

A second layout for NODE's browser chrome, from the "NODE Sidebar Chrome" mockups (October 2026). The tab bar and toolbar move into one column on the left. The horizontal layout (TabBar, AddressBar) stays in the system and in the build; this is another view of the same features, not a replacement.

## Why a sidebar

- Research sessions run to many tabs. Titles stay readable in a vertical list; in a horizontal bar they shrink to icons.
- Trails become visible. In the horizontal layout they live in the Menu; in the sidebar the active trails sit under the tabs and switch with one click.
- Wide screens have spare width, not spare height. The page keeps its full height.

## Anatomy

| Part | Component | Notes |
| --- | --- | --- |
| Window row | (in Sidebar) | Traffic lights, hide sidebar ⌘S, back, forward, reload. 36 px. |
| Address | AddressField | A button that opens the CommandBar. |
| Current trail | TrailHeader | Name, pages, keywords. |
| Toolbar | ToolGrid of ToolTiles | 8 tiles, 4 × 2: Mosaic, Capture, Suggestions, Sound / Bookmark, History, Downloads, Menu. |
| Tabs | TabRow | New tab on top. Current, playing, asleep states. |
| Mosaic | MosaicGroup | Shown above the tabs while Mosaic is on. |
| Trails | ActiveTrails | Expanding section at the foot. Replaces numbered sessions. |
| Media | MediaStrip | Playing count and sound mode. |
| Go / search / ask | CommandBar | ⌘L or ⌘T. Groups: Open tabs, Trails, Ask, Search. |

## Three widths

| State | Width | What changes |
| --- | --- | --- |
| Expanded | `sidebar-width` 272 px (220–340) | Everything above. |
| Rail | `rail-width` 68 px | 44 px tiles. 5 tools (Bookmark, History, Downloads go to Menu). Trail monograms. No MediaStrip. |
| Hidden | 0, with one 36 px show-sidebar button | Full screen or reading. ⌘S toggles. |

## State colours in the chrome

| Meaning | Token | Example |
| --- | --- | --- |
| This is showing | `border-current` (white on dark) | Current tab, current trail, Suggestions open, Mosaic on |
| A mode is on and affects media now | `toggle-on` (= `signal`) | Sound: all |
| Something is playing | `live` | Speaker and time on a tab, dot on a trail |
| Not loaded, not current | `ink-muted` | Asleep tab, other trails |

White means "you are here". Violet means "active now". Green means "playing". Do not swap them.

## Layout rules

- The page sits right of the sidebar with an 8 px gap and a 1 px `line` frame. Square corners.
- The suggestions widget (`widget-width`) sits right of the page when open. Its toolbar button is the Suggestions tile.
- Nothing overlaps the page in the Electron build: pages are native views drawn above HTML. The rail pushes the page; the CommandBar and Menu show a dimmed capture of the page under `scrim`.

## Motion

Uses the existing tokens. Tile borders fade on at `motion-base` / `ease-enter` and off at `motion-fast` / `ease-exit`, after the state is confirmed. The ActiveTrails chevron turns at `motion-base` / `ease-move`. Sidebar width changes are not animated in the first version (the native page view would resize every frame). Reduced motion: fades only.

## Open questions

- Pinned sites were in the first mockup and were replaced by the tool tiles. If they come back, they go above the tab list as one row.
- ~~How a trail stores its tabs when it is not current (all asleep, or kept loaded up to a limit).~~ Decided 2026-10-27: kept loaded, out of view, under the usual sleep rule (asleep after 30 minutes of use, never while playing). Can change to "asleep at once" later.

## In the Electron build (B80, first version, 2026-10-27)

How it is built: one set of controls, two places for them. In Sidebar mode `renderer/app.js` moves the real toolbar buttons, the address bar, the find bar and the tab list into the sidebar's slots (`#sidebar [data-slot]`), so every control keeps its click handler, shortcut and state; Top bar mode puts each one back where a comment marks its place. The page's position comes from `main.js` `contentRect()`, which the renderer tells the sidebar's width (`layout:chrome`); `.page-frame` in `renderer/styles.css` draws the 1 px frame around the same rectangle.

| Part | Status |
| --- | --- |
| Layout switch | Settings → Tabs → Layout (Top bar or Sidebar), and View → Use Sidebar Layout. Saved (`chromeLayout` in settings). Top bar stays the default. |
| Window row | Hide sidebar, back, forward, reload, full screen; agent and download buttons when they show. The system's own title bar keeps the traffic lights, so they are not drawn. The row drags the window. |
| Address | The real address bar in a field, with the shield and zoom. Clicking it opens the CommandBar. |
| CommandBar | ⌘L, the address field or the rail's search button open it on the current address (selected); ⌘T and New tab open it empty in new-tab mode. Over a dimmed picture of the window, like the Menu (the pages are hidden while it is open). Groups: Open tabs (title or address), Trails (switch; start a new trail with what was typed), Ask (ask about this page; run the research agent), Search (search or go to an address; bookmarks and history not open). Selected first: a tab whose title starts with what was typed, else Search or Go to. Keys: ↑↓ move, ↵ open, ⇧↵ new tab, Tab ask, ⌘↵ agent, ⌥↵ new trail, Esc close. Fades in at `motion-base` / `ease-enter`, out at `motion-fast`. The top bar keeps its own address bar. Not yet: trail keywords row, search suggestions from the search engine. |
| TrailHeader | The current research session's name, pages and keywords (threads). Click: Menu → Trail. |
| ToolGrid | 8 tiles, 4 × 2. History and Downloads tiles open those Menu sections. Mosaic on and Suggestions open: white border; Sound: all: violet. |
| Tabs | Vertical list with a monogram, title, sound, close; current tab white border; asleep "zz"; drag to reorder up and down. New tab on top. |
| ActiveTrails | Research sessions, newest first (up to 8), with their number of tabs: click to switch, New trail, folds open and closed. Each trail keeps its own tabs (below). |
| MediaStrip | Number of tabs playing and the sound mode (SOUND: ONE / ALL, violet for all). |
| Widths | Full 272 px, rail 68 px, hidden (a 52 px column with the show button). ⌘S hides and shows; right-click the sidebar's empty space or View → Compact or Full Sidebar switches full and rail. ⌘L in the rail or hidden opens the full sidebar with the address bar focused. Remembered per computer. |
| Full screen | The sidebar stays; the top bar's sliding toolbar is not used. |
| Not built yet | MosaicGroup, sidebar width by dragging (220–340). |

**Trails keep their own tabs (PR #29).** Each tab belongs to the trail that was current when it opened. Switching trails (sidebar, CommandBar, or Menu → Trail in either layout) shows that trail's tabs and the tab that was active there; the other trails' tabs stay open out of view and follow the usual sleep rule. A trail with no tabs opens one new tab. The tab list, Mosaic, the tab overview, Next and Previous Tab, ⌘1–9, closing and reordering work on the current trail's tabs. Saved with the open tabs (`trail` in `tabs.json`); tabs saved by an earlier version join the current trail.

Tests: `test/e2e/33-sidebar-chrome.js` (32 checks) and `test/e2e/34-command-bar.js` (26 checks, CommandBar, PR #21) and `test/e2e/36-trail-tabs.js` (13 checks, PR #29), in CI on Linux and Windows.
