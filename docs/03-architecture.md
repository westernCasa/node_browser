# Scout Browser: Architecture

Last updated: 2026-10-10 (commit 025fb03, shared core and mobile groundwork). Describes the Electron build and the shared `core/`; the mobile app is covered in `06-mobile-plan.md` and `mobile/README.md`.

## Files

| File | Lines | Role |
| --- | --- | --- |
| `main.js` | 1,011 | Desktop main process: tabs, layout, sound, popups, permissions, menu, settings and keys, site-rule loading, IPC, library. Uses `core/` for everything platform-neutral |
| `fs-storage.js` | 20 | Desktop storage for `core/` (one file per name in a folder) |
| `preload.js` | 58 | Exposes `window.scout` to the toolbar UI over IPC |
| `view-preload.js` | 39 | Runs in every web page: reports clicks (tab focus, popup permission) and the S shortcut |
| `renderer/index.html`, `app.js`, `styles.css` | | Toolbar, find bar, tabs, sidebar (Suggestions, Trail, Settings), Library and History shelf |
| `core/` | 2,131 | Shared logic, no platform imports (table below and `core/README.md`) |
| `mobile/` | | Mobile app (React Native, Expo) walking skeleton; see `mobile/README.md` |
| `renderer/tauri-bridge.js`, `src-tauri/` | | Old Tauri build. Does not compile; to be removed (M15) |
| `test/*-demo.js` | | Checks without the browser: `npm run test:keywords`, `test:providers`, `test:rules`, `test:ai`, `test:controller` |
| `test/e2e/` | | Desktop end-to-end tests (Playwright driving Electron) with local test pages; see its README |

### core/

| File | Lines | Role |
| --- | --- | --- |
| `keywords.js` | 325 | Keyword ranking, names, query builder, overlap |
| `providers.js` | 274 | Search sources and the fallback registry |
| `net.js` | 96 | Cached, throttled, time-limited GET (`createNet`) |
| `suggest.js` | 142 | Search flow: keyword and AI queries, two passes, merged results (`createSuggest`) |
| `ai.js` | 175 | AI query ideas (local model or Grok) |
| `rules.js` | 155 | Site rules |
| `research.js` | 174 | Research sessions (takes a storage object) |
| `history.js` | 83 | Visit history and suggestions (`HistoryStore`, takes a storage object) |
| `preview.js` | 215 | Result-card previews (`createPreview`) |
| `playback.js` | 58 | `PlaybackLimiter`: which tab to pause when more than 4 play, which to resume |
| `page-scripts.js` | 293 | Scripts injected into pages: extraction, autoplay, autoplay blocking |
| `controller.js` | 194 | Suggestion controller: when to search again, pins, hides, results (used by mobile; desktop sidebar still has its own copy, M13) |
| `storage.js` | 30 | `memoryStorage`, `prefixedStorage` |
| `urls.js` | 22 | `normalizeUrl` (address bar; searches go to Brave Search), `hostOf`, `HOME_URL`, `SEARCH_URL` |
| `compat.js` | 16 | `timeoutSignal` for engines without `AbortSignal.timeout` |
| `index.js` | 19 | Re-exports everything |

## How the pieces connect

1. The toolbar UI (`renderer/`) calls `window.scout.*`, defined in `preload.js`, which sends IPC messages to `main.js`. `main.js` builds the shared services from `core/` at startup: `createNet` (with Electron `fetch`), the source `Registry`, `createSuggest`, `createPreview`, `ResearchStore` and `HistoryStore` (with `fs-storage.js`).
2. `main.js` creates one `WebContentsView` per tab. Each runs `view-preload.js` in a sandbox.
3. `main.js` sends events back to the UI on two channels: `tab:event` (tab list, page loaded, popup blocked) and `ui:command` (focus address bar, toggle Mosaic, screenshot done, error).

## Suggestion pipeline

