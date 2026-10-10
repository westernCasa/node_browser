# Scout Browser: Overview and Status

Last updated: 2026-10-10

## What Scout is

Scout is a desktop web browser for niche research. While you browse, it reads the page you are looking at, picks out keywords, and suggests the next pages to visit in a sidebar. It also lets several videos play at once in a tiled view (Mosaic) and saves screenshots, page notes and media into a local library.

The long-term goal is a "shell for behaviours": the browser's actions (what to read from a page, what to autoplay, where to search) become modules that can be switched on, off or replaced per site, instead of being hard-coded.

## Current status

| Area | Status |
| --- | --- |
| Electron desktop build | Working. Phases 0, 1 and 2 of the roadmap are done. |
| Tauri build (desktop and mobile) | Does not compile. Parked until Phase 4. |
| Backlog | 25 items, 15 done. Next: Phase 3 (behaviour shell). |
| Testing | Tested in Electron 32.3.3 on local test pages with search sources stubbed. Live search results still need a check on a real machine. |

## Where things are

| Item | Location |
| --- | --- |
| Code | `scout-5.zip` (latest), sent in the Claude chat. Includes git history. |
| Review doc with diagrams and editable backlog | https://claude.ai/code/artifact/b6ec4995-3117-41d0-a3c4-948c16e699fc |
| Roadmap and backlog | `02-roadmap-backlog.md` in this project |
| How the code works | `03-architecture.md` in this project |
| Original review findings and what happened to each | `04-review-findings.md` in this project |
| Change log | `05-changelog.md` in this project |

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
npm run test:keywords    # shows the keywords and queries picked for two sample pages
npm run test:providers   # shows the search-source fallback order with fake responses
```

## Main features

- **Tabs and Mosaic.** Each tab is a real Chromium page. Mosaic tiles all tabs so several can play at once. Only the active tab is audible; others play muted unless you unmute them.
- **Suggestions sidebar.** Keywords come from the visible page. Click a keyword to pin it, × to hide it, or select text on a page to search for it. Auto re-searches when the page or visible content changes (at most every 20 seconds).
- **Search sources.** Wikipedia for every search, plus web results from the first working source: Brave Search API, SearXNG, then DuckDuckGo.
- **Library.** Shot (or press S), Save (JSON note) and Media (downloads the main image or video) store files in a local folder.
- **Safety.** Camera, microphone, location, notifications and similar permissions always ask first. Popups open only right after a user click.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Cmd/Ctrl+T | New tab |
| Cmd/Ctrl+W | Close tab |
| Cmd/Ctrl+L | Focus the address bar |
| Cmd/Ctrl+R | Reload |
| Cmd/Ctrl+[ and ] | Back, forward |
| Cmd/Ctrl+Shift+M | Mosaic on or off |
| Cmd/Ctrl+Shift+U | Mute or unmute the tab |
| Cmd/Ctrl+Shift+S, or S on a page | Screenshot the tab |
