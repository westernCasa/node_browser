# Decision log

Questions we asked while building NODE Research Browser, and what we decided. Newest first. This file builds the page at https://noderesearch.app/log:

    python3 docs/media/src/build-log.py docs/decision-log.md site

Each entry: `## YYYY-MM-DD · The question`, then `Status:` (Decided, Proposed, Open, Parked or In progress), `Decision:`, `Why:`, and optionally `Next:` and `Read:` (a link). One plain sentence or two per field.

## 2026-11-18 · How do we know if people come back, without tracking them?
Status: Open
Decision: Not decided. The proposal is to add a "days since install" bucket (0, 1, 2 to 7, 8 to 30, 31 and up) to the anonymous daily count.
Why: The daily count has no id, so it can't tell a new user from an old one. A bucket with no id gives a retention curve across everyone without following anyone.
Next: Until this is decided, the 5-person usability test is the only measure of the first week.

## 2026-11-18 · What should the first five minutes of NODE feel like?
Status: Proposed
Decision: First launch asks "What are you looking into?" instead of asking for API keys. Every way in ends with a trail of 3 cards, the canvas open, and an offer to send it.
Why: Today the first screen is a setup form, and the trail, the part that makes NODE different, shows up later on a screen nobody is pointed to.
Next: Build for 0.13 and test with 5 people. Pass: 4 of 5 reach 3 cards and the canvas without help in under 5 minutes.

## 2026-11-18 · How far do we go to make NODE a habit?
Status: Proposed
Decision: No feed, no streaks, no fake urgency, a switch for every notice kind, and first-week events counted only on the user's computer. A change that raises visits but also raises opt-outs gets rolled back.
Why: People chose NODE partly for privacy, and long experiments at Facebook and Pinterest found that pushing harder loses people over months.

## 2026-11-18 · Should syncing between devices need an account?
Status: Decided
Decision: No. Devices pair with a code or QR code, and trails are encrypted on the device before they're sent. The server deletes each change once the other devices have it, after 30 days at most. Shipped in 0.12.0.
Why: An account would be the first thing NODE knows about a person. A pairing code is enough to prove two devices belong together.
Read: https://github.com/westernCasa/node_browser/releases/tag/v0.12.0

## 2026-11-15 · Should NODE count how many people use it?
Status: Decided
Decision: Yes, with one anonymous count a day: the version and the operating system, with no id. It can be turned off in Settings → Help. Shipped in 0.11.0.
Why: Download numbers don't say whether anyone kept using NODE. Nothing about what people read or search is sent.
Read: https://github.com/westernCasa/node_browser/releases/tag/v0.11.0

## 2026-11-06 · How many notifications should NODE send?
Status: Decided
Decision: Few, and only about something new. A weekly budget across all kinds, a switch for each kind, system permission asked on day 3 or later, and opt-outs as the measure instead of clicks.
Why: Long experiments found that fewer, more relevant notifications raise use over time, while more of them raise visits for a while and then raise opt-outs.

## 2026-11-05 · Who is NODE for?
Status: Decided
Decision: Knowledge networking between peers and small groups: one person maps what they read, and sends the whole trail to a friend or a group as one file.
Why: Research gets passed on as a list of links, and the next person starts over. NODE already records the path, so sending it needs no copying.

## 2026-11-05 · What should NODE be called?
Status: Decided
Decision: NODE Research Browser. Scout and NODE R-X were dropped.
Why: "Research Browser" says what it is. "Node Browser" alone collides with Node.js, and an X in the name reads as a tie to xAI.

## 2026-11-05 · Do we share trails as links or as files?
Status: Decided
Decision: As one plain Markdown file first. Links come once the share server works for everyone.
Why: A file works today, anyone can read it in a text editor, and it outlives the app.

## 2026-11-03 · Should two people's trails merge into one?
Status: Parked
Decision: Not yet. The work goes to one person building a trail and sharing it. When merging comes back, it starts with showing both trails on one canvas before combining anything.
Why: No study was found on whether people understand two merged research maps, and Git-style merging is a model most researchers don't share.

## 2026-11-03 · Is a trail a timeline or a map?
Status: Decided
Decision: A canvas, with the timeline kept beside it and Replay for whoever receives it. NODE draws the links it already knows; drawing your own is optional.
Why: In studies people rarely draw links by hand, and a bare map has no clear starting point. A map plus a replay of how it was built gave 71% of facts understood at handoff, against 50%.

## 2026-10-25 · Can NODE run Chrome extensions?
Status: Decided
Decision: No. Instead, NODE's built-in blocker uses the filter lists uBlock Origin uses by default.
Why: Electron loads extensions but lacks the APIs ad blockers need, and the one path that works conflicts with NODE's own blocker.

## 2026-10-18 · Electron or a Chromium build?
Status: In progress
Decision: Electron stays the release build. A Chromium build on ungoogled-chromium has started, mainly so Google sign-in works inside NODE.
Why: Google blocks sign-in inside Electron apps, and faking Chrome breaks Google's terms. Mosaic and address-bar suggestions need Chromium patches, so the switch waits until it reaches parity.
