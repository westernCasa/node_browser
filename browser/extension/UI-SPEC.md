# NODE UI spec: icon toolbar, suggestions panel, menu

Copied from the NODE UI kit (node-ui-kit.zip, version 1). The kit files are in `src/ui/`. If an icon is added, draw it on the same grid and list it in section 3.

Version 1, October 2026. Source: PR #1 in westernCasa/node_browser (Electron build), `docs/ui-refresh.md` for the reasons behind each decision.

## 1. Files in this package

| File | What it is |
| --- | --- |
| `node-ui.css` | Tokens and every component style. Self-contained (fonts included). |
| `node-ui.js` | Behaviour: tooltips with shortcuts, toggle buttons, panel tabs, menu overlay with focus handling, collapsed-panel count. No dependencies, no inline script, works in an extension page. |
| `icons/*.svg` | 29 icons, one file each. |
| `icons/sprite.svg` | All icons as `<symbol id="i-NAME">`. |
| `icons/icons.js` | The same icons in JS: `NodeIcons.inject()` adds the sprite to the page, `NodeIcons.svg("name")` returns the markup. |
| `icons/index.html` | Every icon with its name. |
| `fonts/` | Barlow 400/600/700, JetBrains Mono 400 (SIL Open Font License). |
| `template.html` (+ `.css`, `.js`) | Full-window reference: toolbar, floating panel, menu overlay. Open it in a browser. |
| `sidepanel-example.html` (+ `.js`) | The panel as a Chromium side panel page. |
| `menu-example.html` (+ `.js`) | The menu as a full NODE page (`#section` in the address opens that section). |
| `reference/` | Screenshots of the Electron build and of the template pages. |

## 2. Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--surface` | #000000 | Page and app background, menu panel |
| `--surface-raised` | #0e0e0f | Toolbar, side panel, selected menu row |
| `--line` | #2a2a2d | 1 px hairlines, hover border |
| `--ink` | #ffffff | Text, icons |
| `--ink-muted` | #a1a1a6 | Secondary text, idle icons in the panel tabs |
| `--signal` | #b18cff | "On" only: toggle on, focus ring, "+N new" |
| `--live` | #5ee38b | Something running: agents on, download in progress |
| `--alert` | #ff6b5a | Errors only |
| `--radius-sm` / `--radius-md` | 2 px / 4 px | Buttons and inputs / chips and tooltips |
| `--motion-fast` / `--motion-base` | 120 ms / 200 ms | Hover and turning off / turning on, menu fade |
| `--ease-enter` / `--ease-exit` / `--ease-move` | see CSS | Arriving / leaving / hover |

Type: Barlow for labels (uppercase, letter-spacing 0.12em for 12 px labels), JetBrains Mono for numbers, addresses and shortcuts.

## 3. Icons

20 × 20 grid, 1.5 px stroke, square caps, mitre joins, no fill, colour from `currentColor`. Never filled or coloured except a state colour on the whole button (exception: the bookmark star fills with `--ink` when saved).

| Name | Used for |
| --- | --- |
| `back`, `forward`, `reload` | Navigation |
| `plus`, `close` | New tab, close tab / close menu |
| `up`, `down` | Collapse panel, find previous / next |
| `star` | Bookmark (filled when saved) |
| `mosaic` / `focus` | Mosaic toggle: shows `mosaic` when off, `focus` when on |
| `sound` / `sound-all` | Sound: this tab / all playing tabs |
| `capture` | Capture menu: Screenshot, Save page, Save media, Picture in picture |
| `agents` | Agents on (green, `--live`) |
| `share` | Share this tab with agents |
| `suggest` | Suggestions panel toggle, Suggest tab |
| `ask`, `agent`, `talk` | Panel tabs |
| `fullscreen` / `exit-fullscreen` | Full screen toggle |
| `menu` | Menu |
| `download` | Downloads (toolbar while one runs, menu section) |
| `library`, `bookmarks`, `history`, `trail`, `settings`, `help` | Menu sections |

## 4. Toolbar button (`.tb`)

- 36 × 36 px, icon 20 px, no visible text. Transparent border; on hover a `--line` border.
- **Every button names itself.** Markup: `data-tip="Name"` and, if it has one, `data-keys="mod+shift+M"`. `NodeUI.init()` turns these into `title` (the hover tooltip, e.g. "Mosaic: tile every tab  (⌘⇧M)"), `aria-label` and `aria-keyshortcuts`. `mod` is ⌘ on a Mac and Ctrl elsewhere.
- **Toggles** use `aria-pressed="true|false"`. Pressed = `--signal` border and icon. Each state has its own name and, where listed above, its own icon (`NodeUI.setPressed`). The new icon may play `.rise` (fade up 3 px) when the state changes.
- Running state (agents on, download in progress): add `.live` (green icon). A count sits after the icon in `.count` (mono 13 px).
- Groups are separated by `.tb-sep` (1 × 24 px hairline).

