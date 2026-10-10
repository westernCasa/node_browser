# Scout

A research browser. No product branding. Multi-tab, mosaic playback so more than one video can run at once, and a side panel that proposes the next pages from keywords on the page you are viewing.

## Run

This is a desktop browser (Electron), not a website.

```bash
cd ~/Downloads/scout-browser
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

**Shot** (or press **S**) captures the active tab into a real folder on this computer and stores the page URL. **Library → Open site** goes back to that page. **Show folder** opens the directory in Finder or Explorer. **Save** writes a JSON note of the page. **Media** downloads the largest video or image currently in view.

## Tauri (desktop + iOS / Android)

Same UI. Tabs open as extra system webviews (required on mobile). Crawl and previews run in Rust.

Install Rust: https://rustup.rs

```bash
cd ~/Downloads/scout-browser
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

1. Each tab is an Electron `BrowserView` — a real Chromium page, not an iframe. Media is not throttled in background tabs (`backgroundThrottling: false`), so several videos can play together.
2. **Mosaic** tiles every open tab. Click a tile to make it the current tab. **Focus** shows one tab at full size.
3. Autoplay is allowed without a prior click. HTML5 media is started after load; common video embeds get `autoplay=1` if it was missing.
4. When a page finishes loading, Scout reads title, description, headings, and any selected text. Those become editable keyword chips.
5. **Crawl** searches the open web (DuckDuckGo HTML) plus Wikipedia and lists related pages with snippets.

## What this is not

It is not a general-purpose crawler, scraper farm, or archive bot. It only suggests a short list of next URLs from a keyword query against public search. It does not log in, bypass paywalls, or walk an entire site unattended.
