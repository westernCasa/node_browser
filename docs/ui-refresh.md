# UI refresh: icon toolbar, suggestions widget, menu, full screen

October 2026. Mockups: "NODE UI redesign mockups" design canvas (option C chosen, with a tooltip on hover).

## What changed

| Before | After |
| --- | --- |
| Toolbar of word buttons: Mosaic, Sound: one, PiP, Shot, Save, Media, Library | Icon buttons. Hover shows the name and shortcut. Shot, Save, Media and PiP are one **Capture** button with a menu |
| Sidebar fixed at 225 px, always open | **Suggestions widget**, 340 px, beside the page with an 8 px gap. Collapses to the toolbar and gives the page the full width |
| Ask, Talk, Agent, Trail and Settings as chips in the sidebar header, each pane with a Back button | Suggest, Ask, Agent and Talk are tabs in the widget. Trail and Settings moved to the menu |
| Library as a full-width shelf under the toolbar | **Menu** panel over the page: Library, Bookmarks, History, Downloads, Trail, Settings, Help |
| Full screen kept the toolbar | Full screen hides the toolbar; it comes back at the top edge |
| Toolbar 112 px tall | 96 px (the extra 16 px was empty) |

## Decisions and why

**Icons need names (design library: `recognition-over-recall`, `signifiers`).** Both entries list icon-only toolbars as a common mistake: people have to remember what each icon means. So each button keeps its name in three places: the tooltip on hover (with its shortcut), `aria-label` for screen readers, and the menu bar. The widget tabs show the label on the selected tab. The menu sections show their labels and shortcuts.

**Fewer icons, grouped (option C).** Four capture tools as four icons would be four unlabeled shapes to learn. One Capture button with a labeled menu is one shape, and the menu names each tool.

**One click away (design library: `progressive-disclosure`).** The widget and the menu are each one click from the toolbar, behind controls with clear names. The widget remembers whether it was open.

**Targets (design library: `fitts-law`).** Toolbar buttons are 36 px. The collapsed widget's button sits in the toolbar where the pointer already is. In full screen the reveal area is the top edge of the screen, which the pointer cannot overshoot.

**Focus (design library: `focus-management`).** Opening the menu moves focus to the current section. Tab stays inside the menu. Esc, × or a click outside closes it, and focus goes back to the button that opened it. Collapsing the widget moves focus to its toolbar button.

## Technical constraints

Pages are native Chromium views (`WebContentsView`). They are drawn above the window's HTML, so HTML cannot appear on top of a page. This shaped three choices:

1. **Tooltips** use the native `title` tooltip, which the system draws above everything.
2. **The Capture menu** is a native menu (`Menu.popup`) for the same reason.
3. **The menu panel** hides the page views while it is open (as the Library already did) and shows a picture of the page, dimmed, behind the panel. The picture is taken with `capturePage()` just before the views are hidden.

The suggestions widget sits beside the page rather than over it: the page is narrowed by the widget's width plus the gap. A widget that truly overlaps the page would need the widget to be its own native view.

In full screen the renderer cannot see the pointer over the page, so the main process reads the pointer position every 100 ms (`screen.getCursorScreenPoint`) while the window is full screen. Pointer within 2 px of the top shows the toolbar; more than 16 px below it for 400 ms hides it. The address bar, the find bar and open menus keep it on screen. A video's own full screen covers the whole window and never shows the toolbar.

## Motion

Uses the existing tokens (`docs/motion/tokens.md`). Toolbar buttons: hover fades at `motion-fast`; turning on (violet) at `motion-base` with `ease-enter`, turning off at `motion-fast` with `ease-exit`. Mosaic's icon rises in when the layout changes (the existing 03 interaction). The menu panel fades in at `motion-base`. Reduced motion: fades only, at `motion-fast`.

## Tests

`test/e2e/22-ui-refresh.js` checks every toolbar button has a name and tooltip, collapsing and expanding the widget resizes the page, the menu hides the page views and shows the page picture, Esc closes the menu and returns focus, Capture actions reach the existing tools, and the full-screen toolbar hides, returns at the top edge, stays while held and resets on leaving full screen. `SHOTS=1` saves screenshots of the whole display.
