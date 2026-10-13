# Scout Browser: Mobile Plan

Last updated: 2026-10-10. Status: planning and groundwork done; full build waits for the desktop Phase 4 gate (daily use for a week with no blocking bugs).

## Summary

- **Recommendation:** build the mobile app with React Native (Expo), not Tauri. Backlog items B21-B24 (Tauri) are replaced by M01-M15 below.
- **Why:** a research browser needs several web pages on one screen (tabs kept loaded, Mosaic), scripts injected into each page, and the keyword, search and session logic Scout already has. React Native's WebView component supports all three, and it runs JavaScript, so Scout's existing logic is reused as-is. Tauri documents multiple windows on tablets but not several web views on one phone screen, and its existing Scout code does not compile.
- **Groundwork done:** the platform-neutral logic now lives in `core/` and the desktop app uses it (all desktop tests pass). A walking-skeleton app in `mobile/` uses the same `core/` and compiles for iOS and Android. It has not been run on a device yet (M01).
- **Next step for Sven:** install Expo Go on a phone and run the skeleton (M01). About 10 minutes; see `mobile/README.md`.

## Constraints

| Constraint | Effect on Scout |
| --- | --- |
| On iOS, outside the EU (and Japan, where a law requiring alternative engines was due by December 2025), browsers must use Apple's WebKit | Every option uses WKWebView on iPhone. Pages render the same as in Safari; Scout adds its features around them |
| Phones have small screens | Mosaic on phones shows at most 4 tiles (stacked in one column for 2-3 tabs, 2 by 2 for 4); tablets and landscape phones show every tab |
| A WebView has no mute switch | Background tabs are muted from inside the page by an injected script |
| iOS plays only one video with sound at a time | WebKit (which every iOS browser must use) pauses a playing video that has sound when another one with sound starts; muted videos are not limited. So on iPhone and iPad, several tabs can play at once but only the active tab has sound. Android has no such rule, so "Sound: all" is offered there only. Found in the first phone test (2026-10-12) |
| iOS pauses videos it considers invisible | Tabs shrunk to 1x1 off-screen counted as invisible, so their videos stopped. Tabs now stay full size, stacked behind the visible ones (fixed 2026-10-12, to confirm on the phone) |
| iOS limits background activity | Media in tabs will likely pause when Scout is in the background. To confirm on a device (M02) |
| Phones cannot run large AI models comfortably | "Local model" on a phone means a model server on your own network (for example Ollama on your computer), or Grok |
| Publishing | Apple Developer Program $99 per year. Google Play $25 once; new personal accounts must run a closed test with at least 12 testers for 14 days before going public |

## Options compared

| Option | Several web pages on one screen | Reuses Scout's logic | Script injection into pages | Effort | Verdict |
| --- | --- | --- | --- | --- | --- |
| **React Native (Expo) + react-native-webview** | Yes: any number of WebView components | Yes: `core/` runs unchanged (JavaScript) | Yes: before load, after load, and on demand, with messages back | Medium | **Recommended** |
| Tauri 2 mobile | Multiple windows on tablets (iPad scenes, Android activity embedding); several web views on one phone screen not documented | Partly: logic would move into the web front end or be ported to Rust | Yes | High: existing Tauri code does not compile (C2-C4) | Not recommended |
| Capacitor | One main web view; extra pages open in a separate in-app browser | Yes (JavaScript) | Limited for the extra browser | Medium | Poor fit for tabs and Mosaic |
| Native (Swift + Kotlin) | Yes | No: two new codebases, logic rewritten twice | Yes | Very high for one person | Not now |

The choice is reversible at low cost: everything in `core/` is plain JavaScript and works with any option except fully native.

## Architecture

```
              core/  (shared, plain JavaScript)
  keywords · providers · net · suggest · ai · rules · research · history
  preview · page-scripts · controller · storage · urls · compat
           │                                   │
   Desktop shell (Electron)              Mobile shell (React Native)
   main.js, renderer/, preload.js        mobile/App.js, src/
   fs-storage.js (files)                 services.js (AsyncStorage + SecureStore)
   WebContentsView per tab               WebView per tab
   executeJavaScript(...)                injectJavaScript(...) + postMessage
```

