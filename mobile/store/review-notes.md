# Notes for App Review (Apple) and App access (Google Play)

Paste this into App Store Connect → App Review Information → Notes, and Play Console → App content → App access. Keep it under 4,000 characters.

---

NODE is a research web browser. Pages are shown with WebKit (WKWebView) on iOS, as guideline 2.5.6 requires. No account or sign-in is needed. Every feature can be tested without a key.

What NODE adds to browsing:
1. Trails: the app opens on a trail, a timeline and canvas of what you read. Pages you read for 20 seconds, scroll or capture become cards. On the Canvas tab you can move cards, link them, group them, and add notes and questions.
2. Mosaic: up to 4 pages on screen at once. Tap Mosaic in the browser. Press and hold it to choose a layout.
3. Capture: in the browser, select some text, then tap Capture. The page, the text, its DOI if it has one, and a thumbnail are saved to the trail.
4. Full text: on a scholarly article with a DOI (for example https://doi.org/10.1371/journal.pone.0000308), a Full text button appears. To find a free legal copy, turn it on in Settings → Full text for papers and enter any email address (Unpaywall asks for one). The "Through your library" and doi.org links work without setup.
5. Share: on the trail screen, tap Share to send the trail as a .trail.md text file through the system share sheet.

AI (optional):
- New installs use "Demo", which runs on the device. It only picks sentences from the page and labels every answer as a demo. Nothing is sent. To try it, open any article, tap Suggest, then Ask AI, then Summarize.
- People can add their own Grok (xAI) API key, or the address of their own model server, in Settings → AI. Before any page text is sent, NODE asks for consent and names the provider (guideline 5.1.2(i)). Consent can be withdrawn in Settings → AI.
- Every AI answer has a ⚑ Report button that opens a pre-filled email to the developer.

Permissions:
- Local network: requested only if the person adds a model server on their own network. Reviewers don't need to test this.
- Camera, microphone and location are used only when a website asks; the system asks first.

Scripts in pages: NODE injects scripts that are bundled in the app. They read the page's keywords, DOI and selected text, center and mute videos, and report scrolling. NODE does not download or run code from a server. Messages from pages are checked against a fixed list of types and can't reach files, keys or settings.

Data: NODE has no accounts and no analytics. Trails and settings stay on the device. Settings → Your data → Delete all NODE data removes everything.

Contact: [CONTACT EMAIL]
