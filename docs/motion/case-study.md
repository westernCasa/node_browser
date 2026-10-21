# NODE micro-interactions: case study notes

Raw material for the portfolio case study. One section per interaction: decision note, before and after, and the three checks.

## 01. Sound toggle

**Decision note.** "Sound: all" changes what you hear in every tab, so the button should show the change has been made, not just that it was clicked. The colour fades in a little slower (200ms) as it turns on and leaves faster (120ms) as it turns off, so "on" feels like it arrives and "off" gets out of the way. Only colour moves; the button keeps its size and place, and the word swaps at once so it can be read straight away. Every chip that turns violet (Mosaic, the sidebar tabs, Library filters) now uses the same timing, so "active" looks the same everywhere.

**Before.** One shared 120ms ease-out fade for every colour change, on and off.

**After.** On: 200ms, `--ease-enter`. Off: 120ms, `--ease-exit`. Hover in: 120ms, `--ease-move`. Reduced motion: 120ms both ways. The colour changes when the main process confirms the new sound setting, which `paintSound()` already waited for.

**Three checks.**

1. Press Cmd/Ctrl+Shift+A and use View → Sound for all tabs: both must fade the same as a click, because all three go through the main process.
2. Click the button while hovering it: the turn-on fade should still be the slower 200ms one (the `.chip.active` rule comes after `.chip:hover`).
3. Tab to the button with the keyboard: the focus ring appears at once and does not fade.

## 02. Card "read" state

**Decision note.** Once you have opened a suggestion it should step back, so the cards you have not read stand out, but it should still be there to find again. Dimming the card (rather than hiding or moving it) keeps the list stable while you work through it. The badge fades in on the same beat as the dim, so the card says why it changed. It only ever goes one way, because a page you have read stays read for the session.

**Before.** The card switched to 60% at once, and the "read" badge only appeared the next time the list was redrawn.

**After.** The card fades to 60% over 200ms (`--ease-move`); the badge is added at the same moment and fades in over 200ms (`--ease-enter`). Cards that were already read when the list loads show their badge with no animation. Reduced motion: both fades at 120ms.

**Three checks.**