| Step | Where | What happens |
| --- | --- | --- |
| 1. Trigger | `app.js` `crawlViewport()` | Runs when a page finishes loading, on the Crawl button, and every 5 s. The 5 s check reads the page only if it was scrolled, resized or had text selected since the last read (`view-preload.js` reports this at most once a second as `tab:activity`), or the active tab changed. It then searches only if the page changed, new text was selected (3 s minimum gap), or the top keywords drifted (less than 50% overlap) and 20 s have passed. Auto can be turned off. |
| 2. Extract | `main.js` `extractPage()` running `core/page-scripts.js` `extractionScript()` | Script injected into the page. Returns title, meta description, h1-h3 headings, selected text, visible readable text (up to 6,000 characters; nav, footer, aside, menus and cookie banners skipped), and media alt text and file names. On long pages it measures only the elements near the viewport (binary search on document order), about 15 ms on a 12,000-element article instead of about 60 ms. |
| 3. Rank | `keywords.js` `rankTerms()` | Scores each word by where it appears (selection 6, title 4, headings 3, description 2, names 2, text 1, media 0.6), with diminishing returns for repeats. Removes stop words, web boilerplate and the site's own name. Merges plurals. Lowers very common English words. Multiplies by session rarity (`SessionDF`: words seen on most of the last 60 pages lose weight). Finds multi-word names ("Marie Curie") and lets them replace their single words. Returns the top 12. |
| 4. Pins and hides | `app.js` | Pinned keywords (user-chosen) always go into searches and are never replaced. Hidden keywords are removed and remembered in local storage. |
| 5. Build queries | `keywords.js` `buildQueries()` | Up to 3 queries of at most 4 words: the strongest terms; the top term plus the next tier; the page's own title (dropped when something is pinned). Pins go into every query. |
| 6. Search | `core/suggest.js` `runQueries()` + `core/providers.js` | Two calls. First `part: "reference"`: Wikipedia only, returned at once, while web requests start in the background. Then `part: "all"`: Wikipedia (from cache) plus web results for the first two queries, merged round-robin, duplicates and the current page removed, up to 12 kept. |
| 7. Show | `app.js` `crawl()`, `renderResults()` | Wikipedia results show first; the full list replaces them, keeping cards already on screen. Results hidden in this session are filtered out. Results for a page the user has already left are dropped. Cards show source and query, a "read" badge if opened or read in this session, and a × to hide. |

## AI query ideas

`core/ai.js` calls any OpenAI-compatible chat API (`POST <base>/chat/completions`, `GET <base>/models`):

| Option | Base address | Auth | Default model |
| --- | --- | --- | --- |
| Local model | `http://localhost:11434/v1` (Ollama) or `http://localhost:1234/v1` (LM Studio), editable | None | `llama3.2` |
| Grok | `https://api.x.ai/v1` | `Authorization: Bearer <key>` | `grok-4.3` (Test lists the names the key can use) |

- **Input:** pinned keywords, up to 8 page keywords, the page title. Never page text or addresses. Pages with `suggest: false` are never searched, so never sent.
- **Prompt:** asks for 2-3 queries of 2-6 words on other angles (background, related people or organisations, primary sources, opposing views), JSON only.
- **Parsing:** accepts plain JSON, JSON inside prose or a code block, or a numbered or bulleted list. Drops quotes, `site:` and similar operators, sentences and duplicates. Adds any pinned keyword the model left out.
- **Flow:** the fast "reference" search pass starts the AI call without waiting; the full pass waits for it (timeout 25 s local, 12 s Grok), then searches the first keyword query plus up to 2 AI queries. If the AI is off, fails or times out, the normal keyword queries are used and the status line says why.
- **Caching:** 30 minutes per distinct input; identical calls in flight are shared. Changing AI settings clears the cache.
- **Test button:** saves, lists the server's models, reports a model name that is not on the server, then runs one sample request.

## Search sources

`core/providers.js` defines each source with an id, label, role, settings fields and a `search(query, ctx)` function. The `Registry` class tracks each source's health.

| Source | Role | Setup | Failure handling |
| --- | --- | --- | --- |
| Wikipedia | Reference: runs for every query | Optional language code | Errors return no Wikipedia results for that query |
| Brave Search API | Web, tried first | API key | 401/403: paused 30 min. 429: paused 5 min |
| SearXNG | Web, tried second | Instance URL with JSON output enabled | 403: paused 30 min with instructions to enable JSON |
| DuckDuckGo | Web, fallback | None | 202/403 or challenge page: paused 10 min |

For each query the registry uses the first web source that is enabled, configured, not paused, and returns results. The Test button runs one search and ignores a pause. Changing a source's settings clears its pause. The status line warns only when no web source is available.

## Network layer

All outbound requests go through `getText()` from `core/net.js`:

- Cached for 30 minutes, up to 500 entries. Only successful responses are cached.
- Identical requests that are already running are shared.
- At most 4 requests run at once.
- Minimum gap between requests to the same host: DuckDuckGo 2.5 s, Brave 1.1 s, others 0.4 s.
- Every request times out (10 s by default, 8 s for previews).

## Previews

Result cards that already have an image (often Wikipedia and Brave) show it directly. Other cards fetch a preview only when they scroll into view, at most 3 at a time. A new result list cancels previews still waiting. The preview fetch reads the page's Open Graph image, JSON-LD media, the largest relevant image or a YouTube thumbnail.

## Tabs, sound and popups

