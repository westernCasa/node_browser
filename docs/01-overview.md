# Scout Browser: Overview and Status

Last updated: 2026-10-12

## What Scout is

Scout is a desktop web browser for niche research. While you browse, it reads the page you are looking at, picks out keywords, and suggests the next pages to visit in a sidebar. It keeps a trail of what you read in a research session, lets several videos play at once in a tiled view (Mosaic), and saves screenshots, page notes and media into a local library.

The long-term goal is a "shell for behaviours": the browser's actions (what to read from a page, what to autoplay, where to search) are modules that can be switched on, off or replaced per site. Phase 3 delivered the first version of this: per-site rules in a JSON file.

## Current status

| Area | Status |
| --- | --- |
| Electron desktop build | Working. Phases 0 to 3 of the roadmap are done. Next: Phase 4, desktop release readiness. |
| Mobile app (React Native, Expo) | Planned (`06-mobile-plan.md`). Groundwork done: shared `core/` and a walking-skeleton app in `mobile/` that compiles for iOS and Android. Not yet run on a phone (M01). Full build waits for the Phase 4 gate. |
| Old Tauri build | Does not compile. Replaced by the React Native plan; to be removed (M15). |
| Backlog | Desktop: 36 items, 26 done, open B26-B31 (Phase 4). B21-B24 (Tauri) replaced. Mobile: M01-M15 in `06-mobile-plan.md`. |
| Testing | 9 end-to-end test scripts (92 checks) in `test/e2e`, run in Electron 32.3.3 with search sources and AI servers stubbed. Live results still need a check on a real machine (B26). |

## Where things are

| Item | Location |
| --- | --- |
| Code | `scout-9.zip` (latest), sent in the Claude chat and copied to `~/Projects/scout` on the Mac. Includes git history. |
| Review doc with diagrams and editable backlog | https://claude.ai/code/artifact/b6ec4995-3117-41d0-a3c4-948c16e699fc |
| Roadmap and backlog | `scout/02-roadmap-backlog.md` in this project |
| How the code works | `scout/03-architecture.md` |
| Original review findings and what happened to each | `scout/04-review-findings.md` |
| Change log and testing notes | `scout/05-changelog.md` |
| Mobile plan, framework decision, mobile backlog | `scout/06-mobile-plan.md` |

## Repository layout

| Folder or file | What it is |
| --- | --- |
| `core/` | Logic shared by desktop and mobile: keywords, search sources, network, AI, site rules, sessions, history, page scripts, suggestion controller |
| `main.js`, `preload.js`, `view-preload.js`, `fs-storage.js` | Desktop app main process (Electron) |
| `renderer/` | Desktop toolbar, sidebar and Library UI |
| `mobile/` | Mobile app (React Native, Expo) walking skeleton |
| `test/` | Unit demos (`*-demo.js`) and desktop end-to-end tests (`e2e/`) |
| `docs/` | These documents (also in the Scout Browser project) |
| `src-tauri/`, `renderer/tauri-bridge.js` | Old Tauri build; does not compile; to be removed (M15) |

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
npm run test:ai          # AI query parsing and errors with fake servers
npm run test:controller  # the shared "when to search" logic used by the mobile app
```

The end-to-end tests are described in `test/e2e/README.md`.

## Main features

- **Tabs and Mosaic.** Each tab is a real Chromium page. Mosaic tiles all tabs so several can play at once. Only the active tab is audible; others play muted unless you unmute them.
- **Suggestions sidebar.** Keywords come from the visible page. Click a keyword to pin it, × to hide it, or select text on a page to search for it. Wikipedia results appear within about a second; web results are merged in when they arrive.
- **Research sessions (Trail).** Pages read with their top keywords, keywords that recur across pages, results opened or hidden. Pins are saved per session. Sessions can be renamed, switched, and exported as Markdown notes.
- **AI query ideas (Settings).** Optional. A local model (Ollama or LM Studio) or Grok suggests up to 2 extra queries from pinned keywords, page keywords and the title. Never sent: page text or addresses.
- **Search sources (Settings).** Wikipedia for every search, plus web results from the first working source: Brave Search API (the default; add your key), SearXNG, then DuckDuckGo. Searches typed in the address bar open Brave Search.
- **Autoplay.** The main video or audio on a page starts as soon as the page is parsed, with sound in the active tab. Media you pause stays paused. Up to 4 tabs play at once; a fifth pauses the oldest, which resumes when you open it.
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

## Decisions

| Date | Decision |
| --- | --- |
| 2026-10-10 | AI query ideas use a local model or Grok (xAI). |
| 2026-10-10 | Mobile (Tauri) is on hold until the desktop app passes Phase 4 (daily use for a week with no blocking bugs). |
| 2026-10-10 | While desktop testing waits: plan the mobile app and lay groundwork now; the full mobile build still waits for the Phase 4 gate. |
| 2026-10-12 | Media plays in up to 4 tabs at once (desktop and mobile). |
| 2026-10-12 | Mosaic is available on phones too (up to 4 tiles in portrait), not only tablets. |
| 2026-10-12 | Brave Search is the default web source and address-bar search engine. |
| 2026-10-12 | Autoplay plays only the page's main media, with sound, as soon as the page is parsed. |
| 2026-10-10 | Recommended framework for mobile: React Native (Expo) instead of Tauri, because it supports several web pages per screen and reuses Scout's JavaScript logic. Reversible; confirm after trying the skeleton (M01). |
