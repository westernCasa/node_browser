# 26 · Trail file format (node-trail v2)

Status: draft, Nov 5 2026 (media cards added the same day, B114). Replaces the v1 format in doc 19 for canvas trails. Sharing starts as a file; a link comes later.

## Goals

- One file holds the whole trail: cards, groups, links, timeline.
- Reads cleanly as plain Markdown in any editor, on GitHub, or in an AI assistant.
- Opens in NODE as the same canvas, in the same layout.
- Layout data stays out of the reader's way (HTML comments).

## File

- Name: `<trail-slug>.trail.md`, for example `sourdough-starters.trail.md`.
- Encoding: UTF-8, Markdown with YAML front matter.

## Structure, in order

1. **Front matter**
   - `node-trail: 2`
   - `id`, `name`, `exported-by`, `exported-at` (ISO 8601)
   - `start-here`: card id (optional)
2. **`# Trail name`**, then the sender's note, then a "Start here" link (optional).
3. **One `##` section per group**, in canvas order. The comment under the heading holds the layout:
   `<!-- group:f1 at:0,0 size:820x620 -->`. A resolved group adds `resolved`.
4. **Cards as `###` headings** inside their group. The comment under each heading holds the layout:
   `<!-- id:p1 type:page at:520,60 size:260x250 -->`
5. **`## Not in a group`**: cards on the canvas outside any group.
6. **`## Links`**: one list item per line between cards, with its kind in a comment.
7. **`## Timeline`** (optional): one line per session, oldest items last. Pages that never went on the canvas say "(timeline only)".
8. **`## Open tabs`** (optional).

## Cards

| Type | Heading | Body |
| --- | --- | --- |
| page | `### [Title](url)` | excerpt, then `Keywords:` |
| video | `### [Title](url) · video` | `Saved at 4:12 of 12:04` |
| capture | `### > quoted line` | `Captured from <source> · <device time>` |
| report | `### Report: title` | summary, then `AI-assisted · N sources` |
| question | `### ? Question` | `Status: open · N replies`, then the latest reply |
| note | `### Note` | text, then `— author · date` |
| voice | `### Voice note · 0:22` | transcript |
| media, image from the web | `### ![Title](image address)` | `From [site](page address)` |
| media, video or audio from the web | `### [Title](media address) · video clip` (or `· audio`) | `From [site](page address)` |
| media, screenshot or a file from the computer | `### Screenshot: Title` (or `Image:`, `Video:`, `Audio:`) | `From [site](page address)` if any, then `The file stayed on the sender's computer.` |
| moment | `### [Title](page address) · moment 41:12–42:30` | `> captions shown during the moment`, if the site had captions |

Saved copies (B87, added 2026-11-08) keep `node-trail: 2`: a page card can end with one line per copy, oldest first: `Copy: 8 Nov 2026 10:05 · SHA-256 <64 hex digits>`. When the sender ticks "Saved copies" in the share sheet, the copies go as `<sha256>.mhtml` files in a folder `<file name> copies` beside the trail file, and each line adds ` · [saved copy](<folder>/<sha256>.mhtml)`. Without that choice the lines only say a copy exists. When the file is opened, each copy in the folder whose SHA-256 matches its line is kept on the reader's computer; one that doesn't match is marked changed and never opened.

Moment cards (B88, added 2026-11-07) keep `node-trail: 2`: a section of a video or audio page, start and end in the heading (`m:ss` or `h:mm:ss`), the captions as one quoted line (at most 1,200 characters). A "moment from" line joins the page's card to the moment. An "ID at 41:12?" request is an ordinary question card with a "raises" line from the moment.

Media cards (B114, added 2026-11-05) keep `node-trail: 2`: the layout comment adds `media:image`, `media:screenshot`, `media:video` or `media:audio`. The file never carries the media itself or the sender's Library id. Media saved from the web links to where it came from (`src`), without tracking codes, so the reader's NODE shows a large preview from there (the image, or a video or audio player). A screenshot links only to its page. Readers that don't know media cards see a normal Markdown image or link.

### How a page was reached (B83)

A page card can end with `Reached: <how>`, and a timeline-only item with `(timeline only · <how>)`. Added 2026-11-06; the format stays `node-trail: 2`, and files without it open as before.

| how | Text |
| --- | --- |
| a link on another page | `link from reddit.com` (the site only, never the address) |
| web search results, or a search typed in NODE | `search “levain”` |
| an address typed in the address bar, CommandBar or canvas | `typed address` |
| NODE's suggestions | `suggested by NODE for “rye flour”` (the keyword or search it came from) |
| the research agent | `found by agent` |
| the site went on to the next video or track by itself | `auto-played next on youtube.com` |

` · played by NODE` is added when NODE's autoplay started the page's video or audio. Pages opened another way (bookmarks, history, restored tabs, older trails) have no line.

## Links

`- [From title](#from-id) → [To title](#to-id) · <label> <!-- from:p1 to:c1 kind:auto -->`

| kind | Shown on canvas | Label in the file |
| --- | --- | --- |
| nav | grey line with arrow | opened from |
| auto | grey dotted line | captured from, report on |
| you | white line with end dots | drawn · user's label |

Suggested lines are not saved. They are NODE's guesses, not the sender's work.

## Share sheet choices

- Note: a free-text line under the title.
- Start here: one question card (an open one is preselected).
- Always in the file: cards, groups and links.
- On by default: timeline, with timeline-only pages.
- Off by default: open tabs.
- Never in the file: screenshots and other media files (they stay on the sender's computer; media from the web is linked, see Cards), sign-in and payment pages, private tabs, other trails.

## Opening a file

- Opening a `.trail.md` in NODE opens it read-only as its own tab, with replay in the sidebar (board C4).
- **Save as new trail** copies it into the reader's trails and lands them on C1 with the canvas as sent. The sender's file is not changed.
- A file without layout comments still opens: NODE lays cards out by group, in file order.

## Later

- Share link, built on the same format.
- Returning a reply file to the sender (merge stays parked, B99).

## Sample

See `scout/sourdough-starters.trail.md`, saved from the C1 prototype.
