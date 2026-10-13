# NODE core

Logic shared by the desktop app (`main.js`, Electron) and the mobile app (`mobile/`, React Native). Nothing in this folder imports Node, Electron or React Native modules; the platform passes in what it needs (a `fetch` function, a storage object, settings getters).

| File | What it does | Platform passes in |
| --- | --- | --- |
| `keywords.js` | Ranks page keywords, finds names, builds 2-3 short queries | Nothing |
| `providers.js` | Search sources (Wikipedia, Brave, SearXNG, DuckDuckGo) and the fallback registry | `getText`, settings getter |
| `net.js` | Cached, throttled, time-limited GET requests | `fetch`, user agent |
| `suggest.js` | Search flow: keyword queries, AI queries, merged results, two-pass (Wikipedia first) | Registry, AI settings getter |
| `ai.js` | AI query ideas through any OpenAI-compatible API (local model or Grok) | `fetch` (optional) |
| `rules.js` | Site rules: defaults, validation, URL matching, merging | Nothing |
| `research.js` | Research sessions: trail, pins, opened, dismissed, recurring keywords, Markdown export | Storage object |
| `history.js` | Visit history and address-bar suggestions | Storage object |
| `preview.js` | Picks the best image or video for a result card | `getText` |
| `page-scripts.js` | Scripts injected into pages: extraction, autoplay, autoplay blocking | Nothing |
| `storage.js` | In-memory storage with a write callback (used by mobile) | Initial files, write callback |
| `compat.js` | Timeout signal that works on engines without `AbortSignal.timeout` | Nothing |

Desktop storage is `fs-storage.js` at the repo root (files in a folder).

Rules for this folder:
- No `require` of `fs`, `path`, `electron`, `react-native` or other platform modules.
- No `AbortSignal.timeout` (use `compat.timeoutSignal`).
- Keep it testable with plain Node: `npm run test:keywords`, `test:providers`, `test:rules`, `test:ai`.
