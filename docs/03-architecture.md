# Scout Browser: Architecture

Last updated: 2026-10-10 (commit 4bab266, after Phase 3). Describes the Electron build.

## Files

| File | Lines | Role |
| --- | --- | --- |
| `main.js` | 1,562 | Main process: tabs, layout, sound, popups, permissions, menu, page extraction, network layer, settings, site rules, history, find, zoom, search, previews, library, session IPC |
| `keywords.js` | 325 | Keyword pipeline: scoring, phrases, query builder |
| `providers.js` | 274 | Search sources (Wikipedia, Brave, SearXNG, DuckDuckGo) and the registry that picks between them |
| `rules.js` | 155 | Site rules: default file, validation, URL matching, merging |
| `research.js` | 177 | Research sessions: trail, pins, opened, dismissed, recurring keywords, Markdown export |
| `preload.js` | 57 | Exposes `window.scout` to the toolbar UI over IPC |
| `view-preload.js` | 39 | Runs in every web page: reports clicks (tab focus, popup permission) and the S shortcut |
| `renderer/index.html`, `app.js`, `styles.css` | 143 / 1,236 / 501 | Toolbar, find bar, tabs, sidebar (Suggestions, Trail, Settings), Library and History shelf |
| `renderer/tauri-bridge.js`, `src-tauri/` | | Tauri build. Does not compile yet (Phase 4) |
| `test/*-demo.js` | | Checks without the browser: `npm run test:keywords`, `test:providers`, `test:rules` |
| `test/e2e/` | | End-to-end tests (Playwright driving Electron) with local test pages; see its README |

`keywords.js`, `providers.js`, `rules.js` and `research.js` have no Electron code, so they can be tested with plain Node.

## How the pieces connect

1. The toolbar UI (`renderer/`) calls `window.scout.*`, defined in `preload.js`, which sends IPC messages to `main.js`.
2. `main.js` creates one `WebContentsView` per tab. Each runs `view-preload.js` in a sandbox.
3. `main.js` sends events back to the UI on two channels: `tab:event` (tab list, page loaded, popup blocked) and `ui:command` (focus address bar, toggle Mosaic, screenshot done, error).

## Suggestion pipeline

| Step | Where | What happens |
| --- | --- | --- |
| 1. Trigger | `app.js` `crawlViewport()` | Runs when a page finishes loading, on the Crawl button, and every 5 s. The 5 s check only searches if the page changed, new text was selected (3 s minimum gap), or the top keywords drifted (less than 50% overlap) and 20 s have passed. Auto can be turned off. |
| 2. Extract | `main.js` `extractPage()` | Script injected into the page. Returns title, meta description, h1-h3 headings, selected text, visible readable text (up to 6,000 characters; nav, footer, aside, menus and cookie banners skipped), and media alt text and file names. |
| 3. Rank | `keywords.js` `rankTerms()` | Scores each word by where it appears (selection 6, title 4, headings 3, description 2, names 2, text 1, media 0.6), with diminishing returns for repeats. Removes stop words, web boilerplate and the site's own name. Merges plurals. Lowers very common English words. Multiplies by session rarity (`SessionDF`: words seen on most of the last 60 pages lose weight). Finds multi-word names ("Marie Curie") and lets them replace their single words. Returns the top 12. |
| 4. Pins and hides | `app.js` | Pinned keywords (user-chosen) always go into searches and are never replaced. Hidden keywords are removed and remembered in local storage. |
| 5. Build queries | `keywords.js` `buildQueries()` | Up to 3 queries of at most 4 words: the strongest terms; the top term plus the next tier; the page's own title (dropped when something is pinned). Pins go into every query. |
| 6. Search | `main.js` `runQueries()` + `providers.js` | Two calls. First `part: "reference"`: Wikipedia only, returned at once, while web requests start in the background. Then `part: "all"`: Wikipedia (from cache) plus web results for the first two queries, merged round-robin, duplicates and the current page removed, up to 12 kept. |
| 7. Show | `app.js` `crawl()`, `renderResults()` | Wikipedia results show first; the full list replaces them, keeping cards already on screen. Results hidden in this session are filtered out. Results for a page the user has already left are dropped. Cards show source and query, a "read" badge if opened or read in this session, and a × to hide. |

## Search sources

`providers.js` defines each source with an id, label, role, settings fields and a `search(query, ctx)` function. The `Registry` class tracks each source's health.

| Source | Role | Setup | Failure handling |
| --- | --- | --- | --- |
| Wikipedia | Reference: runs for every query | Optional language code | Errors return no Wikipedia results for that query |
| Brave Search API | Web, tried first | API key | 401/403: paused 30 min. 429: paused 5 min |
| SearXNG | Web, tried second | Instance URL with JSON output enabled | 403: paused 30 min with instructions to enable JSON |
| DuckDuckGo | Web, fallback | None | 202/403 or challenge page: paused 10 min |

For each query the registry uses the first web source that is enabled, configured, not paused, and returns results. The Test button runs one search and ignores a pause. Changing a source's settings clears its pause. The status line warns only when no web source is available.

## Network layer

All outbound requests from `main.js` go through `getText()`:

- Cached for 30 minutes, up to 500 entries. Only successful responses are cached.
- Identical requests that are already running are shared.
- At most 4 requests run at once.
- Minimum gap between requests to the same host: DuckDuckGo 2.5 s, Brave 1.1 s, others 0.4 s.
- Every request times out (10 s by default, 8 s for previews).

## Previews

