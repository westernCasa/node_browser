# NODE mobile (walking skeleton)

Phase 5 groundwork. A React Native (Expo SDK 58, React Native 0.88) app that reuses the desktop app's logic from `../core`. It is a first runnable version, not a finished app: it has not yet been run on a phone or simulator (see "Status" below).

## What works in this skeleton

- **Opens on the trail** (CM1): the trail switcher at the top (initials, name, last visit, a dot per trail; swipe it or tap a dot to switch, tap the name for the trail list, New trail, Rename, Open file), Share next to it, a search field, and the trail's timeline, sessions newest first, with card previews. "Browse" goes to the open tabs; "Trail" in the browser's bottom bar comes back
- **Canvas tab** (CM2): the trail's canvas to look around in: drag, pinch, Fit, + and −, a minimap you can tap. Tap a card for its full preview and "Open page". Nothing is moved or edited on the phone
- **Open a `.trail.md`** (CM3): Open file → the file opens read only, on Replay: the sender's note, Start here, the steps with captions (Back, Next, tap a step); the Canvas tab dims cards not reached yet and follows the step. Save as new trail makes an editable copy, "<name> · <sender>", and goes to its timeline. Open on desktop hands the file to the share sheet (AirDrop it to your Mac)
- **Share** (CM4, CM5): a note, Start here, the timeline on or off, your name; file name and size; "Share file…" opens the phone's share sheet with the `.trail.md`. Sign-in and payment pages are never put in the file
- **Capture** (M18, bottom bar): one tap saves the page into the trail being recorded: address, title, DOI or PMID if the page has one, the time with the time zone, the selected text (or the last text you selected on the page) and a thumbnail. It becomes a capture card linked "captured from" the page's card, as on desktop. A note says where it went, with Undo. Sign-in and payment pages are never captured. The card's preview shows the thumbnail and Open DOI / PubMed. Shared files carry the quote and the "Captured from … · DOI …" line, not the thumbnail
- Pages you read on the phone go into the current trail's timeline as phone visits (timeline only, as decided in doc 25); cards are placed on desktop. Old research sessions are copied into trails on the first start
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
- Recurring keywords of the current trail at the top of its timeline (tap to pin)
- Settings sheet: search sources, Brave key, SearXNG, AI (local model on your network, or Grok). Keys are stored in the device keychain (expo-secure-store)
- History is recorded (no history screen yet)

## Run it

You need Node 22.13 or later on your computer (Expo SDK 58 requires it).

**Quickest (no Xcode or Android Studio):** install the free **Expo Go** app on your phone, then:

```bash
cd mobile
npm install
npx expo start         # scan the QR code with Expo Go (iPhone: the Camera app)
```

Use the current Expo Go from the App Store or Google Play: it runs only the newest SDK (58). The phone and computer must be on the same Wi-Fi. Every native library this skeleton uses (WebView, AsyncStorage, SecureStore, safe area) is part of Expo's standard set, so it should run in Expo Go. If Expo Go reports a missing module, use a development build instead:

```bash
npx expo run:ios       # Mac with Xcode, simulator or a connected iPhone
npx expo run:android   # Android Studio with an emulator or a connected phone
```

**iPhone Duo and iOS 27:** builds made with Xcode 27.1 or later get the iOS 27 scene setup (generated by `npx expo prebuild`; nothing to edit by hand). The app is resizable and not locked to one orientation, so it fits both Duo screens. Opening several NODE windows at once is not turned on yet.

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
| `src/services.js` | Storage (AsyncStorage), keys (SecureStore), search registry, search flow, trails (`core/trail.js`, device "phone") with the research store on top, history, site rules |
| `src/capture.js` | Smart capture logic (DOI and PMID finding, the capture card, saving and Undo); tested with `npm test` |
| `src/trailModel.js` | The trail screens' logic with no React Native imports: timeline rows, card faces, canvas view maths, opening files, Replay, Save as new, the share file. Tested with `npm test` (in `mobile/`) |
| `src/bridge.js` | Scripts injected into pages: selection and scroll reports, page extraction, autoplay, mute |
| `src/components/` | TabView (WebView); TrailHome (start screen), TrailTimeline, TrailCanvas, ReplayPanel, CardPreview, ShareTrailSheet; Suggestions, Tabs and Settings sheets |
| `../core/controller.js` | Shared "when to search again" logic, pins, hides, results (tested with `npm run test:controller` at the repo root) |

## Status and known gaps

- Bundles for iOS and Android compile (Metro + Hermes). Not yet run on a device or simulator.
- Capture from the system share sheet or a long-press menu on selected text needs a development build (a share extension; a native text menu); for now select text, then tap Capture. Voice notes on captures are not built yet (expo-audio, microphone permission).
- Opening a `.trail.md` from Files, Mail or AirDrop straight into NODE (file association) needs a development build and an app.json document type; for now use Open file.
- Site rules use the built-in defaults; no rules editor yet.
- No Library (Shot, Save, Media), find in page, zoom, or history screen yet.
- "Local model" on a phone means a model server on your network (for example Ollama on your computer, started with `OLLAMA_HOST=0.0.0.0`). Plain `http://` addresses need platform settings that are not added yet (iOS App Transport Security, Android cleartext traffic).
- `AGENTS.md` and `.claude/settings.json` came with the Expo template (notes for coding assistants); they do not affect the app.

The full plan is in `../docs/06-mobile-plan.md`.
