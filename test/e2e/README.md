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
| 14-google-window | Google window with Chromium (`NODE_GOOGLE_BROWSER`, defaults to Playwright's Chromium): placeholder tab and address, extension connects, visits reach NODE's history, no duplicate tab on a second open, a Gmail link from a page, mode off, settings saved |
| 13-ask-ai | Ask AI with a fake local model: privacy line, what is sent (page text without navigation or footer), answer shown, follow-up carries the conversation, new page starts over, Ollama not running, server down |
