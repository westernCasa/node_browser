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
