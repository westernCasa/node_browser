# Scout Browser: Roadmap and Backlog

Last updated: 2026-10-10 (after B20; mobile on hold). The editable version (with status dropdowns) is in the review doc: https://claude.ai/code/artifact/b6ec4995-3117-41d0-a3c4-948c16e699fc

## Roadmap

Each phase ends at a gate that must pass before the next phase starts. No dates are set.

| Phase | Goal | Items | Gate (exit criteria) | Status |
| --- | --- | --- | --- | --- |
| 0. Safety and basics | No silent permissions, shortcuts work inside pages, one tab plays sound at a time | B01-B06 | Camera and mic prompt per site; S works on any page; popups need a click | Done |
| 1. Keyword engine | Keywords come from the page text, and the user's pins and hides stick | B07-B11 | Text-only articles give relevant keywords; a pinned word survives scrolling | Done |
| 2. Network layer | Cached, rate-limited search through swappable sources | B12-B15 | An hour of browsing with no search blocks; repeat pages load previews from cache | Done (gate still needs a live check) |
| 3. Behaviour shell | Per-site rules, research session, WebContentsView, history and find, AI query ideas | B16-B20, B25 | A new site behaviour can be added by editing a rules file, without code changes | Done. Gate passed in testing (rules edited live) |
| 4. Desktop release readiness | Installable, stable and easy to set up on macOS and Windows | B26-B31 | Scout is your daily research browser for a week with no blocking bugs | Next |
| 5. Tauri and mobile | Decide go or no-go on mobile, then port the shell to Rust | B21-B24 | To be set when Phase 5 starts | On hold until Phase 4 passes |

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
| B21 | 5 | Add tauri.conf.json, withGlobalTauri, icons (C2) | P2 | S | Not started |
| B22 | 5 | Make Rust commands async; fix argument names (C3, C4) | P2 | S | Not started |
| B23 | 5 | Port Library, Shot, Save, Media to Rust | P2 | M | Not started |
| B24 | 5 | Decide the mobile tab model | P2 | M | Not started |
| B25 | 3 | Show Wikipedia results first while web results load (web requests are spaced 2.5 s apart, so a search can take 6 s) | P1 | S | Done |
| B26 | 4 | Check on a real machine: live Wikipedia, DuckDuckGo, Brave, Grok and local model results, and an hour of browsing (Phase 2 gate) | P0 | S | Not started |
| B27 | 4 | Installable builds for macOS (.dmg) and Windows (.exe) with an app icon | P0 | M | Not started |
| B28 | 4 | Visual editor for site rules in Settings, so no JSON editing is needed | P1 | M | Not started |
| B29 | 4 | Sleep background tabs that are not playing media, to save memory with many tabs open | P1 | M | Not started |
| B30 | 4 | First-run setup: start page, search sources, AI option | P2 | S | Not started |
| B31 | 4 | Error log and a Copy diagnostics button for bug reports | P2 | S | Not started |

## Open checks

- Run Scout on a real machine and confirm live results from Wikipedia and DuckDuckGo.
- Add a Brave Search API key under Settings and confirm Brave results appear.
- Browse for an hour to check the Phase 2 gate (no search blocks).
- Turn on AI query ideas with Ollama or Grok, press Test, and check the "(AI)" queries give useful results.

These checks are backlog item B26.
