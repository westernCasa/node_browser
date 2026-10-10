# Scout Browser: Change Log

Newest first. Commit hashes refer to the git history inside the delivered zip files.

| Date | Commit | Change |
| --- | --- | --- |
| 2026-10-10 | 4bab266 | End-to-end tests added to the repo (`test/e2e`, 5 scripts). Sidebar no longer scrolls sideways on long titles. README covers sessions and site rules. Delivered as `scout-6.zip`. |
| 2026-10-10 | 6873d07 | **B17 research sessions.** Trail panel: pages read with top keywords, recurring keywords, counts. Pins saved per session and restored after restart. Results can be hidden (×) for the session; opened or read results are dimmed and marked "read". Rename, switch, new session, export to Markdown in the Library. Start and search pages are not counted. |
| 2026-10-10 | aadbce0 | **B19 find, zoom, history.** Find bar (Cmd/Ctrl+F, Enter or Cmd/Ctrl+G for next, Shift for previous, Esc to close) with match count. Zoom shortcuts, pinch and Ctrl+scroll, with a badge that resets on click. History of visited pages with address-bar suggestions and a searchable History shelf (Cmd/Ctrl+Y). Fixed the find count and hidden elements showing. |
| 2026-10-10 | 8a2a2d0 | **B25 and B16.** Wikipedia results show within about a second while web results load, then merge in without reloading existing cards. Per-site rules in `rules.json` (autoplay on/muted/off, sound, popups, suggestions on/off, Mosaic, extract include/skip), with examples created on first run, live reload, and error reporting. Rule shown under the status line. Sidebar "Sources" button renamed "Settings". Fixed: late results from a page already left. |
| 2026-10-10 | 2b4d32b | **B18.** Tabs moved from the deprecated `BrowserView` to `WebContentsView`. |
| 2026-10-10 | d70147b | Project docs added (`docs/`). |
| 2026-10-10 | 5bcb0c0 | **Phase 2 done (B14, B15).** New `providers.js` with Wikipedia, Brave Search API, SearXNG and DuckDuckGo, and a registry that pauses failing sources and falls back to the next one. Sources panel in the sidebar with on/off, settings fields and a Test button. API keys encrypted with the system keychain when available. Previews load only for cards in view, 3 at a time. Fixed: a search requested while another was running was dropped. README section on search sources. Added `npm run test:providers`. Delivered as `scout-5.zip`. |
| 2026-10-10 | 832a81a | Added `npm run test:keywords` (sample pages through the keyword pipeline). |
| 2026-10-10 | 9b41213 | Fixed the extraction script (a line break broke it, so no keywords came back). Long names joined by "of" are split ("Chad Robertson of Tartine Bakery" becomes two names); names no longer join across "and". Tabs default to a white background. Notice buttons no longer wrap mid-word. README rewritten for the new behaviour. |
| 2026-10-10 | 467e49b | **Phase 1 done (B07-B11), plus B12 and B13.** New `keywords.js`: reads title, description, headings, selection and visible text; scores by field, specificity and session rarity; keeps multi-word names; builds 2-3 short queries. Pinned and hidden keywords in the sidebar. Auto toggle. Searches only on page change, new selection or keyword drift (20 s minimum). Network layer with 30-minute cache, shared in-flight requests, per-host spacing, 4 parallel requests and timeouts. |
| 2026-10-10 | 946b349 | **Phase 0 done (B01-B06).** Permission prompts for camera, mic, location, notifications and similar, remembered per site. App menu with Cmd/Ctrl shortcuts; S in a page takes a screenshot unless you are typing. Only the active tab plays sound, with a per-tab speaker button. Popups need a recent click; blocked ones listed in the sidebar. Media download picks the right extension and explains stream URLs. Errors shown in the sidebar instead of alert boxes. Version labels aligned. Delivered as `scout-4.zip` (with Phase 1). |
| 2026-10-10 | 5145f10 | Scout 3 as received (built with Grok). |

## Testing notes

- All testing so far ran in Electron 32.3.3 under a virtual display, against local test pages (an article with navigation, footer, image, a link that opens a new tab, an automatic popup, and a page that asks for location and notifications).
- The test sandbox could not reach Wikipedia, DuckDuckGo or Brave, so their responses were stubbed. This checked request building, fallback and the UI, but not live result quality.
- Checked: keyword chips, queries, pins and hides, text selection searches, popup blocking and allowed popups, muted background tabs, S shortcut, permission prompts, DuckDuckGo blocking and fallback, Brave key rejection and success, lazy previews, a hidden keyword leaving the query, Wikipedia-first timing (about 1.3 s with a 3 s web source), site rules (extract skip/include, popups block, autoplay off, suggestions off, live reload, broken file), find, zoom, history, research trail, dismiss, read badges, export, and pins after restart.
- The tests are in the repo under `test/e2e`; see its README to rerun them.
