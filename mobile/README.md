# Scout mobile (walking skeleton)

Phase 5 groundwork. A React Native (Expo SDK 57) app that reuses the desktop app's logic from `../core`. It is a first runnable version, not a finished app: it has not yet been run on a phone or simulator (see "Status" below).

## What works in this skeleton

- Tabs, each a WebView kept loaded; address bar with back and forward; tab switcher
- Mosaic grid of tabs on screens 700 pt wide or more (tablets, large phones in landscape)
- Autoplay per site rule; background tabs muted
- Links that open a new window open a new Scout tab (unless the site rule blocks popups)
- Suggestions sheet: keywords from the page (tap to pin, hold to hide), Wikipedia results first, then web results, AI query ideas
- Re-search when a page loads, when you select text, or after scrolling to different content (same rules as desktop: 20 s minimum, 3 s for selections)
- Trail sheet: research session, recurring keywords, pages read, new session, export through the share sheet
- Settings sheet: search sources, Brave key, SearXNG, AI (local model on your network, or Grok). Keys are stored in the device keychain (expo-secure-store)
- History is recorded (no history screen yet)

## Run it

You need Node 18+, and either an iPhone or Android phone with the **Expo Go** app is not enough: `react-native-webview` needs a development build.

```bash
cd mobile
npm install
npx expo run:ios       # Mac with Xcode, simulator or a connected iPhone
npx expo run:android   # Android Studio with an emulator or a connected phone
```

Or build in the cloud with EAS (`npx eas build --profile development`), which needs an Expo account.

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
