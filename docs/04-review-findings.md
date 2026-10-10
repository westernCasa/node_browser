# Scout Browser: Review Findings

Review of Scout 3 (the version built with Grok), done on 2026-10-09. The "Resolution" column shows what happened to each finding as of 2026-10-10.

## Summary at review time

- The Electron build ran and did roughly what the README described.
- The Tauri build could not compile because `src-tauri/tauri.conf.json` was missing, and about half its features were not connected.
- Every website was given camera and microphone access without asking.
- Keyword suggestions came mostly from image alt text and file names, not from the page text.
- The 5-second auto-crawl could send up to 14 requests per cycle with no cache, which would get it blocked by DuckDuckGo.

## Critical findings

| ID | Issue | Where (original code) | Effect | Resolution |
| --- | --- | --- | --- | --- |
| C1 | Camera and microphone granted to every site with no prompt | `main.js:695` | Any page could record audio and video silently | Fixed in Phase 0 (B01) |
| C2 | Tauri build has no `tauri.conf.json` | `src-tauri/` | `npx tauri dev` fails | Superseded: mobile moves to React Native (`06-mobile-plan.md`); Tauri code to be removed (M15) |
| C3 | Tauri commands use blocking HTTP on the main thread | `lib.rs` | Window freezes during every crawl | Superseded (React Native plan) |
| C4 | Tauri layout commands take `_mode` and `_w` | `lib.rs:245`, `lib.rs:250` | Arguments do not match the JS call | Superseded (React Native plan) |
| C5 | S shortcut only listened on the toolbar | `app.js:411` | Did nothing while a web page had focus | Fixed in Phase 0 (B02) |
| C6 | Auto-crawl had no cache or rate limit | `app.js:264`, `main.js:430`, `main.js:606` | Up to 2 searches + 12 page fetches every 5 s | Fixed in Phases 1 and 2 (B11-B14) |

## Keyword engine findings

| ID | Issue | Resolution |
| --- | --- | --- |
| K1 | `keywordize()` (title, description, headings, selection) was never called | Replaced by `keywords.js` (B07) |
| K2 | Extraction read only media alt text, captions, file names and capitalized phrases | Now reads title, description, headings, selection and visible text (B07) |
| K3 | The page title was ignored | Title is weighted 4x (B07) |
| K4 | Up to 8 keywords sent as one query | 2-3 queries of at most 4 words (B09) |
| K5 | Names and their single words both kept | Phrases replace their member words (B08) |
| K6 | User keyword edits overwritten every 5 s; removing a chip did not re-search | Pins and hides, re-search on change (B10) |
| K7 | DuckDuckGo results parsed with regex over HTML | Kept only as the fallback source; Brave and SearXNG added (B15) |

## Smaller findings

| Issue | Resolution |
| --- | --- |
| `BrowserView` deprecated since Electron 30 | Fixed: tabs use `WebContentsView` (B18) |
| All tabs played sound at once | Fixed: only the active tab is audible (B03) |
| Every `window.open` became a new tab, including ad popups | Fixed: popups need a recent user click (B04) |
| Media download always saved video as `.mp4`; stream URLs failed silently | Fixed: extension from content-type, clear messages (B05) |
| No history, find-in-page, zoom or tab shortcuts | Fixed: shortcuts (B02); history, find and zoom (B19) |
| Tauri bridge missing Library, Shot, Save, Media | Superseded; mobile Library is M05 |
| Tauri tabs open as separate OS windows, so no Mosaic | Superseded; mobile uses one WebView per tab and Mosaic on tablets |
| Version labels disagreed (scout2 0.3.0, Cargo 0.2.0, "Scout 3") | Fixed: all 0.3.0, named Scout (B06) |
| `styles.css` loaded twice; README path wrong | Fixed (B06) |

## Bugs found during the fixes

| Bug | Found | Fix |
| --- | --- | --- |
| Page extraction returned nothing: a line break inside the injected script broke a string | Testing Phase 1 | Fixed in commit 9b41213 |
| Pages without their own background showed black text on a near-black background (`#111111`) | Testing Phase 1 | Tabs default to white (9b41213) |
| A search requested while another was running was dropped, so a hidden keyword could stay in the query | Testing Phase 2 | Queued and run when the current search ends (5bcb0c0) |
| Results from a page already left arrived late and replaced the current page's results and status | Testing Phase 3 (site rules) | Results for a page you have left are dropped (8a2a2d0) |
| Find in page showed no count for the first search (Electron's `findNext` flag means "start a new search") | Testing Phase 3 | Flag inverted (aadbce0) |
| Elements with the `hidden` attribute still showed when their CSS set `display` (the find bar stayed after Esc) | Testing Phase 3 | Global `[hidden]` rule (aadbce0) |
| Start page and search-results pages counted as "pages read" in the trail | Testing Phase 3 | Skipped (6873d07) |