- **Layout.** Focus shows the active tab; Mosaic tiles all tabs in a grid. Tabs have a white default background. Tabs not on screen are removed from the window (`removeChildView`) and added back when shown; this is what makes Chromium stop drawing them (`setVisible(false)` and 0x0 bounds did not). Background throttling is on (Electron default), so hidden tabs' timers slow down; media keeps playing.
- **Sound.** Each tab's audio is "auto" (audible only when active), "on" or "off". The speaker button on a tab sets on/off; right-click returns it to auto.
- **Playback limit (`core/playback.js`).** Media may play in up to 4 tabs at once. `main.js` reports `media-started-playing` and `media-paused` per tab to a `PlaybackLimiter`; when a fifth tab starts, the limiter returns the tab that started playing longest ago (never the active tab or the one starting), and `pauseForLimitScript()` pauses its media in every frame (embedded players included) and marks it. The tab shows ⏸ in the tab bar. Activating it runs `resumeScript()`, which plays the marked media again (and may pause the next oldest tab). A tab counts as stopped only when no media in any frame is playing. Mobile uses the same limiter with play and pause reports from the page bridge (main frame only).
- **Sound from all tabs.** `soundAll` in `main.js` (toolbar button, View menu, Cmd/Ctrl+Shift+A, IPC `audio:all`, remembered by the renderer in local storage): every tab with sound "auto" is unmuted, not only the active one. Per-tab speaker overrides and the site rule `sound` still win. Desktop only for now.
- **Center on click (`centerOnClickScript()`).** A capture-phase click listener in the page finds the clicked media: the element in the click path, or (for overlays drawn above a player) the media under the pointer via `elementsFromPoint`. Media is video, audio, img, picture, canvas, embed, object, and iframes that are video or audio players (known hosts, or `allow` autoplay/fullscreen). Elements under 120x80 px (except audio) and media already within 40 px of the middle are left alone; otherwise `scrollIntoView({ behavior: "smooth", block: "center" })`. Clicks inside an iframe never reach the page, so a `blur` listener checks whether focus moved into a player iframe.
- **Closing tabs.** A closed tab's page is first replaced with `about:blank` and then closed; closing a page while a video played crashed Electron 32 (SIGSEGV, seen on Linux, also in versions before this change). Events from a closing tab are ignored.
- **Popups.** A `window.open` opens a new tab only if the user clicked or typed in that page in the last 2 s. Otherwise it is blocked and shown in the sidebar with an "Open in new tab" button.
- **Autoplay.** At DOM ready, after load, and after in-page navigation, `autoplayScript()` plays the page's main media: the largest visible video or YouTube, Vimeo or Dailymotion embed (embeds get `autoplay=1`), or else the first audio element. It runs once per page address, so media the user pauses stays paused. If there is no player yet, a MutationObserver checks again (at most every 250 ms) for 20 s. Sound is on unless the page refuses it, then it plays muted.

## Gestures

- **Trackpad swipe (`view-preload.js`).** A passive capture `wheel` listener adds up horizontal movement (ignored when `ctrlKey` is set, which is a pinch, or when the movement is mostly vertical). If the element under the pointer, or one of its parents, can still scroll sideways in that direction, the swipe is left to the page. An arrow drawn in a closed shadow root at the page edge shows progress. When wheel events stop for 160 ms (fingers lifted and momentum over) and the total passed 220 px, the preload sends `tab:gesture` ("back" when the fingers moved right, negative deltaX). One navigation per swipe.
- **Mouse side buttons.** `mouseup` with button 3 or 4 in the page (macOS and Linux); `app-command` `browser-backward` / `browser-forward` on the window (Windows).
- **Three-finger swipe.** The window's `swipe` event (macOS, when the system setting uses three fingers).
- **Tab bar (`renderer/app.js`).** `auxclick` with the middle button closes a tab; `dblclick` on the empty bar opens one; HTML drag and drop reorders tabs and sends the new order (`tab:order`), which rebuilds the `tabs` map, so Mosaic follows the same order.
- **Mobile (`mobile/App.js`, `SwipeRow.js`).** `PanResponder` on the address bar row (only for clearly sideways moves of 60 pt or more, not while typing) switches tabs; tab rows in the tab list close on a left swipe past 90 pt; long press on the tab count opens a tab; `BackHandler` sends the Android back button to the page. Edge swipes and pull to refresh come from the WebView (`allowsBackForwardNavigationGestures`, `pullToRefreshEnabled`, iOS).

## Permissions

| Permission | Behaviour |
| --- | --- |
| Fullscreen, clipboard write, pointer lock | Allowed |
| Camera/microphone, location, notifications, screen capture, clipboard read, MIDI | Asks with a dialog. "Remember for this site" stores the answer in `permissions.json` |
| Anything else | Denied |

File → Reset Site Permissions clears stored answers.

## Site rules

