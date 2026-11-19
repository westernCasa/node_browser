---
node-trail: 2
id: trail-node-blog
name: Building NODE
exported-by: Sven
exported-at: 2026-11-18T12:00:00Z
start-here: q13
---
# Building NODE

I'm Sven, and I make NODE. This blog is a NODE trail: each question I ran into is a card, and my answer is the note linked to it.

**Start here:** [How do I know if people come back, without tracking them?](#q13)

## Who it's for
<!-- group:g1 at:0,0 size:1140x1164 -->

### ? What should the first five minutes of NODE feel like?
<!-- id:q12 type:question at:40,60 size:300x166 -->
Status: open
- Sven: Proposed, 18 Nov 2026

### Note
<!-- id:n12 type:note at:400,60 size:380x296 -->
Plan: I want first launch to ask "What are you looking into?" instead of asking for API keys. Every way in should end with a trail of 3 cards, the canvas open, and an offer to send it. Why: Right now the first screen is a setup form. The trail, the part that makes NODE different, shows up later on a screen I never point anyone to. Next: I'm aiming to build it for 0.13 and test it with 5 people. It passes if 4 of 5 get to 3 cards and the canvas on their own in under 5 minutes.
— Sven · nov 18

### ? How far do I go to make NODE a habit?
<!-- id:q11 type:question at:40,396 size:300x144 -->
Status: open
- Sven: Proposed, 18 Nov 2026

### Note
<!-- id:n11 type:note at:400,396 size:380x256 -->
Plan: No feed, no streaks and no fake urgency. Every kind of notice gets its own switch, and first-week milestones are counted only on your computer. If a change brings more visits but also more people turning notices off, I roll it back. Why: A lot of you picked NODE for privacy. And the long experiments I read, at Facebook and Pinterest, found that pushing harder loses people over a few months.
— Sven · nov 18

### ? Who is NODE for?
<!-- id:q7 type:question at:40,692 size:300x122 -->
Status: resolved
- Sven: Decided, 5 Nov 2026

### Note
<!-- id:n7 type:note at:400,692 size:380x216 -->
Decided: Knowledge networking between friends and small groups. You map what you read, and send the whole trail to a friend or a group as one file. Why: Research usually gets passed on as a list of links, and the next person starts over. NODE already records the path, so sending it takes no copying.
— Sven · nov 5

### ? What should NODE be called?
<!-- id:q6 type:question at:40,948 size:300x144 -->
Status: resolved
- Sven: Decided, 5 Nov 2026

### Note
<!-- id:n6 type:note at:400,948 size:380x176 -->
Decided: NODE Research Browser. I dropped Scout and NODE R-X. Why: "Research Browser" says what it is. "Node Browser" on its own collides with Node.js, and an X in the name reads as a tie to xAI.
— Sven · nov 5

## Sharing
<!-- group:g2 at:1220,0 size:1140x808 -->

### ? Do I share trails as links or as files?
<!-- id:q5 type:question at:1260,60 size:300x144 -->
Status: resolved
- Sven: Decided, 5 Nov 2026

### Note
<!-- id:n5 type:note at:1620,60 size:380x156 -->
Decided: As one plain Markdown file first. Links come once the share server works for everyone. Why: A file works today, anyone can read it in a text editor, and it outlives the app.
— Sven · nov 5

### ? Should two people's trails merge into one?
<!-- id:q4 type:question at:1260,256 size:300x144 -->
Status: open
- Sven: Parked, 3 Nov 2026

### Note
<!-- id:n4 type:note at:1620,256 size:380x236 -->
For now: Not yet. I'm focusing on one person building a trail and sharing it. When merging comes back, it starts with showing both trails on one canvas before combining anything. Why: I couldn't find a study on whether people understand two merged research maps. Git-style merging makes sense to developers, but most people researching together don't think that way.
— Sven · nov 3

### ? Is a trail a timeline or a map?
<!-- id:q3 type:question at:1260,532 size:300x144 -->
Status: resolved
- Sven: Decided, 3 Nov 2026

### Note
<!-- id:n3 type:note at:1620,532 size:380x236 -->
Decided: A canvas, with the timeline kept beside it and Replay for whoever receives it. NODE draws the links it already knows. Drawing your own is optional. Why: In the studies I read, people rarely draw links by hand, and a bare map has no clear place to start. A map plus a replay of how it was built got 71% of the facts across at handoff, against 50%.
— Sven · nov 3

## Privacy
<!-- group:g3 at:1220,888 size:1140x1184 -->

### ? How do I know if people come back, without tracking them?
<!-- id:q13 type:question at:1260,948 size:300x166 -->
Status: open
- Sven: Open, 18 Nov 2026

### Note
<!-- id:n13 type:note at:1620,948 size:380x276 -->
Thinking: I haven't decided yet. What I'm weighing is adding a "days since install" bucket (0, 1, 2 to 7, 8 to 30, 31 and up) to the anonymous daily count. Why: The daily count has no id, so it can't tell a new user from an old one. A bucket with no id would show me how many people stick around without following anyone. Next: Until I decide, a 5-person usability test is the only way I'll know how the first week goes.
— Sven · nov 18

### ? Should syncing between devices need an account?
<!-- id:q10 type:question at:1260,1264 size:300x144 -->
Status: resolved
- Sven: Decided, 18 Nov 2026

### Note
<!-- id:n10 type:note at:1620,1264 size:380x236 -->
Decided: No. You pair devices with a code or a QR code, and your trails are encrypted on your device before they're sent. The server deletes each change once your other devices have it, after 30 days at most. This shipped in 0.12.0. Why: An account would be the first thing NODE knows about you. A pairing code is enough to prove two devices belong together.
— Sven · nov 18

### [NODE 0.12.0 release notes](https://github.com/westernCasa/node_browser/releases/tag/v0.12.0)
<!-- id:p10 type:page at:2060,1264 size:260x150 -->
Where this shipped.

### ? Should NODE count how many people use it?
<!-- id:q9 type:question at:1260,1540 size:300x144 -->
Status: resolved
- Sven: Decided, 15 Nov 2026

### Note
<!-- id:n9 type:note at:1620,1540 size:380x196 -->
Decided: Yes, with one anonymous count a day: the version and your operating system, with no id. You can turn it off in Settings → Help. This shipped in 0.11.0. Why: Download numbers didn't tell me whether anyone kept using NODE. Nothing about what you read or search is sent.
— Sven · nov 15

### [NODE 0.11.0 release notes](https://github.com/westernCasa/node_browser/releases/tag/v0.11.0)
<!-- id:p9 type:page at:2060,1540 size:260x150 -->
Where this shipped.

### ? How many notifications should NODE send?
<!-- id:q8 type:question at:1260,1776 size:300x144 -->
Status: resolved
- Sven: Decided, 6 Nov 2026

### Note
<!-- id:n8 type:note at:1620,1776 size:380x256 -->
Decided: Few, and only about something new. There's a weekly limit across all kinds, a switch for each kind, and I'll only ask for system permission on day 3 or later. I judge them by how many people turn them off, not by clicks. Why: The long experiments I read found that fewer, more relevant notifications raise use over time. More of them raise visits for a while, then more people opt out.
— Sven · nov 6

## Engine
<!-- group:g4 at:0,1244 size:1140x572 -->

### ? Can NODE run Chrome extensions?
<!-- id:q2 type:question at:40,1304 size:300x144 -->
Status: resolved
- Sven: Decided, 25 Oct 2026

### Note
<!-- id:n2 type:note at:400,1304 size:380x196 -->
Decided: No. Instead, NODE's built-in blocker uses the same filter lists uBlock Origin uses by default. Why: A beta tester asked for uBlock Origin. Electron loads extensions but is missing the parts ad blockers need, and the one way that works clashes with NODE's own blocker.
— Sven · oct 25

### ? Electron or a Chromium build?
<!-- id:q1 type:question at:40,1540 size:300x144 -->
Status: open
- Sven: In progress, 18 Oct 2026

### Note
<!-- id:n1 type:note at:400,1540 size:380x236 -->
So far: Electron stays the release build. I've started a Chromium build on ungoogled-chromium, mainly so Google sign-in works inside NODE. Why: Google blocks sign-in inside Electron apps, and faking Chrome breaks Google's terms. Mosaic and the address-bar suggestions need changes to Chromium itself, so I'll only switch once it does everything the current build does.
— Sven · oct 18

## Links

- [Plan: I want first launch to ask "What are you looking into?" instead of asking for API keys](#n12) → [What should the first five minutes of NODE feel like?](#q12) · drawn · plan <!-- from:n12 to:q12 kind:you -->
- [Plan: No feed, no streaks and no fake urgency](#n11) → [How far do I go to make NODE a habit?](#q11) · drawn · plan <!-- from:n11 to:q11 kind:you -->
- [Decided: Knowledge networking between friends and small groups](#n7) → [Who is NODE for?](#q7) · drawn · decided <!-- from:n7 to:q7 kind:you -->
- [Decided: NODE Research Browser](#n6) → [What should NODE be called?](#q6) · drawn · decided <!-- from:n6 to:q6 kind:you -->
- [Decided: As one plain Markdown file first](#n5) → [Do I share trails as links or as files?](#q5) · drawn · decided <!-- from:n5 to:q5 kind:you -->
- [For now: Not yet](#n4) → [Should two people's trails merge into one?](#q4) · drawn · for now <!-- from:n4 to:q4 kind:you -->
- [Decided: A canvas, with the timeline kept beside it and Replay for whoever receives it](#n3) → [Is a trail a timeline or a map?](#q3) · drawn · decided <!-- from:n3 to:q3 kind:you -->
- [Thinking: I haven't decided yet](#n13) → [How do I know if people come back, without tracking them?](#q13) · drawn · thinking <!-- from:n13 to:q13 kind:you -->
- [Decided: No](#n10) → [Should syncing between devices need an account?](#q10) · drawn · decided <!-- from:n10 to:q10 kind:you -->
- [Decided: No](#n10) → [NODE 0.12.0 release notes](#p10) · shipped in <!-- from:n10 to:p10 kind:auto -->
- [Decided: Yes, with one anonymous count a day: the version and your operating system, with no id](#n9) → [Should NODE count how many people use it?](#q9) · drawn · decided <!-- from:n9 to:q9 kind:you -->
- [Decided: Yes, with one anonymous count a day: the version and your operating system, with no id](#n9) → [NODE 0.11.0 release notes](#p9) · shipped in <!-- from:n9 to:p9 kind:auto -->
- [Decided: Few, and only about something new](#n8) → [How many notifications should NODE send?](#q8) · drawn · decided <!-- from:n8 to:q8 kind:you -->
- [Decided: No](#n2) → [Can NODE run Chrome extensions?](#q2) · drawn · decided <!-- from:n2 to:q2 kind:you -->
- [So far: Electron stays the release build](#n1) → [Electron or a Chromium build?](#q1) · drawn · so far <!-- from:n1 to:q1 kind:you -->
