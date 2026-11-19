---
node-trail: 2
id: trail-node-blog
name: Building NODE
exported-by: Sven
exported-at: 2026-11-18T12:00:00Z
start-here: q14
---
# Building NODE

I'm Sven, and I make NODE. This blog is a NODE trail: each question I ran into is a card with the options I looked at, and my answer is the note linked to it.

**Start here:** [What brings people back after the first day?](#q14)

## First week
<!-- group:g1 at:0,0 size:1240x2620 -->

### ? How do I test these changes?
<!-- id:q15 type:question at:40,60 size:400x498 -->
Status: resolved
- Sven: Decided, 18 Nov 2026
- Sven: Option: A/B test the three biggest changes, one at a time, on new installs. Chosen. It shows whether each change works, not just whether people like it.
- Sven: Option: Usability tests with 5 people. Also doing. They explain why something works or doesn't, but they're too few to count.
- Sven: Option: Ship to everyone and compare before and after. Dropped. Other changes and the time of year would mix into the numbers.
- Sven: Option: Only count people who opt in. Dropped. Too few people, and only the most engaged ones.

### Note
<!-- id:n15 type:note at:500,60 size:380x416 -->
Decided: I'll A/B test the first screen, the first-card note and the Continue page, one at a time, on new installs from 0.13. Each test only looks for a big difference, because NODE doesn't have the traffic to see small ones yet. I'll set the sample size before each test starts, decide once it's reached, and post the result here, win or not. Why: These are my biggest guesses about the first week, and I'd rather know than assume. Existing users won't be in any test, and Settings will say which version you're in, with a switch to leave. Next: Nothing gets built until I've designed the screens for it and I'm happy with them. Then the first screen goes first, in 0.13. The count these tests need is decided in "Can NODE send one count after your first session?"
— Sven · nov 18

### ? What brings people back after the first day?
<!-- id:q14 type:question at:40,598 size:400x540 -->
Status: open
- Sven: Proposed, 18 Nov 2026
- Sven: Option: A Continue page on every new tab, with your open questions and the next search. Leaning. It shows up when you're already in NODE and can act on it.
- Sven: Option: System notifications, including one if you skip a day you usually use NODE. Later. Only after the Continue page, and under the notification limits.
- Sven: Option: A weekly email. Dropped. It would need your email address, and NODE has no accounts.
- Sven: Option: Nothing, and rely on tabs reopening. Dropped. It gives no reason to come back.

### Note
<!-- id:n14 type:note at:500,598 size:380x256 -->
Plan: A Continue page that replaces the blank new tab. It shows your open trails, each with its open question and the next suggested search. Why: An open question is the best reason to come back, and the new tab is the moment you can act on it. Notifications that do the job forever, without that reason, wear thin. Next: Aiming for 0.14, as an A/B test against a blank new tab.
— Sven · nov 18

### ? How should you notice your first card?
<!-- id:q13 type:question at:40,1178 size:400x452 -->
Status: open
- Sven: Proposed, 18 Nov 2026
- Sven: Option: A short note and one pulse on the Canvas tab. Leaning. It turns something that happens silently into something you see, then gets out of the way.
- Sven: Option: Stay silent and let people find the canvas. Dropped. That's how it works now, and most people never see the main thing NODE does.
- Sven: Option: A "3 cards to your first trail" checklist. Later. Unfinished tasks can pull people back, but the evidence for it is mixed and it feels like a game. I'll only try it if the note doesn't work.

### Note
<!-- id:n13 type:note at:500,1178 size:380x216 -->
Plan: After about 20 seconds of reading, a short note says "First card on your trail" and the Canvas tab pulses once. At 3 cards, one notice offers to show the trail. Why: Today a page becomes a card with no sign at all. Next: Part of the 0.13 first run, as an A/B test against staying silent.
— Sven · nov 18

### ? What should the first five minutes of NODE feel like?
<!-- id:q12 type:question at:40,1670 size:400x614 -->
Status: open
- Sven: Proposed, 18 Nov 2026
- Sven: Option: A start screen that asks "What are you looking into?". Leaning. Setup waits until you need it, and you get to something useful faster. Example questions help if you don't have one in mind.
- Sven: Option: Open a finished example trail first. Also offered. Shows what a trail looks like, but it's watching instead of doing, so it's a link on the start screen, not the default.
- Sven: Option: No start screen, just a helpful empty first tab. Fallback. Simpler. I'll test it against the start screen to see if the extra screen earns its place.
- Sven: Option: Keep the setup form, cut to one screen with Skip. Dropped. It still asks for things before you've seen anything worth it, and most people keep the defaults anyway.

### Note
<!-- id:n12 type:note at:500,1670 size:380x276 -->
Plan: I want first launch to ask "What are you looking into?" instead of asking for API keys. Every way in should end with a trail of 3 cards, the canvas open, and an offer to send it. Why: Right now the first screen is a setup form. The trail, the part that makes NODE different, shows up later on a screen I never point anyone to. Next: I'm aiming to build it for 0.13 and A/B test it against the empty first tab, alongside a 5-person usability test.
— Sven · nov 18

### ? How far do I go to make NODE a habit?
<!-- id:q11 type:question at:40,2324 size:400x154 -->
Status: open
- Sven: Proposed, 18 Nov 2026

### Note
<!-- id:n11 type:note at:500,2324 size:380x256 -->
Plan: No feed, no streaks and no fake urgency. Every kind of notice gets its own switch, and first-week milestones are counted only on your computer. If a change brings more visits but also more people turning notices off, I roll it back. Why: A lot of you picked NODE for privacy. And the long experiments I read, at Facebook and Pinterest, found that pushing harder loses people over a few months.
— Sven · nov 18

## Who it's for
<!-- group:g2 at:1320,0 size:1240x858 resolved -->

### ? Who is NODE for?
<!-- id:q7 type:question at:1360,60 size:400x312 -->
Status: resolved
- Sven: Decided, 5 Nov 2026
- Sven: Option: A browser for one person doing niche research. Dropped. Where NODE started.
- Sven: Option: Knowledge networking between friends and small groups. Chosen. You map what you read, and send the whole trail on.

### Note
<!-- id:n7 type:note at:1820,60 size:380x216 -->
Decided: Knowledge networking between friends and small groups. You map what you read, and send the whole trail to a friend or a group as one file. Why: Research usually gets passed on as a list of links, and the next person starts over. NODE already records the path, so sending it takes no copying.
— Sven · nov 5

### ? What should NODE be called?
<!-- id:q6 type:question at:1360,412 size:400x406 -->
Status: resolved
- Sven: Decided, 5 Nov 2026
- Sven: Option: Scout. Dropped.
- Sven: Option: NODE R-X Browser. Dropped. An X in the name reads as a tie to xAI.
- Sven: Option: Node Browser. Dropped. It collides with Node.js.
- Sven: Option: NODE Research Browser. Chosen. It says what it is.

### Note
<!-- id:n6 type:note at:1820,412 size:380x116 -->
Decided: NODE Research Browser. Why: "Research Browser" says what it is.
— Sven · nov 5

## Sharing
<!-- group:g3 at:1320,938 size:1240x1344 -->

### ? Do I share trails as links or as files?
<!-- id:q5 type:question at:1360,998 size:400x332 -->
Status: resolved
- Sven: Decided, 5 Nov 2026
- Sven: Option: One plain Markdown file. Chosen. Works today, anyone can read it in a text editor, and it outlives the app.
- Sven: Option: A share link. Later. Needs the share server running for everyone first.

### Note
<!-- id:n5 type:note at:1820,998 size:380x156 -->
Decided: As one plain Markdown file first. Links come once the share server works for everyone. Why: A file works today, anyone can read it in a text editor, and it outlives the app.
— Sven · nov 5

### ? Should two people's trails merge into one?
<!-- id:q4 type:question at:1360,1370 size:400x418 -->
Status: open
- Sven: Parked, 3 Nov 2026
- Sven: Option: Merge two trails into one. Parked. I couldn't find any study on whether people understand two merged research maps.
- Sven: Option: One person builds a trail and shares it. Chosen. The part people need first.
- Sven: Option: Show both trails on one canvas, then add chosen cards, then full merge. Later. The order to try when merging comes back.

### Note
<!-- id:n4 type:note at:1820,1370 size:380x176 -->
For now: Not yet. I'm focusing on one person building a trail and sharing it. Why: Git-style merging makes sense to developers, but most people researching together don't think that way.
— Sven · nov 3

### ? Is a trail a timeline or a map?
<!-- id:q3 type:question at:1360,1828 size:400x414 -->
Status: resolved
- Sven: Decided, 3 Nov 2026
- Sven: Option: A timeline only. Dropped. Research doesn't happen in a straight line.
- Sven: Option: A map only. Dropped. A bare map has no clear place to start for whoever receives it.
- Sven: Option: A canvas with the timeline beside it, and Replay. Chosen. A map plus a replay of how it was built got 71% of the facts across at handoff, against 50%.

### Note
<!-- id:n3 type:note at:1820,1828 size:380x196 -->
Decided: A canvas, with the timeline kept beside it and Replay for whoever receives it. NODE draws the links it already knows. Drawing your own is optional. Why: In the studies I read, people rarely draw links by hand, so NODE draws the ones it knows.
— Sven · nov 3

## Privacy
<!-- group:g4 at:1320,2362 size:1240x2234 resolved -->

### ? Can NODE send one count after your first session?
<!-- id:q17 type:question at:1360,2422 size:400x416 -->
Status: resolved
- Sven: Decided, 18 Nov 2026
- Sven: Option: One anonymous count after your first session. Chosen. It's the only way to tell whether a test version helps, and it carries no id.
- Sven: Option: Only count people who opt in. Dropped. Too few people, and only the most engaged ones.
- Sven: Option: No A/B tests, only usability tests. Dropped. Five people can show me why something fails, but not whether a change helps most people.

### Note
<!-- id:n17 type:note at:1820,2422 size:380x356 -->
Decided: Yes. After your first session, NODE sends one anonymous count: which test version you're in, and yes or no for reaching 3 cards, opening the canvas, and sending a trail or pairing a device. There's no id, and nothing about what you read or search. The same switch in Settings → Help turns it off. Why: Without it I'd be running tests I can't read. It's more than NODE sends today, so it'll be said plainly on the welcome screen, in the privacy page and in the release notes before it ships. Next: It ships with the first test, in 0.13. The site's privacy section changes in that release, not before.
— Sven · nov 18

### ? How do I know if people come back, without tracking them?
<!-- id:q16 type:question at:1360,2878 size:400x576 -->
Status: resolved
- Sven: Decided, 18 Nov 2026
- Sven: Option: Add a "days since install" bucket to the anonymous daily count. Chosen. It gives a rough curve of how long people stay, but it can't tell which week someone started, so I'll label it an estimate.
- Sven: Option: Keep first-week milestones on your computer, with an opt-in to share a summary. Also doing. It's the only way to check whether my guess about the "aha" moment is right, and it's off unless you turn it on.
- Sven: Option: Usability tests with 5 people. Also doing. Good for finding out why, not for counting.
- Sven: Option: An install id. Dropped. That's tracking, and a lot of you picked NODE for privacy.

### Note
<!-- id:n16 type:note at:1820,2878 size:380x256 -->
Decided: The daily count gets a "days since install" bucket and the test version. First-week milestones stay on your computer unless you choose to share a summary. Why: The daily count has no id, so it can't tell a new user from an old one. Picking the moment that makes people stay without any data to check it would be a guess. Next: Both are on the backlog for 0.13, after their screens are designed.
— Sven · nov 18

### ? Should syncing between devices need an account?
<!-- id:q10 type:question at:1360,3494 size:400x332 -->
Status: resolved
- Sven: Decided, 18 Nov 2026
- Sven: Option: Pair devices with a code or a QR code. Chosen. Nothing about you is needed, and the code stays on your devices.
- Sven: Option: Sign in with an account. Dropped. It would be the first thing NODE knows about you.

### Note
<!-- id:n10 type:note at:1820,3494 size:380x216 -->
Decided: No. You pair devices with a code or a QR code, and your trails are encrypted on your device before they're sent. The server deletes each change once your other devices have it, after 30 days at most. This shipped in 0.12.0. Why: A pairing code is enough to prove two devices belong together.
— Sven · nov 18

### [NODE 0.12.0 release notes](https://github.com/westernCasa/node_browser/releases/tag/v0.12.0)
<!-- id:p10 type:page at:2260,3494 size:260x150 -->
Where this shipped.

### ? Should NODE count how many people use it?
<!-- id:q9 type:question at:1360,3866 size:400x154 -->
Status: resolved
- Sven: Decided, 15 Nov 2026

### Note
<!-- id:n9 type:note at:1820,3866 size:380x196 -->
Decided: Yes, with one anonymous count a day: the version and your operating system, with no id. You can turn it off in Settings → Help. This shipped in 0.11.0. Why: Download numbers didn't tell me whether anyone kept using NODE. Nothing about what you read or search is sent.
— Sven · nov 15

### [NODE 0.11.0 release notes](https://github.com/westernCasa/node_browser/releases/tag/v0.11.0)
<!-- id:p9 type:page at:2260,3866 size:260x150 -->
Where this shipped.

### ? How many notifications should NODE send?
<!-- id:q8 type:question at:1360,4102 size:400x454 -->
Status: resolved
- Sven: Decided, 6 Nov 2026
- Sven: Option: Send more to bring people back. Dropped. It raises visits for a while, then more people turn notifications off or uninstall.
- Sven: Option: A weekly limit, only for something new, with a switch per kind. Chosen. The long experiments found this does better over months.
- Sven: Option: Ask for permission at first launch. Dropped. Asking after a few days of use did better in the research.

### Note
<!-- id:n8 type:note at:1820,4102 size:380x236 -->
Decided: Few, and only about something new. There's a weekly limit across all kinds, a switch for each kind, and I'll only ask for system permission on day 3 or later. I judge them by how many people turn them off, not by clicks. Why: The long experiments I read found that fewer, more relevant notifications raise use over time.
— Sven · nov 6

## Engine
<!-- group:g5 at:0,2700 size:1240x1118 -->

### ? Can NODE run Chrome extensions?
<!-- id:q2 type:question at:40,2760 size:400x546 -->
Status: resolved
- Sven: Decided, 25 Oct 2026
- Sven: Option: Ship uBlock Origin itself. Dropped. Electron is missing the parts it needs, and it could break with any update.
- Sven: Option: Ship uBlock Origin Lite. Not possible. Electron doesn't enforce the blocking rules it relies on.
- Sven: Option: Support the Chrome Web Store. Dropped. Most extensions would half-work.
- Sven: Option: Use uBlock Origin's default filter lists in NODE's own blocker. Chosen. Covers what most people use it for.
- Sven: Option: A Chromium build, which runs extensions. Later. Part of the engine question.

### Note
<!-- id:n2 type:note at:500,2760 size:380x176 -->
Decided: No. Instead, NODE's built-in blocker uses the same filter lists uBlock Origin uses by default. Why: A beta tester asked for uBlock Origin, and this covers what they used it for without breaking NODE's own blocker.
— Sven · oct 25

### ? Electron or a Chromium build?
<!-- id:q1 type:question at:40,3346 size:400x432 -->
Status: open
- Sven: In progress, 18 Oct 2026
- Sven: Option: Ship NODE as a Chrome extension. Dropped. Mosaic, address-bar suggestions and the agent tools can't work in an extension.
- Sven: Option: Keep Electron for releases and build on Chromium alongside. Chosen. Google sign-in works on Chromium, and Electron keeps shipping meanwhile.
- Sven: Option: Build on BrowserOS. Dropped. Its licence (AGPL) doesn't fit NODE's MIT licence, so I went with ungoogled-chromium.

### Note
<!-- id:n1 type:note at:500,3346 size:380x236 -->
So far: Electron stays the release build. I've started a Chromium build on ungoogled-chromium, mainly so Google sign-in works inside NODE. Why: Google blocks sign-in inside Electron apps, and faking Chrome breaks Google's terms. Mosaic and the address-bar suggestions need changes to Chromium itself, so I'll only switch once it does everything the current build does.
— Sven · oct 18

## Links

- [Decided: I'll A/B test the first screen, the first-card note and the Continue page, one at a time, on new installs from 0.13](#n15) → [How do I test these changes?](#q15) · drawn · decided <!-- from:n15 to:q15 kind:you -->
- [Plan: A Continue page that replaces the blank new tab](#n14) → [What brings people back after the first day?](#q14) · drawn · plan <!-- from:n14 to:q14 kind:you -->
- [Plan: After about 20 seconds of reading, a short note says "First card on your trail" and the Canvas tab pulses once](#n13) → [How should you notice your first card?](#q13) · drawn · plan <!-- from:n13 to:q13 kind:you -->
- [Plan: I want first launch to ask "What are you looking into?" instead of asking for API keys](#n12) → [What should the first five minutes of NODE feel like?](#q12) · drawn · plan <!-- from:n12 to:q12 kind:you -->
- [Plan: No feed, no streaks and no fake urgency](#n11) → [How far do I go to make NODE a habit?](#q11) · drawn · plan <!-- from:n11 to:q11 kind:you -->
- [Decided: Knowledge networking between friends and small groups](#n7) → [Who is NODE for?](#q7) · drawn · decided <!-- from:n7 to:q7 kind:you -->
- [Decided: NODE Research Browser](#n6) → [What should NODE be called?](#q6) · drawn · decided <!-- from:n6 to:q6 kind:you -->
- [Decided: As one plain Markdown file first](#n5) → [Do I share trails as links or as files?](#q5) · drawn · decided <!-- from:n5 to:q5 kind:you -->
- [For now: Not yet](#n4) → [Should two people's trails merge into one?](#q4) · drawn · for now <!-- from:n4 to:q4 kind:you -->
- [Decided: A canvas, with the timeline kept beside it and Replay for whoever receives it](#n3) → [Is a trail a timeline or a map?](#q3) · drawn · decided <!-- from:n3 to:q3 kind:you -->
- [Decided: Yes](#n17) → [Can NODE send one count after your first session?](#q17) · drawn · decided <!-- from:n17 to:q17 kind:you -->
- [Decided: The daily count gets a "days since install" bucket and the test version](#n16) → [How do I know if people come back, without tracking them?](#q16) · drawn · decided <!-- from:n16 to:q16 kind:you -->
- [Decided: No](#n10) → [Should syncing between devices need an account?](#q10) · drawn · decided <!-- from:n10 to:q10 kind:you -->
- [Decided: No](#n10) → [NODE 0.12.0 release notes](#p10) · shipped in <!-- from:n10 to:p10 kind:auto -->
- [Decided: Yes, with one anonymous count a day: the version and your operating system, with no id](#n9) → [Should NODE count how many people use it?](#q9) · drawn · decided <!-- from:n9 to:q9 kind:you -->
- [Decided: Yes, with one anonymous count a day: the version and your operating system, with no id](#n9) → [NODE 0.11.0 release notes](#p9) · shipped in <!-- from:n9 to:p9 kind:auto -->
- [Decided: Few, and only about something new](#n8) → [How many notifications should NODE send?](#q8) · drawn · decided <!-- from:n8 to:q8 kind:you -->
- [Decided: No](#n2) → [Can NODE run Chrome extensions?](#q2) · drawn · decided <!-- from:n2 to:q2 kind:you -->
- [So far: Electron stays the release build](#n1) → [Electron or a Chromium build?](#q1) · drawn · so far <!-- from:n1 to:q1 kind:you -->
