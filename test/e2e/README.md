# End-to-end tests

These drive the real Electron app with Playwright against local test pages. Search sources (Wikipedia, DuckDuckGo, Brave) are replaced with stubs inside the app, so no network access is needed and live result quality is not checked.

```bash
npm install
npm install --no-save playwright          # once
cd test/e2e/site && python3 -m http.server 8765 --bind 127.0.0.1 &   # test pages
cd ../../..
node test/e2e/01-basics.js                # each script prints one line per check
```

On Linux without a display, run each script under `xvfb-run -a`.

| Script | Checks |
| --- | --- |
| 01-basics | Keywords, queries, pins and hides, popups, muted background tab, S shortcut, text selection, permission prompts |
| 02-sources | DuckDuckGo blocked and fallback, Sources panel, Brave key rejected and accepted, lazy previews, key storage |
| 03-rules-and-fast-results | Wikipedia results first, site rules (extract, popups, autoplay, suggest off), live reload, broken rules file |
| 04-find-zoom-history | History search, address-bar suggestions, find in page, zoom badge, History shelf |
| 05-research-session | Trail, recurring keywords, dismiss, read badges, export, pins after restart, new session |
| 06-ai-query-ideas | Local model and Grok (fake servers): Test and model list, bad key, wrong model name, AI queries in search, what is sent, local model down |
| 07-performance | Page reads while a large article sits idle, time for one read, whether a background tab is throttled and stops drawing |
| 08-media-and-brave | Brave on by default (also for older settings), first-run notice, address-bar search goes to Brave; main video plays while the page is still loading, small video stays paused, paused video stays paused, late and single-page players, background tab keeps playing muted |
| 09-playback-limit | Five video tabs: four play, the oldest pauses and is marked; opening it resumes it and pauses the next oldest; closing a playing tab (this used to crash Electron) |
| 10-center-and-sound | Clicking a video, a video under a player overlay, and an embedded player centers it; a small icon and a site with `center: false` do not; Sound: one / all mutes and unmutes background tabs |
| 11-gestures | Two-finger swipe back and forward, no navigation over a sideways-scrolling area, mouse side buttons, middle-click on a link (background tab), double-click on the tab bar, drag to reorder tabs, middle-click to close a tab |
| 12-pip-bookmarks-adblock | Ad blocked with a test filter list, photo not blocked, site rule and Settings switch allow it; bookmark star, saved file, address-bar suggestion, Bookmarks shelf; picture-in-picture opens and closes |
| 17-talk | Talk: no lookups before it is opened, Hacker News and Bluesky rows, address cleaned, a row opens in a tab, follows the active tab, Bluesky failing leaves Hacker News, sign-in and local pages never looked up, quiet after closing |
| 41-survey-newtab | Survey card on the new tab page: none before 3 days of use, shown after; Take survey focused; Later saved in the window and held across a restart the same day; asked again on the next day; Esc is Later; Take survey opens the survey in the same tab, is kept in survey.json, and ends both the card and the widget prompt |
| 48-canvas-media | Library media on the canvas (B114): dropped files become media cards side by side, image shows, video and audio play on the card one at a time and keep playing through a redraw, viewer, Put on canvas, drag from the Library, media saved from a page with its captured-from line, Replay caption, the shared file links to the origin, the reader previews from there, read-only trails take no media |
| 49-trail-rename-delete | Rename and delete trails from the switcher (B115): the … button on each trail, inline rename (Enter saves, Esc cancels), double-click and F2, rename over a page in the sidebar's layer, a rename is an event, delete asks first and says what goes, its tabs close, the next trail becomes current, Undo, the Delete key, files purged at the next start, deleting the only trail starts a new one, an opened file can be deleted but not renamed |
| 50-provenance | Trail provenance (B83): a typed address, a link clicked on a page, a suggestion with its keyword, a page the agent found, NODE's autoplay, a site moving to the next item by itself (in-page navigation), unknown ways ignored; the line on canvas cards with NODE's picks in violet; Replay captions |
| 51-trail-recall | Search past trails (B89): the "In your trails" group in the CommandBar ("after the memex page" finds the next page in another trail), picking switches trail and selects the card with a ring; the canvas search list ("memex today") under its heading, after the web choices; a timeline-only page shows its row marked; words that say nothing find nothing |
| 52-media-moments | Media moments (B88): ⌘⇧K start then end saves a moment card with captions and pauses; ⌘⇧J saves the last 30 seconds with the caption cues; with a loop set one press saves the loop; the card (Moment, times, captions, Play, Ask for ID); the timeline says Moment; changing the times; Ask for ID makes a "raises" question; Play seeks, plays and loops the range; no video, nothing saved |
| 21-rules-editor | Site rules editor: list with plain summaries, Rule for this site, saving and the rule taking effect (autoplay off after reload), invalid pattern refused with the file unchanged, hand-written fields kept, move and delete |
| 20-first-run-and-help | Welcome screen on first start (page views hidden), choices saved with keys encrypted, not shown again; new tab page with most visited pages and its search box; a custom new tab page; Copy diagnostics without keys; Help menu |
| 19-browser-basics | Error page for a failed load, page-stopped page after a crash, reopen closed tab, Tab 1 and Next Tab, right-click menu items for links, images, text and the page, two downloads (second renamed), Library → Downloads, Save as PDF, sleeping idle tabs and waking one, tabs restored after a restart (asleep except the active one) |
| 18-redteam | Prompt-injection pages (`site/redteam`): hidden instructions left out of what agents read, visible ones marked untrusted; the research agent with a compromised model that obeys the pages; pass mark is zero requests to the attacker server. Run before each release: `npm run test:redteam` |
| 16-research-agent | Research agent with a fake model: steps listed live, only search results read, a page with hidden instructions does not redirect it (and its text is sent only inside untrusted tags), password page skipped, report with citations and a sources list built by NODE, saved to the Library and the session, sources in Mosaic, Stop |
| 15-agents-mcp | MCP server: off by default, token and Origin checks, handshake, tools (search, shared tabs, logged-out reader), hard blocks (sign-in, file, local network, password form, checkout), research session resources, sharing ends on a new site, settings and activity log, stop switch |
| 14-google-window | Google window with Chromium (`NODE_GOOGLE_BROWSER`, defaults to Playwright's Chromium): placeholder tab and address, extension connects, visits reach NODE's history, no duplicate tab on a second open, a Gmail link from a page, mode off, settings saved |
| 47-chromium-canvas | Trail canvas in the Chromium build (B112): new tab is the canvas, visits recorded, 20 s and hand scroll make cards with an opened-from line, quick visits timeline-only, sign-in pages never cards, Put on canvas, Note, Link, Group, search card, kept across a restart, Share as a download, open a file read only on Replay, Save as new trail. Same setup as 46 |
| 46-chromium-build | NODE Chromium build: the built-in extension in Chromium 152 (`NODE_CHROMIUM` points to the binary, for example ungoogled-chromium 152 for Linux): fixed ID, keywords, results, Talk, autoplay with sound, 4-tab limit, center on click. Run with `npm run test:chromium-build` after `npm run build:browser-extension` |
| 13-ask-ai | Ask AI with a fake local model: privacy line, what is sent (page text without navigation or footer), answer shown, follow-up carries the conversation, new page starts over, Ollama not running, server down |
