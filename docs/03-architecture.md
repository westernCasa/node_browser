# Scout Browser: Architecture

Last updated: 2026-10-10 (commit 5bcb0c0). Describes the Electron build.

## Files

| File | Lines | Role |
| --- | --- | --- |
| `main.js` | 1,278 | Main process: tabs, layout, sound, popups, permissions, menu, page extraction, network layer, settings, search, previews, library |
| `keywords.js` | 322 | Keyword pipeline: scoring, phrases, query builder. No Electron code, so it can be tested with plain Node |
| `providers.js` | 274 | Search sources (Wikipedia, Brave, SearXNG, DuckDuckGo) and the registry that picks between them |
| `preload.js` | 38 | Exposes `window.scout` to the toolbar UI over IPC |
| `view-preload.js` | 39 | Runs in every web page: reports clicks (tab focus, popup permission) and the S shortcut |
| `renderer/index.html`, `app.js`, `styles.css` | 99 / 852 / 398 | Toolbar, tabs, suggestions sidebar, Sources panel, Library |
| `renderer/tauri-bridge.js`, `src-tauri/` | | Tauri build. Does not compile yet (Phase 4) |
| `test/keywords-demo.js`, `test/providers-demo.js` | | Checks that run without the browser (`npm run test:keywords`, `npm run test:providers`) |

## How the pieces connect

1. The toolbar UI (`renderer/`) calls `window.scout.*`, defined in `preload.js`, which sends IPC messages to `main.js`.
2. `main.js` creates one `BrowserView` per tab. Each runs `view-preload.js` in a sandbox.
3. `main.js` sends events back to the UI on two channels: `tab:event` (tab list, page loaded, popup blocked) and `ui:command` (focus address bar, toggle Mosaic, screenshot done, error).

## Suggestion pipeline

| Step | Where | What happens |
| --- | --- | --- |
| 1. Trigger | `app.js` `crawlViewport()` | Runs when a page finishes loading, on the Crawl button, and every 5 s. The 5 s check only searches if the page changed, new text was selected (3 s minimum gap), or the top keywords drifted (less than 50% overlap) and 20 s have passed. Auto can be turned off. |
| 2. Extract | `main.js` `extractPage()` | Script injected into the page. Returns title, meta description, h1-h3 headings, selected text, visible readable text (up to 6,000 characters; nav, footer, aside, menus and cookie banners skipped), and media alt text and file names. |
| 3. Rank | `keywords.js` `rankTerms()` | Scores each word by where it appears (selection 6, title 4, headings 3, description 2, names 2, text 1, media 0.6), with diminishing returns for repeats. Removes stop words, web boilerplate and the site's own name. Merges plurals. Lowers very common English words. Multiplies by session rarity (`SessionDF`: words seen on most of the last 60 pages lose weight). Finds multi-word names ("Marie Curie") and lets them replace their single words. Returns the top 12. |
| 4. Pins and hides | `app.js` | Pinned keywords (user-chosen) always go into searches and are never replaced. Hidden keywords are removed and remembered in local storage. |
| 5. Build queries | `keywords.js` `buildQueries()` | Up to 3 queries of at most 4 words: the strongest terms; the top term plus the next tier; the page's own title (dropped when something is pinned). Pins go into every query. |
| 6. Search | `main.js` `runQueries()` + `providers.js` | Wikipedia for every query; web search for the first two. Results are merged round-robin, duplicates and the current page removed, up to 12 kept. |
| 7. Show | `app.js` `renderResults()` | Cards show source and the query that found them. Previews load lazily (see below). |

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

## Settings and stored data

All in Electron's `userData` folder:

| File | Contents |
| --- | --- |
| `settings.json` | Search sources: on/off, Wikipedia language, Brave key, SearXNG URL. The Brave key is encrypted with the system keychain (`safeStorage`) when available, otherwise stored as plain text (the Sources panel says which). |
| `permissions.json` | Remembered permission answers per site |
| `library/` | `screenshots/`, `saves/`, `media/` and `index.json` |

The renderer stores hidden keywords and the Auto setting in local storage.

## IPC channels

| Group | Channels |
| --- | --- |
| Tabs | `tab:create`, `tab:close`, `tab:activate`, `tab:navigate`, `tab:back`, `tab:forward`, `tab:reload`, `tab:audio`, `tab:audio-reset`, `tab:clicked`, `tab:hotkey` |
| Layout | `layout:set`, `layout:sidebar`, `layout:library` |
| Keywords and search | `page:extract`, `page:keywords`, `suggest:search` (legacy, used by Tauri), `suggest:for`, `suggest:preview` |
| Sources | `settings:get`, `settings:set`, `search:status`, `search:test` |
| Library | `library:root`, `library:list`, `library:remove`, `library:open-folder`, `library:reveal`, `library:shot`, `library:save`, `library:grab` |

## Known limits

- Streamed video (YouTube and most video sites) cannot be saved with Media; it uses blob URLs or playlists.
- DuckDuckGo results come from parsing its HTML page, so a layout change on their side will break it.
- `BrowserView` is deprecated in Electron 30+; the move to `WebContentsView` is backlog item B18.
- A search can take about 6 s when it falls back to DuckDuckGo (B25).