1. Open a suggestion, then let the list refresh (new keywords or Crawl): the read card must not fade again.
2. Click Open tab on a card that is already read: nothing should replay.
3. Check the dimmed text still meets contrast for reading (60% white on #0e0e0f), especially the snippet text.

## 03. Mosaic button

**Decision note.** The Mosaic button says what it will do next ("Mosaic" or "Focus"), so when its word changes, the change should be noticed but not perform. The new word rises 3px into place, like a line being set, while the old word simply disappears; that small lift is enough to show the button has a new job without drawing the eye away from the tiles. It waits for NODE to confirm the new layout, so the button never shows a state the window is not in. The tiles get their own motion in 08.

**Before.** Clicking changed the label and colour immediately, before the layout had changed.

**After.** The click asks the main process to switch; when it answers, the button turns violet (01 timing) and the new label rises 3px and fades in over 200ms (`--ease-enter`), using a keyframe that restarts on every change. Reduced motion: the label fades in over 120ms with no rise.

**Three checks.**

1. Toggle with Cmd/Ctrl+Shift+M and with the research agent's "Open in Mosaic": the label must animate the same way.
2. Click twice quickly: the second label should replace the first cleanly, with no half-risen word left behind.
3. With a screen reader, the button's name should read "Mosaic" or "Focus" (the label is a span inside the button, so its name is unchanged).

## 04. Bookmark star

**Decision note.** Saving a bookmark is a small commitment, so it gets a small, clear acknowledgement: the filled star grows into place from 60% and settles, the way a stamp lands. Removing it is quieter and quicker, a short fade with no change in size, because taking something away should not feel like a reward. The star stays white rather than violet, since violet in NODE means "active now", and a bookmark is a saved fact, not something running. Switching tabs repaints the star without any animation, so the star only moves when you act.

**Before.** The star glyph swapped instantly on save, remove and tab switch alike.

**After.** Save (click or Cmd/Ctrl+D): scale 0.6 → 1 and opacity 0.4 → 1 over 200ms, `--ease-enter`. Remove: opacity 0.4 → 1 over 120ms, `--ease-exit`. Tab switch: no animation (`paintStar()` only animates when `toggleBookmark()` passes `animate: true`). Reduced motion: save is a 120ms fade with no scale.

**Three checks.**

1. Press Cmd/Ctrl+D twice quickly: the second change should replace the first without the star getting stuck small.
2. Switch between a bookmarked and an unbookmarked tab: the star must change with no animation.
3. With keyboard focus on the star, press Enter: the focus ring must stay steady while the glyph animates inside it.

## 05. Research agent steps

**Decision note.** The research agent works in the background, and its list of steps is the only sign of what it is doing. Typing each new line out left to right makes it read like a log being written as it happens, and the 14 even jumps give it the feel of a terminal rather than a smooth fade. Only the newest line moves; everything already listed stays still, so you can read the earlier steps while new ones arrive. The whole line is revealed in 160ms, short enough that it never holds up reading.

**Before.** The list was cleared and rebuilt on every new step, so every line was redrawn each time and nothing showed which line was new.

**After.** `renderAgent()` keeps the lines it has already drawn and only appends new steps. Each new line is revealed with `clip-path: inset(0 100% 0 0)` → `inset(0 0 0 0)` over 160ms with `steps(14, end)`. Starting a new run clears the list; reopening the pane on a finished run shows its lines without typing. Reduced motion: each new line fades in over 120ms with `--ease-enter`.

**Three checks.**

1. Ask a follow-up question: the list should clear, and the new run's lines should type out from the first one.
2. Close the agent pane during a run and open it again: lines already there must not retype.
3. Long lines that wrap to two rows are revealed left to right on both rows at once; check that this still reads as one line being written.

## 06. Keyword chips

**Decision note.** Keywords are what NODE searches with, so when you pin or hide one you need to see exactly where everything went. Pinning moves a chip to the front and turns it violet; every other chip slides from its old place to its new one, so nothing appears to jump. Hiding is a two-beat change: the chip fades and shrinks where it is, so you see which one went, and only then do the others close the gap and the next keyword arrives. Changes run in order, so two quick clicks read as two clear steps instead of a tangle.

**Before.** `renderKeys()` deleted and rebuilt every chip on each change, so pinning or hiding made the whole row jump at once with no sign of what changed.

**After.** Chips are kept, one per keyword, and reordered with the CSS `order` property. Pin: the colour fades to violet (200ms, `--ease-enter`) and all chips slide to their new places with FLIP (200ms, `--ease-move`). Hide or unpin with ×: the chip fades and scales to 0.9 in place (120ms, `--ease-exit`), is removed, the others slide (FLIP), and a newly shown keyword scales in from 0.95 and fades in (200ms, `--ease-enter`). Each change waits for the one before. If the × that had focus is removed, focus moves to the × now in its place. When the motion ends, the chips are put back in page order so keyboard Tab order matches what you see. Reduced motion: no sliding or scaling; leaving and new chips fade over 120ms.

FLIP stands for First, Last, Invert, Play: note where each chip is, make the change, measure where it ended up, then draw it at the old spot and animate it to the new one. It lets a layout change look like movement without animating the layout itself.

**Three checks.**

1. Pin a chip and immediately hide another: the hide must wait for the pin's slide to finish, and no chip should end up out of place.
2. Tab to a chip's × and press Enter or Space: focus must land on the × of the chip that took its place, not jump to the top of the window.
3. Keywords that change because you scrolled or opened a page must swap without any of this motion; only your own clicks animate.

The chip itself is a `<span>`, so it cannot be reached with Tab; only its × can. Making the chip focusable would change behaviour, so it is left for a later decision.

## 07. Result cards

**Decision note.** Suggestions arrive in two waves (Wikipedia first, then web results), so new cards should feel like they are being dealt onto the table, not snapping in. Each new card fades in place, 40ms after the one before, which reads as a list filling up without anything sliding around while you read. Cards already on screen never animate again, because the second wave should not disturb what you are looking at. Dismissing is two clear beats: the card fades out so you see which one went, then the space closes so the list stays tidy.

**Before.** The list was cleared and rebuilt each time; new cards appeared at once, and × removed a card instantly so the cards below jumped up.

**After.** `renderResults()` keeps cards that are already on screen in place in the page and only inserts new ones; each new card fades in over 320ms (`--ease-enter`) with a delay of 40ms (`calc(var(--motion-fast) / 3)`) times its position among the new cards. ×: the card fades out over 120ms (`--ease-exit`), then its height, padding and border collapse to 0 and its bottom margin to minus the list gap over 320ms (`--ease-move`); only then does NODE call `researchDismiss` and remove it, in the same order as before. Focus moves to the next card's × if the removed one had focus. Reduced motion: cards fade in over 120ms; × fades the card, then the gap closes at once.

The spec mentioned collapsing a wrapper; cards have no wrapper element, so the card itself collapses (its padding and border go to 0 with its height).

**Found while building.** Results from several searches are merged in turn (round-robin), so when web results arrive they can be placed above Wikipedia cards that are already showing. Those cards then shift down without animating. Proposed fix: use the same FLIP step as the keyword chips (06) for cards that stay but move.

**Three checks.**

1. Dismiss a card while the second wave of results is still loading: the card should finish leaving; it must not reappear.
2. Tab to a card's × and press Enter: focus must move to the next card's ×, or the previous one if it was the last card.
3. Timing: the dismissal is saved about 440ms after the click (after the motion). If NODE is quit in that moment, the dismissal is not saved.

## 08. Mosaic tab windows

**Decision note.** Mosaic is the moment NODE shows that several pages are live at once, so the switch should explain where each page went instead of cutting. Going into Mosaic, the other tabs are already in their tiles underneath, and the tab you were reading shrinks into its own tile, so your eye follows the page you care about. Going back, that tile grows over the others; they are hidden only after they are covered, so nothing blinks out. Entering takes longer (320ms) than leaving (200ms), because arriving at a new view needs a moment to read and leaving should get out of the way. Tab windows are native views, so they are resized for real on every frame instead of transformed; that is the one place NODE animates size.

**Before.** Clicking Mosaic swapped the full page for the grid in one frame. Opening or closing a tab in Mosaic made every tile jump to its new cell.

**After.**

| Moment | What moves | Timing |
| --- | --- | --- |
| Focus → Mosaic | The other tabs appear in their tiles under the active tab; the active tab shrinks into its tile. | 320ms, ease-out |
| Mosaic → Focus | The active tile grows to fill the area and covers the others; they are hidden after 200ms. | 200ms, ease-out |
| Tab opened or closed in Mosaic | Existing tiles move and resize to their new cells; a new tab appears in place. | 200ms, ease-in-out |
| Reduced motion | No animation. | — |

**How it is built.** In `main.js`, `applyLayout()` takes an optional `animate` value ("enter", "exit" or "move"). Only the Mosaic toggle and opening or closing a tab in Mosaic pass it. `showView()` hands it to Electron's `setBounds(bounds, { animate: { duration, easing } })`. New tiles are inserted directly under the active tab with `addChildView(view, index)`. A timer hides the covered tiles after the exit, and a fast second toggle cancels it.

**What I found about stacking.** `win.contentView.children` holds only the tab windows. NODE's own interface is not in that list: it is the window's base layer, under every tab. Index 0 is the bottom. In Focus, only the active tab is attached, so it is at index 0; new tiles are inserted at its index, which puts each one directly under it. Calling `addChildView` on a view that is already attached raises it to the top without detaching it, which is how the active tile goes on top before it grows.

**Test results.**

- Linux (first pass, Electron 44 under a virtual display, recorded at 30 fps): all three moments animate. Going in, the active page visibly shrinks into the bottom-right cell; going out, it grows and the other tiles stay until covered. During the animation the page shows its old layout and re-lays itself out at the new size.
- Mac (Wikipedia, a playing YouTube video, a heavy news page and another video; then six tabs): *to do on Sven's Mac.* Answers to record: is the motion smooth, does text jump, do the videos keep playing smoothly.

**Three checks.**

1. *State not covered:* a page that navigates during the 200ms exit calls `applyLayout()` again; the other tiles stay until the timer, but the growing tile may jump to full size instead of finishing smoothly.
2. *Timing:* Electron's `ease-out` is not exactly `--ease-enter`; compare the two in the demo and the app side by side.
3. *Accessibility:* with Reduce motion on (macOS: System Settings → Accessibility → Display → Reduce motion), toggling Mosaic must change instantly, as before.

## 09. Full-screen toolbar

**Decision note.** In full screen the toolbar gets out of the way and comes back when the pointer reaches the top edge. The first version moved the whole page down and up with the toolbar, and Sven found it dizzying: the text he was reading jumped 96px every time he went near the top. Safari does it differently, and NODE now copies it. The page fills the window and never moves; the toolbar slides down over the top of the page and back up. Only the toolbar moves, so the eye stays on the text.

**Before (first version).** The interface and the page slid down 96px together (320ms) and back up (200ms).

**After.**

| Moment | What moves | Timing |
| --- | --- | --- |
| Entering full screen | The page fills the window at once; the toolbar stays on top of it for 1.8 s with the hint, then slides up. | — |
| Toolbar shows (pointer at the top edge, Cmd+L, Cmd+F) | The toolbar slides down over the top of the page. The page does not move. On a Mac, when the pointer brings it down, it rests just below the system menu bar and title bar, which come down at the same time. | 200ms, `--ease-enter` cubic-bezier(0, 0, 0.2, 1) |
| Toolbar hides (pointer more than 16px below it for 400ms) | The toolbar slides up off the page. | 120ms, `--ease-exit` cubic-bezier(0.4, 0, 1, 1) |
| Leaving full screen | The layout is restored at once while macOS animates the window. | — |
| A video's own full screen | The toolbar never shows. | — |
| Reduced motion | No movement; the toolbar fades in and out. | 120ms |

**How it is built.** NODE's pages are native views drawn above the window's HTML, so HTML can never cover a page. In full screen the toolbar therefore gets its own layer above the pages: a small transparent view (`renderer/chrome-overlay.html`, 96px tall) created by `main.js`. The window keeps the real toolbar (moved out of view) and sends the layer a copy of it whenever something changes (`sendMirror()` in `app.js`, checked every 120ms and sent only on change). Clicks, double-clicks, middle-clicks and typing in the layer are sent back and replayed on the real toolbar, matched by position, so every button keeps its one set of behaviour. When Cmd+L or Cmd+F puts the cursor in a real field during full screen, it goes to the layer's copy instead, which is the one on screen. The layer is attached only while the toolbar is shown, so it never takes clicks meant for the page. The slide is CSS inside the layer (`body.chrome-overlay .chrome`).

**What is not carried over.** Dragging tabs to reorder them does not work in the full-screen toolbar; it does outside full screen.

**Test results.** Linux (test 22): the page view stays at y 0 and full height through the whole hide and show (sampled every 10ms); partway through the show the toolbar is at −71px (moving down); a button in the layer toggles the suggestions widget and the layer shows the new state; Cmd+L puts the cursor in the layer's address bar, typing reaches the real address bar, the toolbar stays while typing, and Enter opens the page. Mac: *to do on Sven's Mac.*

**Three checks.**

1. *State not covered:* on a Mac, when the pointer reaches the top edge, macOS slides its menu bar and the window's title bar down over the window too. Found on Sven's Mac (2026-10-20): they covered the tab row and part of the address row. Fixed: when the pointer brings the toolbar down, it comes to rest just below those bars (`osTop` in `main.js`: title bar and menu bar heights measured while the window is not in full screen, 52pt on a 13-inch MacBook Air). Still to check: when the pointer moves down onto NODE's toolbar, macOS may slide its bars away and leave a gap above the toolbar until the toolbar hides.
2. *Timing:* the copy can lag the real toolbar by up to 120ms (for example a tab title changing while the toolbar is shown).
3. *Accessibility:* with Reduce motion on, the toolbar fades instead of sliding; keyboard focus in the toolbar keeps it on screen.

## 10. Suggestions widget

**Decision note.** The widget takes 356px from the page when it opens and gives it back when it closes. Before, both happened in one frame, so the page text re-wrapped with no sign of why. Now the widget slides in from the right edge and the page narrows with it, as if the widget pushes the page aside; closing reverses it. The page edge stays 8px from the widget the whole way, so the two read as one movement. Opening uses `--motion-base` with `--ease-enter`; closing is quicker (`--motion-fast`, `--ease-exit`).

**Before.** The widget appeared or disappeared at once, and the page jumped between 1084px and 1440px wide (on a 1440px window).

**After.**

| Moment | What moves | Timing |
| --- | --- | --- |
| Open (toolbar button, ⌘⇧., or a pane that needs it) | The widget slides in from off the right edge; the page narrows on the same curve. | 200ms, `--ease-enter` cubic-bezier(0, 0, 0.2, 1) |
| Close (toolbar button, collapse button, ⌘⇧.) | The widget slides out to the right; the page widens on the same curve. The widget's column is removed after it has left. | 120ms, `--ease-exit` cubic-bezier(0.4, 0, 1, 1) |
| Start-up | No animation: the widget is open or closed as it was left. | — |
| Reduced motion | No movement: the widget fades in; the page changes width at once. | 120ms |

**How it is built.** `renderer/app.js` `setPanelOpen(on, { animate })`: `.rail.arriving` puts the widget one column to the right with no transition, then removing it lets the `transform` transition run; `.rail.leaving` slides it out, and a timer hides it after `--motion-fast`. `main.js` `layout:panel` gets `animate: "open" | "close"` and moves the page with `slideViews()`, the same cubic-bezier stepper as 09. The page is resized on each step, the way Safari resizes the page when its sidebar opens.

**Test results.** Linux: the page's right edge passes through 9 positions when closing and 13 when opening; the gap between the page and the widget stays between 4 and 14px (target 8) during the slide. Tests 22, 05, 12, 19 and 20 pass.

**Three checks.**

1. *State not covered:* clicking the toggle twice quickly restarts the slide from wherever the page edge is.
2. *Timing:* heavy pages may re-lay themselves out slower than the slide; look for the page edge lagging behind the widget on a large article or a video page.
3. *Accessibility:* with Reduce motion on, nothing moves; focus goes to the first widget tab when it opens from the keyboard and to the toolbar toggle when it closes.

## 11. Menu fade

**Decision note.** The menu covers the whole window, so it should arrive and leave without a cut. The page is replaced by a still picture of itself before the menu shows, so the picture can dim gradually under the scrim while the panel fades in. On the way out, the scrim and panel fade away first, and the live pages come back only once the picture underneath is fully visible again, so the swap back to the real page is invisible.

**Before.** The scrim appeared at full darkness in one frame (only the panel faded in), and on close the menu vanished at once.

**After.** Open: scrim and panel fade in together over 200ms (`--ease-enter`). Close (Esc, ×, click outside, a menu command): both fade out over 120ms (`--ease-exit`), then the live pages return. Opening again while it is fading out stops the close. Reduced motion: the same fades at 120ms.

**Three checks.**

1. *State not covered:* Capture → Screenshot opens the menu on Library while a page is loading; the picture should still match the page.
2. *Timing:* on a slow machine the page picture may take longer than 200ms; the fade starts only once the picture is there.
3. *Accessibility:* focus moves into the menu when it opens and back to the button that opened it as soon as it starts closing.

