# Blog

Sven's notes on the questions I ask while building NODE Research Browser, the options I looked at, and what I decide. Newest first. First person, plain words, Canadian spelling. This file builds https://noderesearch.app/blog, which shows the blog as a NODE trail canvas, and blog.trail.md, the same trail as a file NODE opens:

    python3 docs/media/src/build-blog.py docs/blog.md site

Each post: `## YYYY-MM-DD · The question`, then `Topic:` (a group on the canvas: Who it's for, First week, Privacy, Sharing, Engine, or a new one), `Status:` (Decided, Proposed, Open, Parked or In progress), any number of `Option:` lines, `Decision:`, `Why:`, and optionally `Next:` and `Read:` (a link). One to three short sentences per field.

An option line is `Option: Verdict | The option | Why, in one sentence`. Verdicts: Chosen, Leaning, Also offered, Also doing, Fallback, Later, Parked, Dropped, Not possible. The why is optional; leave it out rather than guess. Only list options that were really on the table.

## 2026-11-18 · Can NODE send one count after your first session?
Topic: Privacy
Status: Decided
Option: Chosen | One anonymous count after your first session | It's the only way to tell whether a test version helps, and it carries no id.
Option: Dropped | Only count people who opt in | Too few people, and only the most engaged ones.
Option: Dropped | No A/B tests, only usability tests | Five people can show me why something fails, but not whether a change helps most people.
Decision: Yes. After your first session, NODE sends one anonymous count: which test version you're in, and yes or no for reaching 3 cards, opening the canvas, and sending a trail or pairing a device. There's no id, and nothing about what you read or search. The same switch in Settings → Help turns it off.
Why: Without it I'd be running tests I can't read. It's more than NODE sends today, so it'll be said plainly on the welcome screen, in the privacy page and in the release notes before it ships.
Next: It ships with the first test, in 0.13. The site's privacy section changes in that release, not before.

## 2026-11-18 · How do I know if people come back, without tracking them?
Topic: Privacy
Status: Decided
Option: Chosen | Add a "days since install" bucket to the anonymous daily count | It gives a rough curve of how long people stay, but it can't tell which week someone started, so I'll label it an estimate.
Option: Also doing | Keep first-week milestones on your computer, with an opt-in to share a summary | It's the only way to check whether my guess about the "aha" moment is right, and it's off unless you turn it on.
Option: Also doing | Usability tests with 5 people | Good for finding out why, not for counting.
Option: Dropped | An install id | That's tracking, and a lot of you picked NODE for privacy.
Decision: The daily count gets a "days since install" bucket and the test version. First-week milestones stay on your computer unless you choose to share a summary.
Why: The daily count has no id, so it can't tell a new user from an old one. Picking the moment that makes people stay without any data to check it would be a guess.
Next: Both are on the backlog for 0.13, after their screens are designed.

## 2026-11-18 · How do I test these changes?
Topic: First week
Status: Decided
Option: Chosen | A/B test the three biggest changes at the same time, on new installs | It shows whether each change works, not just whether people like it, and all three answers come in together.
Option: Dropped | A/B test them one at a time
Option: Also doing | Usability tests with 5 people | They explain why something works or doesn't, but they're too few to count.
Option: Dropped | Ship to everyone and compare before and after | Other changes and the time of year would mix into the numbers.
Option: Dropped | Only count people who opt in | Too few people, and only the most engaged ones.
Decision: I'll A/B test the first screen, the first-card note and the Continue page all at once, on new installs from 0.13. Each new install gets its own coin flip for each change, so every test still compares half of new installs with the other half. Each test only looks for a big difference, because NODE doesn't have the traffic to see small ones yet. I'll set the sample size before each test starts, decide once it's reached, and post the result here, win or not.
Why: These are my biggest guesses about the first week, and I'd rather know than assume. Existing users won't be in any test, and Settings will say which version you're in, with a switch to leave.
Next: Nothing gets built until I've designed the screens for it and I'm happy with them. All three ship together in 0.13. The count these tests need is decided in "Can NODE send one count after your first session?"

## 2026-11-18 · What brings people back after the first day?
Topic: First week
Status: Proposed
Option: Leaning | A Continue page on every new tab, with your open questions and the next search | It shows up when you're already in NODE and can act on it.
Option: Later | System notifications, including one if you skip a day you usually use NODE | Only after the Continue page, and under the notification limits.
Option: Dropped | A weekly email | It would need your email address, and NODE has no accounts.
Option: Dropped | Nothing, and rely on tabs reopening | It gives no reason to come back.
Decision: A Continue page that replaces the blank new tab. It shows your open trails, each with its open question and the next suggested search.
Why: An open question is the best reason to come back, and the new tab is the moment you can act on it. Notifications that do the job forever, without that reason, wear thin.
Next: Aiming for 0.13, as an A/B test against a blank new tab, running alongside the other two tests.

## 2026-11-18 · How should you notice your first card?
Topic: First week
Status: Proposed
Option: Leaning | A short note and one pulse on the Canvas tab | It turns something that happens silently into something you see, then gets out of the way.
Option: Dropped | Stay silent and let people find the canvas | That's how it works now, and most people never see the main thing NODE does.
Option: Later | A "3 cards to your first trail" checklist | Unfinished tasks can pull people back, but the evidence for it is mixed and it feels like a game. I'll only try it if the note doesn't work.
Decision: After about 20 seconds of reading, a short note says "First card on your trail" and the Canvas tab pulses once. At 3 cards, one notice offers to show the trail.
Why: Today a page becomes a card with no sign at all.
Next: Part of the 0.13 first run, as an A/B test against staying silent.

## 2026-11-18 · What should the first five minutes of NODE feel like?
Topic: First week
Status: Proposed
Option: Leaning | A start screen that asks "What are you looking into?" | Setup waits until you need it, and you get to something useful faster. Example questions help if you don't have one in mind.
Option: Also offered | Open a finished example trail first | Shows what a trail looks like, but it's watching instead of doing, so it's a link on the start screen, not the default.
Option: Fallback | No start screen, just a helpful empty first tab | Simpler. I'll test it against the start screen to see if the extra screen earns its place.
Option: Dropped | Keep the setup form, cut to one screen with Skip | It still asks for things before you've seen anything worth it, and most people keep the defaults anyway.
Decision: I want first launch to ask "What are you looking into?" instead of asking for API keys. Every way in should end with a trail of 3 cards, the canvas open, and an offer to send it.
Why: Right now the first screen is a setup form. The trail, the part that makes NODE different, shows up later on a screen I never point anyone to.
Next: I'm aiming to build it for 0.13 and A/B test it against the empty first tab, alongside a 5-person usability test.

## 2026-11-18 · How far do I go to make NODE a habit?
Topic: First week
Status: Proposed
Decision: No feed, no streaks and no fake urgency. Every kind of notice gets its own switch, and first-week milestones are counted only on your computer. If a change brings more visits but also more people turning notices off, I roll it back.
Why: A lot of you picked NODE for privacy. And the long experiments I read, at Facebook and Pinterest, found that pushing harder loses people over a few months.

## 2026-11-18 · Should syncing between devices need an account?
Topic: Privacy
Status: Decided
Option: Chosen | Pair devices with a code or a QR code | Nothing about you is needed, and the code stays on your devices.
Option: Dropped | Sign in with an account | It would be the first thing NODE knows about you.
Decision: No. You pair devices with a code or a QR code, and your trails are encrypted on your device before they're sent. The server deletes each change once your other devices have it, after 30 days at most. This shipped in 0.12.0.
Why: A pairing code is enough to prove two devices belong together.
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
Option: Dropped | Send more to bring people back | It raises visits for a while, then more people turn notifications off or uninstall.
Option: Chosen | A weekly limit, only for something new, with a switch per kind | The long experiments found this does better over months.
Option: Dropped | Ask for permission at first launch | Asking after a few days of use did better in the research.
Decision: Few, and only about something new. There's a weekly limit across all kinds, a switch for each kind, and I'll only ask for system permission on day 3 or later. I judge them by how many people turn them off, not by clicks.
Why: The long experiments I read found that fewer, more relevant notifications raise use over time.

## 2026-11-05 · Who is NODE for?
Topic: Who it's for
Status: Decided
Option: Dropped | A browser for one person doing niche research | Where NODE started.
Option: Chosen | Knowledge networking between friends and small groups | You map what you read, and send the whole trail on.
Decision: Knowledge networking between friends and small groups. You map what you read, and send the whole trail to a friend or a group as one file.
Why: Research usually gets passed on as a list of links, and the next person starts over. NODE already records the path, so sending it takes no copying.

## 2026-11-05 · What should NODE be called?
Topic: Who it's for
Status: Decided
Option: Dropped | Scout
Option: Dropped | NODE R-X Browser | An X in the name reads as a tie to xAI.
Option: Dropped | Node Browser | It collides with Node.js.
Option: Chosen | NODE Research Browser | It says what it is.
Decision: NODE Research Browser.
Why: "Research Browser" says what it is.

## 2026-11-05 · Do I share trails as links or as files?
Topic: Sharing
Status: Decided
Option: Chosen | One plain Markdown file | Works today, anyone can read it in a text editor, and it outlives the app.
Option: Later | A share link | Needs the share server running for everyone first.
Decision: As one plain Markdown file first. Links come once the share server works for everyone.
Why: A file works today, anyone can read it in a text editor, and it outlives the app.

## 2026-11-03 · Should two people's trails merge into one?
Topic: Sharing
Status: Parked
Option: Parked | Merge two trails into one | I couldn't find any study on whether people understand two merged research maps.
Option: Chosen | One person builds a trail and shares it | The part people need first.
Option: Later | Show both trails on one canvas, then add chosen cards, then full merge | The order to try when merging comes back.
Decision: Not yet. I'm focusing on one person building a trail and sharing it.
Why: Git-style merging makes sense to developers, but most people researching together don't think that way.

## 2026-11-03 · Is a trail a timeline or a map?
Topic: Sharing
Status: Decided
Option: Dropped | A timeline only | Research doesn't happen in a straight line.
Option: Dropped | A map only | A bare map has no clear place to start for whoever receives it.
Option: Chosen | A canvas with the timeline beside it, and Replay | A map plus a replay of how it was built got 71% of the facts across at handoff, against 50%.
Decision: A canvas, with the timeline kept beside it and Replay for whoever receives it. NODE draws the links it already knows. Drawing your own is optional.
Why: In the studies I read, people rarely draw links by hand, so NODE draws the ones it knows.

## 2026-10-25 · Can NODE run Chrome extensions?
Topic: Engine
Status: Decided
Option: Dropped | Ship uBlock Origin itself | Electron is missing the parts it needs, and it could break with any update.
Option: Not possible | Ship uBlock Origin Lite | Electron doesn't enforce the blocking rules it relies on.
Option: Dropped | Support the Chrome Web Store | Most extensions would half-work.
Option: Chosen | Use uBlock Origin's default filter lists in NODE's own blocker | Covers what most people use it for.
Option: Later | A Chromium build, which runs extensions | Part of the engine question.
Decision: No. Instead, NODE's built-in blocker uses the same filter lists uBlock Origin uses by default.
Why: A beta tester asked for uBlock Origin, and this covers what they used it for without breaking NODE's own blocker.

## 2026-10-18 · Electron or a Chromium build?
Topic: Engine
Status: In progress
Option: Dropped | Ship NODE as a Chrome extension | Mosaic, address-bar suggestions and the agent tools can't work in an extension.
Option: Chosen | Keep Electron for releases and build on Chromium alongside | Google sign-in works on Chromium, and Electron keeps shipping meanwhile.
Option: Dropped | Build on BrowserOS | Its licence (AGPL) doesn't fit NODE's MIT licence, so I went with ungoogled-chromium.
Decision: Electron stays the release build. I've started a Chromium build on ungoogled-chromium, mainly so Google sign-in works inside NODE.
Why: Google blocks sign-in inside Electron apps, and faking Chrome breaks Google's terms. Mosaic and the address-bar suggestions need changes to Chromium itself, so I'll only switch once it does everything the current build does.
