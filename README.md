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
| Cmd/Ctrl+L | Focus the address bar (suggests pages from history as you type) |
| Cmd/Ctrl+R | Reload |
| Cmd/Ctrl+[ and ] | Back, forward |
| Cmd/Ctrl+F, Cmd/Ctrl+G, Shift+Cmd/Ctrl+G | Find in page, next match, previous match |
| Cmd/Ctrl+= , Cmd/Ctrl+-, Cmd/Ctrl+0 | Zoom in, out, reset (pinch and Ctrl+scroll also work) |
| Cmd/Ctrl+Y | History |
| Cmd/Ctrl+Shift+M | Mosaic on or off |
| Cmd/Ctrl+Shift+U | Mute or unmute the tab |
| Cmd/Ctrl+Shift+S, or S | Screenshot the tab |

## Repository layout

| Folder | What it is |
| --- | --- |
| `core/` | Logic shared by desktop and mobile (keywords, search sources, AI, rules, sessions, history, page scripts). See `core/README.md` |
| `renderer/`, `main.js`, `preload.js`, `view-preload.js`, `fs-storage.js` | Desktop app (Electron) |
| `mobile/` | Mobile app (React Native, Expo) walking skeleton. See `mobile/README.md` |
| `test/` | Unit demos and desktop end-to-end tests |
| `docs/` | Overview, roadmap, architecture, review findings, change log, mobile plan |

## Mobile

The mobile app is planned with React Native (Expo) and reuses `core/`. A first version is in `mobile/`: try it on your phone with the Expo Go app (`cd mobile && npm install && npx expo start`, then scan the QR code). The plan is in `docs/06-mobile-plan.md`.

The old Tauri setup (`src-tauri/`, `renderer/tauri-bridge.js`) does not compile and will be removed.

## How it works

1. Each tab is an Electron `WebContentsView`, a real Chromium page. Tabs that are not on screen are detached from the window, so Chromium stops drawing them and slows their timers; their media keeps playing. In Mosaic every tile is on screen, so several videos play together.
2. **Mosaic** tiles every open tab. Click a tile to make it the current tab. **Focus** shows one tab at full size.
3. **Playing in several tabs:** media autoplays in every tab, and up to 4 tabs play at once. When a fifth tab starts, the tab that started playing longest ago is paused and marked ⏸ in the tab bar (the active tab is never paused this way). Opening a paused tab resumes it.
   **Sound:** only the active tab is audible. Other tabs keep playing muted. The speaker button on a tab overrides this; right-click it to go back to automatic.
4. **Autoplay** is allowed without a prior click. As soon as a page is parsed, Scout plays its main media with sound: the largest visible video or YouTube, Vimeo or Dailymotion embed, or else the first audio player. Players that appear later (built by a script, or on sites like YouTube that change address without reloading) are caught for 20 seconds. Only the main player starts, and media you pause stays paused.
5. **Popups** open as a new tab only if you clicked or typed in the page in the previous 2 seconds. Other popups are blocked and listed in the sidebar with an "Open in new tab" button.
6. **Permissions:** camera, microphone, location, notifications, clipboard reading and screen capture always ask first. Answers can be remembered per site (File → Reset Site Permissions clears them).
7. **Keywords** (`keywords.js`): Scout reads the page title, description, headings, selected text and the text currently on screen (navigation and footers skipped). Words are scored by where they appear, how specific they are, and how rare they are across the pages you have visited this session. Multi-word names ("Marie Curie") are kept together.
8. **Pin and hide:** click a keyword to pin it; pinned keywords go into every search and are never replaced. × hides a keyword for good (Show all brings them back).
9. **Search:** pins and the top keywords become 2 or 3 short queries (at most 4 words each). Wikipedia runs for every query. Web results come from the first working source in this order: Brave Search API (the default; needs your API key), SearXNG, DuckDuckGo. Searches typed in the address bar open Brave Search (search.brave.com). A source that rejects a key, hits a rate limit or starts blocking is paused for a while and the next one is used. Results are cached for 30 minutes and requests are spaced out per site.
10. **Results** show Wikipedia first, within about a second; web results are merged in when they arrive.
11. **Previews** on result cards load only when a card scrolls into view, 3 at a time. Wikipedia and Brave results that already include an image skip the fetch.
12. **Auto** re-searches when you open a new page, select text, or scroll to content with different keywords (at most every 20 seconds). Turn Auto off to search only when you press **Crawl**.

