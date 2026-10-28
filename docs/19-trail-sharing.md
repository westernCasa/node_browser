# Trail sharing

Status: spec, 2026-10-27; open questions answered by Sven the same day (see Decisions). Backlog item B82. Nothing built yet.

## Goal

Research is rarely finished. NODE should make it easy to pass a trail to someone else part-way through, have them add to it, and take their additions back. This follows NODE's aim: optimize for sharing information, since many questions are never fully answered.

What Sven asked for:

- Direct sharing to a person or a group, like sending a message in Telegram or Discord. No public feed.
- A trail can be sent open. It does not need a conclusion.
- Threads inside a trail can be marked resolved (closed).
- A trail someone sends can be merged into one of your own trails, the way Git merges branches.

## Where this fits

NODE has no accounts and no server of its own. Everything it sends is listed in the README under "What NODE sends", and that list is short on purpose. Sharing must not quietly change that. So the plan starts with sharing that needs no server (a file), and adds a link and groups later, each as a separate decision.

## What a shared trail contains

| Part | What it is | Shared by default |
| --- | --- | --- |
| Name | The trail's name | Yes |
| Pages | Each page read: address, title, when first and last read, its keywords | Yes, after the sender reviews the list |
| Threads | Lines of inquiry inside the trail (new, see below), each open or resolved | Yes |
| Replies | Messages in a thread, answering each other, with who wrote them | Yes |
| Notes | Short notes on a page, with who wrote them | Yes |
| Tags | Custom tags on threads, replies and pages | Yes |
| Pinned keywords | The trail's pins | Yes |
| Reports | Summaries made by Ask AI and the research agent | Yes |
| Captures | Screenshots and saved pages | No. Off by default, since a screenshot can show private things |
| Open tabs | The addresses of the trail's open tabs | No. Optional |
| History outside the trail | Nothing else from the browser | Never |

Never shared, whatever the sender picks: sign-in, account and payment pages (the same `isSensitiveUrl` rule the trail already uses), and address parts that often carry private tokens (`token`, `key`, `session`, `auth`, `code` and similar query parameters are removed).

Before anything is sent, NODE shows the full list of pages and the sender can untick any of them.

## Threads (new)

Today a trail's "threads" are worked out from keywords that show up on more than one page. Sharing needs threads people make on purpose, and they work like Reddit threads:

- A thread has a title (a question or a line of inquiry, for example "Why do starters fail in winter?"), the pages that belong to it, and a status: **open** or **resolved**.
- People reply in a thread. A reply has an author, a time and text, and can link pages. Replies can be answered, so a thread is a tree of replies, as on Reddit.
- A resolved thread can have a short conclusion. It does not have to.
- Pages can belong to more than one thread, or to none.
- Threads and replies can carry tags (custom words, for example "methods" or "disputed").
- The keyword threads stay as suggestions: "These 4 pages share 'hydration'. Make it a thread?"

## Sending (phase 1: a file)

1. Menu → Trail, or the trail's name in the sidebar → **Share Trail…**
2. A sheet shows what will be included: pages (each can be unticked), threads, notes, reports, and the two optional parts (captures, open tabs).
3. **Save File** writes `<trail name>.trail.md`, a Markdown file (format below), ready to send through any app: Telegram, Discord, Messages, email, AirDrop.
4. The sender's name on notes and threads comes from a display name set the first time (Settings → Sharing). No account.

Nothing leaves the computer from NODE itself in this phase. The person sends the file with whatever app they already use.

## Receiving and merging

Opening a trail file (double-click, drag it onto NODE, or Menu → Trail → **Open Shared Trail…**) shows a preview: who sent it, the trail name, how many pages and threads, and how many of those are new.

Two choices:

- **Open as New Trail.** It appears in Active trails, marked with who it came from. Its pages are listed; nothing loads until the person opens a page.
- **Merge Into…** one of your trails. NODE shows what the merge will do before it does it:
  - New pages, threads and notes are added.
  - Pages you both have are combined: the earliest "first read", the latest "last read", the keywords from both.
  - Replies and notes are never overwritten. Everyone's stay, each with its author, in their place in the thread.
  - NODE asks rather than combining in two cases: a thread that one person resolved and the other did not (which status to keep), and tags or pinned keywords the other person added or removed (keep theirs, keep yours, or both).
  - Nothing is deleted by a merge. Something the sender removed stays in your trail.

### How merging knows what matches (like Git)

