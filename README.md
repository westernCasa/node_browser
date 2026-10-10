# Scout

A research browser. No product branding. Multi-tab, mosaic playback so more than one video can run at once, and a side panel that proposes the next pages from keywords on the page you are viewing.

## Run

This is a desktop browser (Electron), not a website.

```bash
cd scout   # the folder that holds package.json
npm install
npx electron .
```

`npm start` also works after `npm install`. The first `npm install` downloads Electron into `node_modules` — without that step you get `electron: command not found`.

On macOS the first launch may be blocked by Gatekeeper. If that happens:

```bash
xattr -cr node_modules/electron
npx electron .
```

Requires Node 18+.

**Shot** (or press **S** anywhere outside a text field) captures the active tab into a real folder on this computer and stores the page URL. **Library → Open source** goes back to that page. **Show folder** opens the directory in Finder or Explorer. **Save** writes a JSON note of the page. **Media** downloads the largest video or image currently in view (streamed video such as YouTube cannot be saved as one file).

### Shortcuts

| Keys | Action |
| --- | --- |
| Cmd/Ctrl+T | New tab |
| Cmd/Ctrl+W | Close tab |
| Cmd/Ctrl+L | Focus the address bar |
| Cmd/Ctrl+R | Reload |
| Cmd/Ctrl+[ and ] | Back, forward |
| Cmd/Ctrl+Shift+M | Mosaic on or off |
| Cmd/Ctrl+Shift+U | Mute or unmute the tab |
| Cmd/Ctrl+Shift+S, or S | Screenshot the tab |

## Tauri (desktop + iOS / Android)

Same UI. Tabs open as extra system webviews (required on mobile). Crawl and previews run in Rust.

Install Rust: https://rustup.rs

```bash
cd scout   # the folder that holds package.json
npm install
npx tauri dev
```

iPhone (Xcode + Apple ID):

```bash
npx tauri ios init
npx tauri ios dev
```

Android (Android Studio + SDK):

```bash
npx tauri android init
npx tauri android dev
```

First `ios init` / `android init` generates native projects under `src-tauri/gen`. Mosaic on a phone is one tab focused; extra tabs are separate webviews you switch from the chrome window.

## How it works

1. Each tab is an Electron `BrowserView`, a real Chromium page. Background tabs are not throttled, so several videos can play together.
2. **Mosaic** tiles every open tab. Click a tile to make it the current tab. **Focus** shows one tab at full size.
3. **Sound:** only the active tab is audible. Other tabs keep playing muted. The speaker button on a tab overrides this; right-click it to go back to automatic.
4. **Autoplay** is allowed without a prior click. HTML5 media is started after load; common video embeds get `autoplay=1` if it was missing.
5. **Popups** open as a new tab only if you clicked or typed in the page in the previous 2 seconds. Other popups are blocked and listed in the sidebar with an "Open in new tab" button.
6. **Permissions:** camera, microphone, location, notifications, clipboard reading and screen capture always ask first. Answers can be remembered per site (File → Reset Site Permissions clears them).
7. **Keywords** (`keywords.js`): Scout reads the page title, description, headings, selected text and the text currently on screen (navigation and footers skipped). Words are scored by where they appear, how specific they are, and how rare they are across the pages you have visited this session. Multi-word names ("Marie Curie") are kept together.
8. **Pin and hide:** click a keyword to pin it; pinned keywords go into every search and are never replaced. × hides a keyword for good (Show all brings them back).
9. **Search:** pins and the top keywords become 2 or 3 short queries (at most 4 words each), sent to Wikipedia and DuckDuckGo. Results are cached for 30 minutes, requests are spaced out per site, and DuckDuckGo is paused for 10 minutes if it starts blocking.
10. **Auto** re-searches when you open a new page, select text, or scroll to content with different keywords (at most every 20 seconds). Turn Auto off to search only when you press **Crawl**.

## What this is not

It is not a general-purpose crawler, scraper farm, or archive bot. It only suggests a short list of next URLs from a keyword query against public search. It does not log in, bypass paywalls, or walk an entire site unattended.