**Toolbar order (left to right):** back, forward, reload, address bar, bookmark star | Mosaic, Sound, Capture, [Share tab, Agents: only while agents are on], [Downloads: only while one runs] | Suggestions panel toggle, Full screen, Menu.

**Capture** is one button that opens a menu: Screenshot (⌘⇧S, or S), Save page, Save media, Picture in picture (⌘⇧P). Use a native menu if the page is drawn above your HTML (Electron, Chromium), otherwise any menu.

## 5. Suggestions panel

- **Size:** 340 px wide. Electron build: floats beside the page with an 8 px gap and a 1 px `--line` border; the page narrows by 356 px. Chromium build: it is the side panel; Chromium draws the frame, so use `.panel.fill` (no border, no gap).
- **Tabs at the top** (`.panel-tabs`, 44 px, sticky): Suggest, Ask, Agent, Talk. Each tab is an icon; the selected tab also shows its label and a 2 px `--ink` underline. Unselected tabs are `--ink-muted`. Roles: `tablist` / `tab` / `tabpanel`, `aria-selected`, `aria-controls`. Left and right arrow keys move between tabs (`NodeUI.panelTabs`).
- **Right end of the tab bar:** Electron: a collapse button (`up` icon, 44 px wide, hairline on its left). Chromium: a `menu` button that opens NODE's menu page (Chromium already gives the side panel its own close button).
- **Not in the panel any more:** Settings and Trail (they are in the menu), and every "Back" button (tabs replace them).
- **Collapsed (Electron):** the panel is hidden, the page takes the full width, and the toolbar's panel toggle shows the result count, plus "+N" in `--signal` for results that arrived since it was collapsed (`NodeUI.paintCount`). Focus moves to the toggle. Shortcut ⌘⇧. toggles it. The open/closed state is remembered.
- **Inside the Suggest tab** (unchanged content): status line in mono (`12 RESULTS · 3 QUERIES · AUTO ON`), Auto and Crawl chips, keyword chips, result cards.

## 6. Menu

- **Sections, in this order:** Library, Bookmarks (⌘⇧B), History (⌘Y), Downloads, Trail, Settings (⌘,), Help. Each row: icon, uppercase label, shortcut in mono on the right. The current row has `aria-current="page"` and a `--surface-raised` background.
- **Layout:** 1040 × 720 px panel (or the window minus 16 px each side), 56 px header with "MENU", "Esc" and a close button, 264 px section list on the left, content on the right (scrolls).
- **Library** keeps its filters (All, Shots, Media, Saves). Bookmarks, History and Downloads are their own sections, not Library filters.
- **Help** is the Help part of Settings (diagnostics, updates, passkeys), shown on its own.
- **Opening:** from the toolbar Menu button (opens the last section), ⌘, (Settings), ⌘Y (History), ⌘⇧B (Bookmarks), the Downloads button (Downloads), and after a capture (Library). Focus goes to the current section row.
- **Closing:** Esc, the × button, or a click outside the panel. Focus returns to whatever opened it. Tab and Shift+Tab stay inside the menu while it is open (`NodeUI.menuOverlay`).
- **Electron:** an overlay with a 72% black scrim over a still picture of the page (the live page views are hidden while it is open). **Chromium:** a NODE extension page (`menu.html`) opened in a tab, or the browser's own settings page for browser settings; same markup without the scrim (`menu-example.html`).

## 7. Full screen

- The toolbar hides; the page fills the window. On entering, the toolbar stays for 1.8 s with a one-line hint ("Move the pointer to the top edge to show it. ⌃⌘F to exit.") for 4 s.
- Pointer within 2 px of the top edge: toolbar shows, page moves down. Pointer more than 16 px below the toolbar for 400 ms: it hides again.
- It stays shown while the address bar or find bar has focus, or a menu is open.
- A video's own full screen covers the whole window and never shows the toolbar.
- Chromium already behaves like this on a Mac; no work needed there.

## 8. Motion

- Hover: border fades in at `--motion-fast`, `--ease-move`.
- Turning on (toggle, tab): `--motion-base`, `--ease-enter`. Turning off: `--motion-fast`, `--ease-exit`.
- Menu panel fades in at `--motion-base`. No slide, no bounce.
- Reduced motion: fades only, all at `--motion-fast`.

## 9. Accessibility checklist

- Every icon button has `aria-label` and a tooltip; shortcuts in `aria-keyshortcuts`.
- Toggles use `aria-pressed`; the panel toggle also has `aria-controls`; the collapse button has `aria-expanded`.
- Panel tabs use tab roles and arrow keys.
- Menu: `role="dialog"`, `aria-modal`, focus moved in, kept in, and returned.
- Focus ring: 2 px `--signal`, 2 px offset, on keyboard focus.
- Text contrast: `--ink` and `--ink-muted` on both surfaces pass 4.5:1.
