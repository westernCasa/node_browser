# Scout Browser: Overview and Status

Last updated: 2026-10-10

## What Scout is

Scout is a desktop web browser for niche research. While you browse, it reads the page you are looking at, picks out keywords, and suggests the next pages to visit in a sidebar. It keeps a trail of what you read in a research session, lets several videos play at once in a tiled view (Mosaic), and saves screenshots, page notes and media into a local library.

The long-term goal is a "shell for behaviours": the browser's actions (what to read from a page, what to autoplay, where to search) are modules that can be switched on, off or replaced per site. Phase 3 delivered the first version of this: per-site rules in a JSON file.

## Current status

| Area | Status |
| --- | --- |
| Electron desktop build | Working. Phases 0 to 3 of the roadmap are done, except B20 (AI query expansion). |
| Tauri build (desktop and mobile) | Does not compile. Phase 4. |
| Backlog | 25 items, 20 done. Open: B20, B21-B24. |
| Testing | 5 end-to-end test scripts (57 checks) in `test/e2e`, run in Electron 32.3.3 with search sources stubbed. Live search results still need a check on a real machine. |

## Where things are

| Item | Location |
| --- | --- |
| Code | `scout-6.zip` (latest), sent in the Claude chat. Includes git history. |
| Review doc with diagrams and editable backlog | https://claude.ai/code/artifact/b6ec4995-3117-41d0-a3c4-948c16e699fc |
| Roadmap and backlog | `scout/02-roadmap-backlog.md` in this project |
| How the code works | `scout/03-architecture.md` |
| Original review findings and what happened to each | `scout/04-review-findings.md` |
| Change log and testing notes | `scout/05-changelog.md` |

## How to run

Requires Node 18 or newer.

```bash
cd scout          # the folder that holds package.json
npm install
npx electron .
```

On macOS, if Gatekeeper blocks the first launch:

```bash
xattr -cr node_modules/electron
npx electron .
```

Quick checks that run without opening the browser:

```bash
npm run test:keywords    # keywords and queries picked for two sample pages
npm run test:providers   # search-source fallback order with fake responses
npm run test:rules       # which site rules apply to sample URLs
```

The end-to-end tests are described in `test/e2e/README.md`.

## Main features

- **Tabs and Mosaic.** Each tab is a real Chromium page. Mosaic tiles all tabs so several can play at once. Only the active tab is audible; others play muted unless you unmute them.
- **Suggestions sidebar.** Keywords come from the visible page. Click a keyword to pin it, × to hide it, or select text on a page to search for it. Wikipedia results appear within about a second; web results are merged in when they arrive.
- **Research sessions (Trail).** Pages read with their top keywords, keywords that recur across pages, results opened or hidden. Pins are saved per session. Sessions can be renamed, switched, and exported as Markdown notes.
- **Search sources (Settings).** Wikipedia for every search, plus web results from the first working source: Brave Search API, SearXNG, then DuckDuckGo.
- **Site rules (Settings, or File → Edit Site Rules).** Per-site autoplay, sound, popups, Mosaic, whether the page is read for keywords, and which parts of the page to read or skip.
- **Find, zoom and history.** Find in page, per-tab zoom, address-bar suggestions from history, and a History shelf in the Library.
- **Library.** Shot (or press S), Save (JSON note) and Media (downloads the main image or video) store files in a local folder.
- **Safety.** Camera, microphone, location, notifications and similar permissions always ask first. Popups open only right after a user click. Sign-in, banking and payment pages are never read for suggestions (default rule).

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Cmd/Ctrl+T | New tab |
| Cmd/Ctrl+W | Close tab |
| Cmd/Ctrl+L | Focus the address bar |
| Cmd/Ctrl+R | Reload |
| Cmd/Ctrl+[ and ] | Back, forward |
| Cmd/Ctrl+F, Cmd/Ctrl+G, Shift+Cmd/Ctrl+G | Find in page, next, previous |
| Cmd/Ctrl+=, Cmd/Ctrl+-, Cmd/Ctrl+0 | Zoom in, out, reset |
| Cmd/Ctrl+Y | History |
| Cmd/Ctrl+Shift+M | Mosaic on or off |
| Cmd/Ctrl+Shift+U | Mute or unmute the tab |
| Cmd/Ctrl+Shift+S, or S on a page | Screenshot the tab |

## Decision needed

B20 (AI query expansion) needs a choice of AI provider and an API key. Phase 4 (Tauri and mobile) starts with a go or no-go decision on mobile.
