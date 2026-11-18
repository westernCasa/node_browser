# NODE Research Browser: Privacy Policy (iPhone, iPad and Android)

Effective date: November 18, 2026
Contact: sven@western.casa

NODE is a web browser for research. This policy covers the NODE apps for iPhone, iPad and Android.

## The short version

- NODE has no accounts, no ads, no analytics and no tracking.
- Your trails, history, bookmarks, captures and settings are kept on your phone. We (the NODE developer) never receive them in a form we can read. If you turn on sync, your trails go to your other devices encrypted with a key only your devices have (see Sync below).
- Your API keys and your Unpaywall email are kept in your phone's secure storage (iOS Keychain, Android Keystore). We never receive them.
- Some features send data to other services, but only when you use them. Each is listed below.

## Data that stays on your phone

| Data | Why |
| --- | --- |
| Trails: pages read, cards, notes, questions, links, groups, captures and their thumbnails | So you can see and share your research |
| History and bookmarks | Address-bar suggestions and the trail timeline |
| Settings, AI consent choices, Mosaic layout | So the app works the way you set it |
| API keys (Brave Search, Grok, OpenAlex) and your Unpaywall email | To use those services for you |

Your phone's own backup (iCloud, Google) may include this data if you have backups turned on. NODE does not control those backups.

To delete everything: Settings → Your data → Delete all NODE data. You can also delete the app.

## Data sent to other services, and when

| Service | What is sent | When |
| --- | --- | --- |
| Websites you visit | What any browser sends (your IP address, the pages you request, cookies the site sets) | When you open a page |
| Wikipedia (Wikimedia) | Search words and page keywords | When NODE looks up suggestions |
| Brave Search | Search words and your Brave API key | Only if you turn on Brave and add a key |
| DuckDuckGo | Search words | When Brave is off or fails |
| xAI (Grok) | The page's address, title and text, any text you selected, your question; with AI query ideas on, keywords and page titles; and your API key | Only after you agree to send page text to Grok, and only when you use Ask AI or AI query ideas |
| Your own model server (for example Ollama) | The same as for Grok | Only after you add a server and agree; it goes to the address you entered |
| Unpaywall | The paper's DOI and your email | Only when you tap Full text, if you turned it on |
| OpenAlex | The paper's DOI and your OpenAlex key | Only when you tap Full text, if you added a key |
| People you share a trail with | The .trail.md file you choose to share | Only when you share it |

Each of these services handles the data under its own privacy policy. Apart from sync (below), NODE sends no data to the NODE developer.

## Sync (off until you pair a device)

If you pair NODE on your phone with NODE on your computer (Settings → Sync), your trails sync between your devices: cards, links, groups, notes, questions and the timeline. Screenshots, capture thumbnails and audio stay on the device that made them.

- Trails are encrypted on your device (AES-256-GCM, done by your phone's own encryption) with a key made from the pairing code. The key never leaves your devices, so NODE's sync server can't read your trails.
- The sync server passes the encrypted batches between your devices and deletes each one once your other devices have it, after 30 days at most.
- The server keeps a random id for each paired device (made by the app, not linked to you or your phone), when it joined and last synced, and how far it has read. Your network address is used only to limit how many requests one address can make, and is not stored.
- No account is needed. To stop: Settings → Sync → Stop syncing on this phone. Delete all NODE data stops syncing too. The last device to stop removes everything the server kept for your devices.

The Demo AI runs on your phone and sends nothing.

## Reporting an AI answer

If you tap Report on an AI answer, NODE opens an email to us with the question, the answer, the page address and the app version. You can read and change it before sending. We use these reports only to fix problems.

## Permissions

| Permission | Why |
| --- | --- |
| Local network (iPhone) | Only if you add an AI model server on your own network |
| Camera | To scan the pairing code for sync, only while the scanner is open; and when a website you visit asks, after your phone asks you |
| Microphone, location | Only when a website you visit asks; your phone asks you first |

## Children

NODE is not made for children under 13 and gives access to the whole web. It is rated 16+ on the App Store.

## Changes

If this policy changes, the new version will be posted here with a new date.
