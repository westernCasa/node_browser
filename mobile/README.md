# NODE mobile (walking skeleton)

Phase 5 groundwork. A React Native (Expo SDK 57) app that reuses the desktop app's logic from `../core`. It is a first runnable version, not a finished app: it has not yet been run on a phone or simulator (see "Status" below).

## What works in this skeleton

- Tabs, each a WebView kept loaded; address bar with back and forward; tab switcher
- Mosaic on every screen (Mosaic button in the bottom bar): all tabs in a grid on tablets and phones in landscape; up to 4 tiles on a phone in portrait (the active tab plus the 3 most recent others)
- Autoplay per site rule, also after in-page navigation (m.youtube.com); background tabs keep playing muted, and the tab you switch to gets its sound back
- Tabs not on screen stay full size behind the visible ones, because iOS pauses videos it considers invisible
- A video paused by the system (not by a tap, and not by the 4-tab limit) is started again, at most 6 times a minute; the tab list shows how often this happened
- Address-bar suggestions while typing: Brave search for the text, bookmarks, matching history, Wikipedia titles; recent history before typing
- Bookmarks: ☆ next to the address bar; list in the tab sheet (swipe left to remove)
- Ask AI about the page (Suggestions → Ask AI), with the model from Settings
- Picture-in-picture allowed for videos (iPhone and iPad)
- Only one tab with sound on iPhone and iPad (an iOS rule); on Android, "Sound: all" in the tab list lets all playing tabs be heard
- Links that open a new window open a new NODE tab (unless the site rule blocks popups)
- Suggestions sheet: keywords from the page (tap to pin, hold to hide), Wikipedia results first, then web results, AI query ideas
- Re-search when a page loads, when you select text, or after scrolling to different content (same rules as desktop: 20 s minimum, 3 s for selections)
- Trail sheet: research session, recurring keywords, pages read, new session, export through the share sheet
- Settings sheet: search sources, Brave key, SearXNG, AI (local model on your network, or Grok). Keys are stored in the device keychain (expo-secure-store)
- History is recorded (no history screen yet)

## Run it

You need Node 18+ on your computer.

**Quickest (no Xcode or Android Studio):** install the free **Expo Go** app on your phone, then:

```bash
cd mobile
npm install
npx expo start         # scan the QR code with Expo Go (iPhone: the Camera app)
```

The phone and computer must be on the same Wi-Fi. Every native library this skeleton uses (WebView, AsyncStorage, SecureStore, safe area) is part of Expo's standard set, so it should run in Expo Go. If Expo Go reports a missing module, use a development build instead:

```bash
npx expo run:ios       # Mac with Xcode, simulator or a connected iPhone
npx expo run:android   # Android Studio with an emulator or a connected phone
```

Check that everything compiles without a phone:

```bash
npm run bundle:check   # bundles for Android and iOS and compiles to Hermes bytecode
```

## How it fits together

| File | Role |
| --- | --- |
| `index.js` | Entry; loads the URL polyfill (core/ needs a complete `URL`) |
| `metro.config.js` | Lets the bundler include `../core` |
| `App.js` | Tabs, address bar, bottom bar, wiring to the controller |
| `src/services.js` | Storage (AsyncStorage), keys (SecureStore), search registry, search flow, sessions, history, site rules |
| `src/bridge.js` | Scripts injected into pages: selection and scroll reports, page extraction, autoplay, mute |
| `src/components/` | TabView (WebView), Suggestions, Tabs, Trail and Settings sheets |
| `../core/controller.js` | Shared "when to search again" logic, pins, hides, results (tested with `npm run test:controller` at the repo root) |

## Status and known gaps

- Bundles for iOS and Android compile (Metro + Hermes). Not yet run on a device or simulator.
- Site rules use the built-in defaults; no rules editor yet.
- No Library (Shot, Save, Media), find in page, zoom, or history screen yet.
- "Local model" on a phone means a model server on your network (for example Ollama on your computer, started with `OLLAMA_HOST=0.0.0.0`). Plain `http://` addresses need platform settings that are not added yet (iOS App Transport Security, Android cleartext traffic).
- `AGENTS.md` and `.claude/settings.json` came with the Expo template (notes for coding assistants); they do not affect the app.

The full plan is in `../docs/06-mobile-plan.md`.
