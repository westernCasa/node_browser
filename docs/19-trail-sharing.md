# Trail sharing

Status: spec, 2026-10-27. Backlog item B82. Nothing built yet.

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
| Notes | Short notes on a page or a thread, with who wrote them | Yes |
| Pinned keywords | The trail's pins | Yes |
| Reports | Summaries made by Ask AI and the research agent | Yes |
| Captures | Screenshots and saved pages | No. Off by default, since a screenshot can show private things |
| Open tabs | The addresses of the trail's open tabs | No. Optional |
| History outside the trail | Nothing else from the browser | Never |

Never shared, whatever the sender picks: sign-in, account and payment pages (the same `isSensitiveUrl` rule the trail already uses), and address parts that often carry private tokens (`token`, `key`, `session`, `auth`, `code` and similar query parameters are removed).

Before anything is sent, NODE shows the full list of pages and the sender can untick any of them.

## Threads (new)

Today a trail's "threads" are worked out from keywords that show up on more than one page. Sharing needs threads people make on purpose:

- A thread has a title (a question or a line of inquiry, for example "Why do starters fail in winter?"), the pages that belong to it, notes, and a status: **open** or **resolved**.
- A resolved thread can have a short conclusion. It does not have to.
- Pages can belong to more than one thread, or to none.
- The keyword threads stay as suggestions: "These 4 pages share 'hydration'. Make it a thread?"

## Sending (phase 1: a file)

1. Menu → Trail, or the trail's name in the sidebar → **Share Trail…**
2. A sheet shows what will be included: pages (each can be unticked), threads, notes, reports, and the two optional parts (captures, open tabs).
3. **Save File** writes `<trail name>.nodetrail` (JSON, readable), ready to send through any app: Telegram, Discord, Messages, email, AirDrop.
4. The sender's name on notes and threads comes from a display name set the first time (Settings → Sharing). No account.

Nothing leaves the computer from NODE itself in this phase. The person sends the file with whatever app they already use.

## Receiving and merging

Opening a `.nodetrail` file (double-click, drag it onto NODE, or Menu → Trail → **Open Shared Trail…**) shows a preview: who sent it, the trail name, how many pages and threads, and how many of those are new.

Two choices:

- **Open as New Trail.** It appears in Active trails, marked with who it came from. Its pages are listed; nothing loads until the person opens a page.
- **Merge Into…** one of your trails. NODE shows what the merge will do before it does it:
  - New pages, threads and notes are added.
  - Pages you both have are combined: the earliest "first read", the latest "last read", the keywords from both.
  - Notes are never overwritten. Both people's notes stay, each with its author.
  - A thread that one person resolved and the other did not is the one real conflict. NODE lists these and asks which status to keep.
  - Nothing is deleted by a merge. Something the sender removed stays in your trail.

### How merging knows what matches (like Git)

- Every trail, thread and note has a random id, so items keep their identity when they travel back and forth.
- A page is matched by its address with tracking parameters removed (the same cleaning as above).
- Every trail records where its parts came from: "3 pages and 1 thread from Alex, Oct 30". This is the trail's history, the way a Git log is.
- Sending a trail back to someone who already has it is fine. Merging only adds what they don't have yet, so two people can pass a trail back and forth.

## Later phases (each needs its own go-ahead)

| Phase | What | Needs |
| --- | --- | --- |
| 2. Share link | A link instead of a file. The trail is encrypted on the sender's computer and uploaded; the key is in the part of the link after `#`, which browsers never send to a server. The server stores data it cannot read, and deletes it after 30 days. | A small server (for example Supabase or a Cloudflare Worker) and a new line in "What NODE sends" |
| 3. People and groups | Send to a contact or a group from inside NODE, with an inbox for incoming trails. Group trails update for everyone, and members merge new additions with one click. | Identity (at least a key pair per person), the server from phase 2, and a privacy review |
| 4. Live trails | Several people working in one trail at the same time | Phase 3, and a decision on how much of this a research browser needs |

## Open questions for Sven

1. **Threads:** is "a title, pages, notes, open or resolved" the right shape? Should a thread be able to contain other threads?
2. **Names:** is a display name with no account enough for phase 1?
3. **Reports:** shared by default (as above), or off by default like captures?
4. **Merge conflicts:** besides a thread's status, is there anything that should ask the person rather than combine on its own?
5. **Phase 2:** worth doing soon, or wait to see whether people send files?
6. **The file name:** `.nodetrail`, or something tied to a new product name if NODE is renamed?

## Build plan for phase 1

1. Threads in the trail: data, the Trail section of the Menu, the sidebar (thread count in the trail header), mark resolved, keyword threads offered as suggestions.
2. Notes on pages and threads, with an author.
3. The `.nodetrail` format (versioned, with a schema test) and the export sheet with the page list.
4. Open Shared Trail: preview, Open as New Trail, Merge Into with the summary and the conflict list.
5. File association for `.nodetrail` on Mac and Windows; drag and drop.
6. Tests: export removes sensitive pages and private address parts; merging is the same whichever order two trails are merged in; merging the same trail twice changes nothing the second time.