What each platform supplies to `core/`:

| Need | Desktop | Mobile |
| --- | --- | --- |
| HTTP | Electron `fetch` | React Native `fetch` |
| Files | `fs-storage.js` (one file per name) | `memoryStorage` loaded from AsyncStorage, writes saved in the background |
| API keys | `safeStorage` (system keychain) | `expo-secure-store` (iOS Keychain, Android Keystore) |
| Run a script in a page | `webContents.executeJavaScript` | `WebView.injectJavaScript`, result returned with `postMessage` |
| `URL` | Built in | `react-native-url-polyfill` |
| Timeouts | `AbortSignal.timeout` | `compat.timeoutSignal` fallback |

## Feature mapping

| Desktop feature | Mobile approach | In skeleton |
| --- | --- | --- |
| Tabs | One WebView per tab, kept loaded; tab switcher sheet | Yes |
| Mosaic | All screens (decided 2026-10-12). Tablets and landscape phones: grid of all tabs. Phones in portrait: up to 4 tiles. Tap a tile to make it active; only the active tile plays sound | Yes |
| Autoplay | `mediaPlaybackRequiresUserAction=false`, inline playback, injected autoplay script per site rule | Yes |
| Only the active tab plays sound | Injected script mutes media when a tab goes to the background | Yes |
| Popups | `onOpenWindow` opens a new tab; site rule "block" ignores it. iOS blocks scripted popups without a tap by default | Yes |
| Permissions (camera, location...) | System prompts from iOS/Android plus the app's own usage descriptions | Not yet (M02) |
| Keywords from the visible page | Same extraction script, injected; result returned by message | Yes |
| Re-search triggers | Page load, text selection, scroll stop (no 5-second polling, to save battery) | Yes |
| Pins and hides | Tap to pin, press and hold to hide | Yes |
| Wikipedia-first results, sources, AI | Same `core/suggest.js` | Yes |
| Previews | Images from Wikipedia and Brave results | Partly (no page-fetch previews yet) |
| Site rules | Same `core/rules.js`; built-in defaults | Defaults only (M04) |
| Research sessions, trail, export | Same `core/research.js`; export through the share sheet | Yes |
| History | Same `core/history.js`; recorded | Recorded, no screen (M07) |
| Find, zoom | Pinch zoom is native; find needs an injected highlighter | No (M06) |
| Library (Shot, Save, Media) | Share sheet and device storage | No (M05) |
| Keyboard shortcuts | Not applicable on phones; hardware keyboards on tablets later | No |

## Phase 5 backlog

Phase 5 starts building after the desktop Phase 4 gate passes. M01-M02 can run any time because they only need a phone.

| ID | Item | Priority | Effort | Status |
| --- | --- | --- | --- | --- |
| M01 | Run the skeleton on a phone with Expo Go and report what breaks | P0 | XS | Started (Sven, iPhone, 2026-10-12): autoplay stopped in background tabs and only one tab had sound; fixes in progress |
| M02 | Check on iPhone and Android: page extraction, selection and scroll reports, autoplay, background muting, several tabs playing (limit of 4, center on tap, and whether iOS allows several videos at once), Mosaic on a phone (2, 3 and 4 tiles, memory with 4 pages playing), popups, permission prompts, media in the background | P0 | S | Not started |
| M03 | Allow plain `http://` to a model server on the local network (iOS App Transport Security, Android cleartext traffic) | P1 | S | Not started |
| M04 | Site rules on mobile: same file format as desktop, with a simple editor | P1 | M | Not started |
| M05 | Library on mobile: screenshot of a tab, save a page note, share to other apps | P1 | M | Not started |
| M06 | Find in page (injected highlighter with next/previous) | P2 | M | Not started |
| M07 | History screen and address-bar suggestions | P2 | S | Not started |
| M08 | Unload tabs that have been hidden for a while and reload them when opened, to save memory | P1 | M | Not started |
| M09 | Move sessions, pins and rules between desktop and mobile: export/import file first, sync later | P2 | L | Not started |
| M10 | Design pass: phone layout, swipe between tabs, tablet layout with the page and suggestions side by side | P1 | M | Not started |
| M11 | App icon, splash screen, store listing | P2 | S | Not started |
| M12 | TestFlight (iOS) and Google Play closed test (12 testers for 14 days) | P1 | M | Not started |
| M13 | Desktop sidebar uses `core/controller.js` too, so the search logic exists once | P2 | M | Not started |
| M14 | Automated mobile tests (for example Maestro flows on a simulator) | P2 | M | Not started |
| M15 | Remove the old Tauri code (`src-tauri/`, `renderer/tauri-bridge.js`) once React Native is confirmed | P2 | XS | Not started |

