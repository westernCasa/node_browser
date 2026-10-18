# NODE Browser: Chromium Build

Last updated: 2026-10-18. Status: step N01 written and checked without a Mac; first Mac build to run. Code in `browser/` (see `browser/README.md`).

## Decision (2026-10-18)

Sven: build NODE on Chromium itself (option B in `08-engine-decision.md`), so Google sign-in works inside NODE. The Electron app stays the daily and release build until the Chromium build reaches parity; both share `core/`.

## Base

| Option | License | Fit | Verdict |
| --- | --- | --- | --- |
| ungoogled-chromium (macOS scripts) | BSD-3-Clause | Patch set and build scripts over stock Chromium; follows stable releases about every 4 weeks; no Google services to remove ourselves | **Chosen** |
| BrowserOS | AGPL-3.0 | Agent features similar to NODE's | Not used: AGPL would cover NODE's own code, which is MIT |
| Own Chromium fork from scratch | BSD-3-Clause | Full control | Not workable for one person |

Pinned to ungoogled-chromium-macos `152.0.7977.64-1.1` (`browser/base.env`): Chromium 152, the same as Electron 44, so pages behave the same in both builds.

## How NODE's features carry over

| Feature | In the Chromium build | Step |
| --- | --- | --- |
| Keywords, suggestions, search sources, Talk | Built-in extension side panel, same `core/` code | N01 (done in code), N02 for pins, hides, AI ideas |
| Autoplay with sound, 4-tab limit, center on click | Built-in extension content script and service worker; autoplay default patch | N01 |
| Google sign-in | Works: it is a real Chromium browser, not an embedded framework | N01 (to confirm on the Mac) |
| Bookmarks, history, find, zoom, PiP, downloads, print, passwords, extensions | Chromium's own | N01 |
| Trail, research sessions, Library, Ask AI, site rules, Settings | Extension side panel with `chrome.storage` | N02 |
| Only the active tab audible, Sound: all | Extension with `tabs.update({ muted })` | N02 |
| NODE start page, Brave as default search, icon, "Chromium" wording in menus | Extension new tab page, initial preferences, branding resources | N03 |
| MCP server, logged-out agent reader, research agent | Native helper inside the app bundle, talking to the extension over native messaging; reader in its own profile | N04 |
| Mosaic (4 live tiles) | C++ patch: Chromium's split view shows 2; extend it to a grid | N05 |
| Address-bar suggestions from NODE (bookmarks first, history, Wikipedia) | C++ patch: an address-bar provider fed by the extension | N06 |
| Ad and tracker blocking | uBlock Origin Lite preinstalled, or the extension's own rules | N03 |
| Automatic updates, signing, Windows | Sparkle or own updater; Developer ID; Windows build from ungoogled-chromium-windows | N07 |

The Google window (B52) is not needed in the Chromium build.

## Steps

| ID | Step | Effort | Status |
| --- | --- | --- | --- |
| N01 | Base and first patches: ungoogled-chromium 152, branding (NODE Chromium, own bundle ID and profile folder), NODE panel as a built-in component extension with a fixed ID, autoplay with sound by default; macOS build and signing scripts; patch check and extension test in CI | M | Code done 2026-10-18. Patches apply to Chromium 152 (`check_patches.py`); the extension passes 7 checks in ungoogled-chromium 152 for Linux. **To do on the Mac:** first full build, then the checks below |
| N02 | Panel parity with the Electron sidebar: pins and hides, Trail and sessions, Library, Ask AI, AI query ideas, site rules, Settings, sound per tab and Sound: all | L | Not started |
| N03 | Look and defaults: app icon, NODE wording instead of Chromium in menus and dialogs, NODE start page, Brave Search default, ad blocking | M | Not started |
| N04 | Agents: MCP server, logged-out reader and research agent through a native helper | L | Not started |
| N05 | Mosaic: C++ patch for a 4-tile grid of live tabs | L | Not started; measure the patch size first |
| N06 | Address-bar suggestions from NODE: C++ patch | L | Not started |
| N07 | Updates, Developer ID signing and notarization, Windows build | M | Not started |

Switch gate: N01-N06 done, Google sign-in works, and the Chromium build is Sven's daily research browser for a week with no blocking bugs (the same bar as Phase 4). Then the Electron build stops getting new features.

## First Mac build (N01 checks)

Build with `browser/build.sh` (see `browser/README.md`; about 150 GB free and several hours the first time). Then open the .dmg and check:

1. The app is named NODE Chromium and opens with Open Anyway.
2. Its profile is in `~/Library/Application Support/NODE Chromium`, and the Electron NODE still opens with its own data.
3. The NODE panel opens from the side panel menu or Alt+Shift+N, and `chrome://extensions` does not list it.
4. A Wikipedia article gives keywords and results (add a Brave key in the panel's Settings).
5. YouTube starts playing with sound; five video tabs: four play, the oldest pauses and resumes when opened.
6. Google sign-in works in a normal tab (accounts.google.com, then Gmail).
7. Whether the NODE toolbar button is shown (Chromium may hide toolbar buttons of component extensions; if so, N03 adds one).

Record results in this doc and in `05-changelog.md`.

## Costs to keep in mind

- Each Chromium update (about every 4 weeks): move `base.env` to the new ungoogled tag, run the patch check, rebuild (2-4 hours on an Apple-chip Mac).
- A 150 GB working folder on the build Mac. GitHub's free runners cannot build Chromium; releases are built on the Mac until a larger runner is worth paying for.
- Without an Apple Developer ID, testers open the app with Open Anyway and update by hand, as with the Electron build.

## Sources

- [ungoogled-chromium-macos](https://github.com/ungoogled-software/ungoogled-chromium-macos): build steps, BSD-3-Clause
- [ungoogled-chromium-macos 152.0.7977.64-1.1](https://newreleases.io/project/github/ungoogled-software/ungoogled-chromium-macos/release/152.0.7977.64-1.1)
- [BrowserOS](https://github.com/browseros-ai/BrowserOS): AGPL-3.0, Chromium patches plus build CLI
- Chromium 152.0.7977.64 source: `chrome/browser/extensions/component_loader.cc`, `chrome/common/chrome_paths_mac.mm`, `media/base/media_switches.cc`
