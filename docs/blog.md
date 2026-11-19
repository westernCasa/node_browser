# Blog

Sven's notes on the questions I ask while building NODE Research Browser, and what I decide. Newest first. First person, plain words, Canadian spelling. This file builds https://noderesearch.app/blog, which shows the blog as a NODE trail canvas, and blog.trail.md, the same trail as a file NODE opens:

    python3 docs/media/src/build-blog.py docs/blog.md site

Each post: `## YYYY-MM-DD · The question`, then `Topic:` (a group on the canvas: Who it's for, Privacy, Sharing, Engine, or a new one), `Status:` (Decided, Proposed, Open, Parked or In progress), `Decision:`, `Why:`, and optionally `Next:` and `Read:` (a link). One to three short sentences per field.

## 2026-11-18 · How do I know if people come back, without tracking them?
Topic: Privacy
Status: Open
Decision: I haven't decided yet. What I'm weighing is adding a "days since install" bucket (0, 1, 2 to 7, 8 to 30, 31 and up) to the anonymous daily count.
Why: The daily count has no id, so it can't tell a new user from an old one. A bucket with no id would show me how many people stick around without following anyone.
Next: Until I decide, a 5-person usability test is the only way I'll know how the first week goes.

## 2026-11-18 · What should the first five minutes of NODE feel like?
Topic: Who it's for
Status: Proposed
Decision: I want first launch to ask "What are you looking into?" instead of asking for API keys. Every way in should end with a trail of 3 cards, the canvas open, and an offer to send it.
Why: Right now the first screen is a setup form. The trail, the part that makes NODE different, shows up later on a screen I never point anyone to.
Next: I'm aiming to build it for 0.13 and test it with 5 people. It passes if 4 of 5 get to 3 cards and the canvas on their own in under 5 minutes.

## 2026-11-18 · How far do I go to make NODE a habit?
Topic: Who it's for
Status: Proposed
Decision: No feed, no streaks and no fake urgency. Every kind of notice gets its own switch, and first-week milestones are counted only on your computer. If a change brings more visits but also more people turning notices off, I roll it back.
Why: A lot of you picked NODE for privacy. And the long experiments I read, at Facebook and Pinterest, found that pushing harder loses people over a few months.

## 2026-11-18 · Should syncing between devices need an account?
Topic: Privacy
Status: Decided
Decision: No. You pair devices with a code or a QR code, and your trails are encrypted on your device before they're sent. The server deletes each change once your other devices have it, after 30 days at most. This shipped in 0.12.0.
Why: An account would be the first thing NODE knows about you. A pairing code is enough to prove two devices belong together.
Read: https://github.com/westernCasa/node_browser/releases/tag/v0.12.0

## 2026-11-15 · Should NODE count how many people use it?
Topic: Privacy
Status: Decided
Decision: Yes, with one anonymous count a day: the version and your operating system, with no id. You can turn it off in Settings → Help. This shipped in 0.11.0.
Why: Download numbers didn't tell me whether anyone kept using NODE. Nothing about what you read or search is sent.
Read: https://github.com/westernCasa/node_browser/releases/tag/v0.11.0

## 2026-11-06 · How many notifications should NODE send?
Topic: Privacy
Status: Decided
Decision: Few, and only about something new. There's a weekly limit across all kinds, a switch for each kind, and I'll only ask for system permission on day 3 or later. I judge them by how many people turn them off, not by clicks.
Why: The long experiments I read found that fewer, more relevant notifications raise use over time. More of them raise visits for a while, then more people opt out.

## 2026-11-05 · Who is NODE for?
Topic: Who it's for
Status: Decided
Decision: Knowledge networking between friends and small groups. You map what you read, and send the whole trail to a friend or a group as one file.
Why: Research usually gets passed on as a list of links, and the next person starts over. NODE already records the path, so sending it takes no copying.

## 2026-11-05 · What should NODE be called?
Topic: Who it's for
Status: Decided
Decision: NODE Research Browser. I dropped Scout and NODE R-X.
Why: "Research Browser" says what it is. "Node Browser" on its own collides with Node.js, and an X in the name reads as a tie to xAI.

## 2026-11-05 · Do I share trails as links or as files?
Topic: Sharing
Status: Decided
Decision: As one plain Markdown file first. Links come once the share server works for everyone.
Why: A file works today, anyone can read it in a text editor, and it outlives the app.

## 2026-11-03 · Should two people's trails merge into one?
Topic: Sharing
Status: Parked
Decision: Not yet. I'm focusing on one person building a trail and sharing it. When merging comes back, it starts with showing both trails on one canvas before combining anything.
Why: I couldn't find a study on whether people understand two merged research maps. Git-style merging makes sense to developers, but most people researching together don't think that way.

## 2026-11-03 · Is a trail a timeline or a map?
Topic: Sharing
Status: Decided
Decision: A canvas, with the timeline kept beside it and Replay for whoever receives it. NODE draws the links it already knows. Drawing your own is optional.
Why: In the studies I read, people rarely draw links by hand, and a bare map has no clear place to start. A map plus a replay of how it was built got 71% of the facts across at handoff, against 50%.

## 2026-10-25 · Can NODE run Chrome extensions?
Topic: Engine
Status: Decided
Decision: No. Instead, NODE's built-in blocker uses the same filter lists uBlock Origin uses by default.
Why: A beta tester asked for uBlock Origin. Electron loads extensions but is missing the parts ad blockers need, and the one way that works clashes with NODE's own blocker.

## 2026-10-18 · Electron or a Chromium build?
Topic: Engine
Status: In progress
Decision: Electron stays the release build. I've started a Chromium build on ungoogled-chromium, mainly so Google sign-in works inside NODE.
Why: Google blocks sign-in inside Electron apps, and faking Chrome breaks Google's terms. Mosaic and the address-bar suggestions need changes to Chromium itself, so I'll only switch once it does everything the current build does.