Result cards that already have an image (often Wikipedia and Brave) show it directly. Other cards fetch a preview only when they scroll into view, at most 3 at a time. A new result list cancels previews still waiting. The preview fetch reads the page's Open Graph image, JSON-LD media, the largest relevant image or a YouTube thumbnail.

## Tabs, sound and popups

- **Layout.** Focus shows the active tab; Mosaic tiles all tabs in a grid. Tabs have a white default background.
- **Sound.** Each tab's audio is "auto" (audible only when active), "on" or "off". The speaker button on a tab sets on/off; right-click returns it to auto.
- **Popups.** A `window.open` opens a new tab only if the user clicked or typed in that page in the last 2 s. Otherwise it is blocked and shown in the sidebar with an "Open in new tab" button.
- **Autoplay.** After load, media elements are started (muted if the browser refuses sound) and YouTube, Vimeo and Dailymotion embeds get `autoplay=1`.

## Permissions

| Permission | Behaviour |
| --- | --- |
| Fullscreen, clipboard write, pointer lock | Allowed |
| Camera/microphone, location, notifications, screen capture, clipboard read, MIDI | Asks with a dialog. "Remember for this site" stores the answer in `permissions.json` |
| Anything else | Denied |

File → Reset Site Permissions clears stored answers.

## Site rules

`rules.js` holds the defaults and the logic; `main.js` loads `rules.json` at startup, watches it, and reloads 300 ms after a save. A file that does not parse keeps the previous rules and is reported in the sidebar; invalid fields are dropped with a message.

Each tab stores its resolved rule (`tab.rule`), recomputed on every navigation:

| Setting | Applied in |
| --- | --- |
| `autoplay` | `tryAutoplay()` after load ("on", "muted"); `blockAutoplay()` at DOM ready and after load ("off": pauses media until the user has interacted) |
| `sound` | Tab's default audio mode, unless the user set it with the speaker button |
| `popups` | `setWindowOpenHandler` |
| `suggest` | `pageKeywords()` returns `disabled`; the sidebar shows a message and does not search with page words |
| `mosaic` | `applyLayout()` leaves the tab out of the grid unless active |
| `extract.include` / `extract.skip` | Passed into the extraction script; include text is scored with weight 3 (`focus` field), skip selectors are added to the ignored areas. Invalid selectors are dropped |

## Research sessions

`research.js` keeps one current session and saves each as `sessions/<id>.json` (plus `current.txt`). The renderer records a page in the trail each time Scout actually searches for it (not on every 5-second check), with its top 5 keywords. Start pages and search-results pages are skipped. Pins are saved with the session after it has loaded at startup. "Recurring keywords" are keywords that appear on more than one page in the session. Export writes Markdown to `library/saves/` and adds it to the Library index.

## Find, zoom and history

- **Find:** `find:start` calls `webContents.findInPage`; the `found-in-page` result is sent to the find bar as "n/total". Switching tabs with the bar open clears the old tab and searches the new one.
- **Zoom:** half-step zoom levels from -5 to +5 per tab; Ctrl+scroll and pinch arrive as `zoom-changed`. The badge shows the percentage when it is not 100%.
- **History:** every main-frame navigation is recorded in `history.json` (up to 3,000 URLs, with title, visit count and last visit), saved 1.5 s after changes. Address-bar suggestions use a `<datalist>`, ranked by URL prefix, URL or title match, visits and recency.

## Settings and stored data

All in Electron's `userData` folder:

| File | Contents |
| --- | --- |
| `settings.json` | Search sources: on/off, Wikipedia language, Brave key, SearXNG URL. The Brave key is encrypted with the system keychain (`safeStorage`) when available, otherwise stored as plain text (the Sources panel says which). |
| `permissions.json` | Remembered permission answers per site |
| `rules.json` | Site rules (created with examples on first run) |
| `history.json` | Visited pages |
| `sessions/` | Research sessions, one JSON file each, and `current.txt` |
| `library/` | `screenshots/`, `saves/`, `media/` and `index.json` |

The renderer stores hidden keywords and the Auto setting in local storage.

## IPC channels

| Group | Channels |
| --- | --- |
| Tabs | `tab:create`, `tab:close`, `tab:activate`, `tab:navigate`, `tab:back`, `tab:forward`, `tab:reload`, `tab:audio`, `tab:audio-reset`, `tab:clicked`, `tab:hotkey` |
| Layout | `layout:set`, `layout:sidebar`, `layout:library` |
| Find, zoom, history | `find:start`, `find:stop`, `tab:zoom`, `history:search`, `history:clear`, `history:remove` |
| Site rules | `rules:edit`, `rules:reload` |
| Research session | `research:get`, `research:list`, `research:new`, `research:switch`, `research:rename`, `research:pins`, `research:visit`, `research:opened`, `research:dismiss`, `research:undismiss`, `research:export` |
| Keywords and search | `page:extract`, `page:keywords`, `suggest:search` (legacy, used by Tauri), `suggest:for`, `suggest:preview` |
| Sources | `settings:get`, `settings:set`, `search:status`, `search:test` |
| Library | `library:root`, `library:list`, `library:remove`, `library:open-folder`, `library:reveal`, `library:shot`, `library:save`, `library:grab` |

## Known limits

- Streamed video (YouTube and most video sites) cannot be saved with Media; it uses blob URLs or playlists.
- DuckDuckGo results come from parsing its HTML page, so a layout change on their side will break it.
- Full web results can take about 6 s when they come from DuckDuckGo (requests are spaced 2.5 s apart); Wikipedia results show first.
- `autoplay: "off"` pauses media after the page starts it, so a short burst of sound is possible on some sites.
- Address-bar suggestions use the system's native list, so their look depends on the OS.