## Groundwork done (2026-10-10)

| Work | Where | Checked by |
| --- | --- | --- |
| Shared logic moved out of `main.js` into `core/` (network, search flow, AI, history, previews, page scripts, storage adapters, URL helper) | `core/`, `fs-storage.js` | All 6 desktop end-to-end suites (69 checks) and 4 unit demos pass unchanged |
| Shared suggestion controller (pins, hides, re-search rules, Wikipedia-first, dismissed results, session trail) | `core/controller.js` | `npm run test:controller` |
| `core/` made safe for the mobile JavaScript engine (no Node modules, timeout fallback) | `core/compat.js`, `core/README.md` | Compiles to Hermes bytecode in the mobile bundles |
| Expo SDK 57 app: tabs, Mosaic (phones and tablets), suggestions, trail, settings, keys in the keychain | `mobile/` | `npm run bundle:check` builds iOS and Android bundles; `expo-doctor` 19 of 21 checks (the 2 others need Expo's servers, unreachable from the build sandbox) |

## Risks and open questions

| Risk | Plan |
| --- | --- |
| The skeleton has not run on a device; React Native or WebView behaviour may differ from what is documented | M01 and M02 first |
| Hermes may not support every regular-expression feature used in `core/keywords.js` (Unicode letter classes) at run time, even though it compiles | Confirm in M01 (keywords appear in the Suggestions sheet); fall back to ASCII-plus-Latin classes if not |
| Many loaded WebViews use a lot of memory on phones | M08 (unload hidden tabs) |
| iOS may pause media in background tabs or when the app is in the background | Accept for tabs in the background of the app; check behaviour for hidden tabs in M02 |
| App Store review for browser apps | Scout uses WebKit as required; describe the research features clearly in the listing |
| Two copies of the "when to search" logic until M13 | The desktop sidebar keeps its own copy for now; `core/controller.js` is the reference |

## Test plan

1. **Without a phone (every change):** `npm run test:keywords`, `test:providers`, `test:rules`, `test:ai`, `test:controller` at the repo root; `npm run bundle:check` in `mobile/`.
2. **Desktop (every change to `core/`):** the 6 end-to-end suites in `test/e2e`.
3. **On a phone (M01, M02):** open an article, check keywords and results; pin and hide; select text; open a result in a new tab; play a video in one tab and switch tabs (it should mute); Trail export; Settings with Grok and Test AI.
4. **Later (M14):** scripted flows on a simulator.

## Sources

- [Tauri 2: Multi-Window on Mobile](https://v2.tauri.app/de/learn/mobile-multiwindow/)
- [Apple's WebKit rule and EU/Japan exceptions (Kiledjian, 2025)](https://kiledjian.com/2025/09/29/apples-walled-garden-why-browser.html)
- [react-native-webview reference](https://github.com/lineCode/react-native-webview/blob/master/docs/Reference.md); props also checked in the installed version 13.16.1
- [App Store and Google Play costs and requirements in 2026 (iLab)](https://ilab.md/en/articles/publishing-on-the-app-store-and-google-play-in-2026-timelines-costs-and-7-hidden-requirements-that-could-derail-your-launch)
- [Expo: Work with monorepos](https://docs.expo.dev/guides/monorepos/)