`core/rules.js` holds the defaults and the logic; `main.js` loads `rules.json` at startup, watches it, and reloads 300 ms after a save. A file that does not parse keeps the previous rules and is reported in the sidebar; invalid fields are dropped with a message.

Each tab stores its resolved rule (`tab.rule`), recomputed on every navigation:

| Setting | Applied in |
| --- | --- |
| `autoplay` | `tryAutoplay()` at DOM ready, after load and after in-page navigation ("on", "muted"); for "off" it calls `blockAutoplay()` instead (pauses media until the user has interacted) |
| `sound` | Tab's default audio mode, unless the user set it with the speaker button |
| `popups` | `setWindowOpenHandler` |
| `suggest` | `pageKeywords()` returns `disabled`; the sidebar shows a message and does not search with page words |
| `mosaic` | `applyLayout()` leaves the tab out of the grid unless active |
| `center` | `centerOnClickScript()` injected at DOM ready unless `false` (mobile: after load) |
| `extract.include` / `extract.skip` | Passed into the extraction script; include text is scored with weight 3 (`focus` field), skip selectors are added to the ignored areas. Invalid selectors are dropped |

## Research sessions

`core/research.js` keeps one current session and saves each as `<id>.json` (plus `current.txt`) through a storage object; on desktop that is the `sessions/` folder. The renderer records a page in the trail each time Scout actually searches for it (not on every 5-second check), with its top 5 keywords. Start pages and search-results pages are skipped. Pins are saved with the session after it has loaded at startup. "Recurring keywords" are keywords that appear on more than one page in the session. Export writes Markdown to `library/saves/` and adds it to the Library index.

## Find, zoom and history

- **Find:** `find:start` calls `webContents.findInPage`; the `found-in-page` result is sent to the find bar as "n/total". Switching tabs with the bar open clears the old tab and searches the new one.
- **Zoom:** half-step zoom levels from -5 to +5 per tab; Ctrl+scroll and pinch arrive as `zoom-changed`. The badge shows the percentage when it is not 100%.
- **History:** every main-frame navigation is recorded in `history.json` (up to 3,000 URLs, with title, visit count and last visit), saved 1.5 s after changes. Address-bar suggestions use a `<datalist>`, ranked by URL prefix, URL or title match, visits and recency.

## Settings and stored data

All in Electron's `userData` folder:

| File | Contents |
| --- | --- |
| `settings.json` | Search sources: on/off, Wikipedia language, Brave key, SearXNG URL. AI: on/off, local or Grok, local address and model, Grok model and key. The Brave and Grok keys are encrypted with the system keychain (`safeStorage`) when available, otherwise stored as plain text (the Sources panel says which). |
| `permissions.json` | Remembered permission answers per site |
| `rules.json` | Site rules (created with examples on first run) |
| `history.json` | Visited pages |
| `sessions/` | Research sessions, one JSON file each, and `current.txt` |
| `library/` | `screenshots/`, `saves/`, `media/` and `index.json` |

The renderer stores hidden keywords and the Auto setting in local storage.

## IPC channels

| Group | Channels |
| --- | --- |
| Tabs | `tab:create`, `tab:close`, `tab:activate`, `tab:navigate`, `tab:back`, `tab:forward`, `tab:reload`, `tab:audio`, `tab:audio-reset`, `tab:clicked`, `tab:hotkey`, `tab:activity`, `tab:gesture`, `tab:order`, `audio:all` |
| Layout | `layout:set`, `layout:sidebar`, `layout:library` |
| Find, zoom, history | `find:start`, `find:stop`, `tab:zoom`, `history:search`, `history:clear`, `history:remove` |
| Site rules | `rules:edit`, `rules:reload` |
| Research session | `research:get`, `research:list`, `research:new`, `research:switch`, `research:rename`, `research:pins`, `research:visit`, `research:opened`, `research:dismiss`, `research:undismiss`, `research:export` |
| Keywords and search | `page:extract`, `page:keywords`, `suggest:search` (legacy, used by Tauri), `suggest:for`, `suggest:preview` |
| Sources and AI | `settings:get`, `settings:set`, `search:status`, `search:test`, `ai:test` |
| Library | `library:root`, `library:list`, `library:remove`, `library:open-folder`, `library:reveal`, `library:shot`, `library:save`, `library:grab` |

## Known limits

- Streamed video (YouTube and most video sites) cannot be saved with Media; it uses blob URLs or playlists.
- DuckDuckGo results come from parsing its HTML page, so a layout change on their side will break it.
- Full web results can take about 6 s when they come from DuckDuckGo (requests are spaced 2.5 s apart); Wikipedia results show first.
- `autoplay: "off"` pauses media after the page starts it, so a short burst of sound is possible on some sites.
- Address-bar suggestions use the system's native list, so their look depends on the OS.