- Every trail, thread and note has a random id, so items keep their identity when they travel back and forth.
- A page is matched by its address with tracking parameters removed (the same cleaning as above).
- Every trail records where its parts came from: "3 pages and 1 thread from Alex, Oct 30". This is the trail's history, the way a Git log is.
- Sending a trail back to someone who already has it is fine. Merging only adds what they don't have yet, so two people can pass a trail back and forth.

## The file: Markdown that people and AI can work with

A shared trail is one Markdown file, so it reads well in any app, and an AI assistant can read it, answer in a thread, add pages or summarize it. NODE reads it back, including what a person or an AI added by hand.

- Name: `<trail name>.trail.md`. NODE knows it by the front matter, not only the name, so a renamed `.md` file still opens.
- Front matter (YAML between `---` lines): `node-trail: 1` (the format version), the trail's id and name, who exported it and when, pinned keywords, tags.
- Body, in this order:
  - `# <trail name>` and one line on what the trail is about (optional).
  - `## Threads`: each thread is `### <title>` with its status and tags on the next line (`Status: open · Tags: methods, disputed`), then its replies as a nested list. Each reply is `- **<author>** · <date>: <text>`, and answers to it are indented under it. Pages linked in a reply are ordinary Markdown links.
  - `## Pages`: one list item per page, `- [<title>](<address>)`, then first and last read, keywords and notes indented under it.
  - `## Reports`: each report as `### <title>`, then its text.
- Ids: each thread, reply, page and report has an id in an HTML comment at the end of its line (`<!-- id:8f3a… -->`), which Markdown viewers do not show. Lines without an id, for example a reply an AI wrote into the file, are read as new items, with the author line they carry or "Added in the file".
- NODE never needs anything outside the file, and ignores text it does not recognize instead of failing; that text is kept as a note on the trail so nothing is lost.

A short example:

```markdown
---
node-trail: 1
id: 4c1e…
name: Sourdough starters
exported-by: Sven
exported-at: 2026-10-28T14:02:00Z
pins: [hydration, rye]
---
# Sourdough starters

## Threads

### Why do starters fail in winter? <!-- id:a71b… -->
Status: open · Tags: temperature

- **Sven** · Oct 27: Most sources say below 24 °C the culture goes dormant. [Why sourdough starters fail](https://example.com/starters) <!-- id:r1… -->
  - **Alex** · Oct 28: Bakers in SF keep a 100% hydration levain to get around it. <!-- id:r2… -->

## Pages

- [Why sourdough starters fail](https://example.com/starters) <!-- id:p1… -->
  - Read Oct 27 · Keywords: starter, temperature, levain
```

## Later phases (each needs its own go-ahead)

| Phase | What | Needs |
| --- | --- | --- |
| 2. Share link | A link instead of a file. The trail is encrypted on the sender's computer and uploaded; the key is in the part of the link after `#`, which browsers never send to a server. The server stores data it cannot read, and deletes it after 30 days. | A small server (for example Supabase or a Cloudflare Worker) and a new line in "What NODE sends" |
| 3. People and groups | Send to a contact or a group from inside NODE, with an inbox for incoming trails. Group trails update for everyone, and members merge new additions with one click. | Identity (at least a key pair per person), the server from phase 2, and a privacy review |
| 4. Live trails | Several people working in one trail at the same time | Phase 3, and a decision on how much of this a research browser needs |

## Decisions (Sven, 2026-10-27)

1. **Threads:** like Reddit threads. People post replies, and replies can be answered.
2. **Names:** a display name with no account is enough for phase 1.
3. **Reports:** shared by default.
4. **Merge:** besides a thread's status, ask about custom tags and keywords instead of combining them.
5. **Phase 2 (share link):** yes, soon after phase 1.
6. **File:** a Markdown file that an AI can also work through (format above).

## Build plan for phase 1

1. Threads in the trail: data, the Trail section of the Menu and the sidebar (thread count in the trail header), replies and answers to replies, mark resolved with an optional conclusion, tags, keyword threads offered as suggestions.
2. Notes on pages, with an author; the display name in Settings → Sharing.
3. The `.trail.md` format: writer and reader (`core/trail-file.js`), versioned, with tests that a file round-trips and that lines added by hand or by an AI are read as new items.
4. The export sheet with the page list.
5. Open Shared Trail: preview, Open as New Trail, Merge Into with the summary and the questions (thread status, tags and keywords).
6. Opening `.trail.md` files from Finder and Explorer (as an extra "Open with" choice, not the default for all Markdown) and by dragging onto NODE.
7. Tests: export removes sensitive pages and private address parts; merging gives the same result whichever order two trails are merged in; merging the same trail twice changes nothing the second time.