## Research sessions

**Trail** in the sidebar shows the current research session: every page you read (with its top keywords), keywords that recur across pages, and how many suggestions you opened or hid. Click a keyword to pin it. Pinned keywords are saved with the session.

On result cards, **×** hides a result for the rest of the session, and results you have already opened or read are dimmed and marked "read". **New** starts a fresh session; the dropdown switches back to an older one. **Export** saves the session as Markdown notes in the Library (Saves).

## Site rules

Scout reads `rules.json` (File → Edit Site Rules…, or Settings → Edit rules file) and reloads it when you save. Each rule has a `match` and any of these settings:

| Setting | Values | Effect |
| --- | --- | --- |
| `autoplay` | `on`, `muted`, `off` | Start media on load, start it muted, or pause media the page starts before you interact |
| `sound` | `auto`, `on`, `off` | Default sound for tabs on this site (the speaker button still overrides it) |
| `popups` | `gesture`, `block`, `allow` | Popups only after a click, never, or always |
| `suggest` | `true`, `false` | `false` stops Scout reading the page for keywords or sending its words to search |
| `mosaic` | `true`, `false` | `false` keeps the site out of the Mosaic grid unless it is the active tab |
| `extract.include`, `extract.skip` | lists of CSS selectors | Extra text to read with priority; areas to ignore |

`match` can be `example.com` (with subdomains), `*.example.com` (subdomains only), `example.com/path`, a list of these, `*` for every site, or a regular expression like `/\/login/i`. Rules apply in order and later matches win. The first run creates examples for Wikipedia, YouTube, and sign-in, banking and payment pages (no suggestions, no autoplay). A broken file is reported in the sidebar and the previous rules stay in use.

## AI query ideas

Optional (Settings → AI query ideas). An AI model reads your pinned keywords, the page's top keywords and its title, and suggests up to 2 extra search queries that look for other angles: background, related people or organisations, primary sources, opposing views. The status line marks these queries "(AI)". Keyword-only results still show first, so the AI never slows down the first results.

| Option | Setup | Privacy |
| --- | --- | --- |
| Local model | Install [Ollama](https://ollama.com) and run `ollama pull llama3.2` (or any chat model). Address `http://localhost:11434/v1`. LM Studio also works at `http://localhost:1234/v1`. | Nothing leaves your computer |
| Grok (xAI) | API key from xAI. Press **Test** to see the model names your key can use and pick one. | Keywords and page titles are sent to xAI |

The model never receives page text or addresses, and pages with suggestions turned off by a site rule are never sent. If the model is unreachable or answers badly, Scout uses its normal keyword queries and shows a note. The Grok key is stored like the search keys (encrypted with the system keychain when available).

## Search sources

Open **Settings** in the sidebar to turn sources on or off. **Test** runs one search with that source and shows the result or the error.

| Source | Setup | Notes |
| --- | --- | --- |
| Wikipedia | Nothing. Optional language code (en, es, fr…) | Always runs; gives the reference results |
| Brave Search API | API key from the Brave Search API dashboard (api-dashboard.search.brave.com) | Default web source, on from the start. Best web results; has a free tier with a monthly limit. Without a key, DuckDuckGo is used |
| SearXNG | URL of an instance you run or trust, with the `json` format enabled in its `settings.yml` | No key; you control the engines |
| DuckDuckGo | Nothing | Fallback only. Reads the HTML results page, so it can break or be rate-limited |

API keys are stored in Scout's `settings.json`, encrypted with the system keychain when one is available.

## What this is not

It is not a general-purpose crawler, scraper farm, or archive bot. It only suggests a short list of next URLs from a keyword query against public search. It does not log in, bypass paywalls, or walk an entire site unattended.
