# Scout Browser: Change Log

Newest first. Commit hashes refer to the git history inside the delivered zip files.

| Date | Commit | Change |
| --- | --- | --- |
| 2026-10-10 | 5bcb0c0 | **Phase 2 done (B14, B15).** New `providers.js` with Wikipedia, Brave Search API, SearXNG and DuckDuckGo, and a registry that pauses failing sources and falls back to the next one. Sources panel in the sidebar with on/off, settings fields and a Test button. API keys encrypted with the system keychain when available. Previews load only for cards in view, 3 at a time. Fixed: a search requested while another was running was dropped. README section on search sources. Added `npm run test:providers`. Delivered as `scout-5.zip`. |
| 2026-10-10 | 832a81a | Added `npm run test:keywords` (sample pages through the keyword pipeline). |
| 2026-10-10 | 9b41213 | Fixed the extraction script (a line break broke it, so no keywords came back). Long names joined by "of" are split ("Chad Robertson of Tartine Bakery" becomes two names); names no longer join across "and". Tabs default to a white background. Notice buttons no longer wrap mid-word. README rewritten for the new behaviour. |
| 2026-10-10 | 467e49b | **Phase 1 done (B07-B11), plus B12 and B13.** New `keywords.js`: reads title, description, headings, selection and visible text; scores by field, specificity and session rarity; keeps multi-word names; builds 2-3 short queries. Pinned and hidden keywords in the sidebar. Auto toggle. Searches only on page change, new selection or keyword drift (20 s minimum). Network layer with 30-minute cache, shared in-flight requests, per-host spacing, 4 parallel requests and timeouts. |
| 2026-10-10 | 946b349 | **Phase 0 done (B01-B06).** Permission prompts for camera, mic, location, notifications and similar, remembered per site. App menu with Cmd/Ctrl shortcuts; S in a page takes a screenshot unless you are typing. Only the active tab plays sound, with a per-tab speaker button. Popups need a recent click; blocked ones listed in the sidebar. Media download picks the right extension and explains stream URLs. Errors shown in the sidebar instead of alert boxes. Version labels aligned. Delivered as `scout-4.zip` (with Phase 1). |
| 2026-10-10 | 5145f10 | Scout 3 as received (built with Grok). |

## Testing notes

- All testing so far ran in Electron 32.3.3 under a virtual display, against local test pages (an article with navigation, footer, image, a link that opens a new tab, an automatic popup, and a page that asks for location and notifications).
- The test sandbox could not reach Wikipedia, DuckDuckGo or Brave, so their responses were stubbed. This checked request building, fallback and the UI, but not live result quality.
- Checked: keyword chips, queries, pins and hides, text selection searches, popup blocking and allowed popups, muted background tabs, S shortcut, permission prompts, DuckDuckGo blocking and fallback, Brave key rejection and success, lazy previews, and that a hidden keyword leaves the query.
