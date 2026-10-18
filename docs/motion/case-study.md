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
