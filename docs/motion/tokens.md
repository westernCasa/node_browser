# NODE motion tokens

These mirror section 8 (Motion) of the NODE design system. The CSS tokens live in `:root` in `renderer/styles.css`. Every animation in NODE uses one of them; nothing uses a hard-coded duration or curve.

## Durations

| Token | Value | Use it for |
| --- | --- | --- |
| `--motion-fast` | 120ms | Hover, exits, a state turning off. Also every fade when reduced motion is on. |
| `--motion-base` | 200ms | Small things entering, a state turning on. |
| `--motion-slow` | 320ms | Result cards entering, a list closing a gap, tab windows going into Mosaic. |
| `--motion-type` | 160ms | A single line of text typed out left to right. |

## Curves

| Token | Value | Use it for |
| --- | --- | --- |
| `--ease-enter` | `cubic-bezier(0, 0, 0.2, 1)` | Things arriving: starts fast, settles. |
| `--ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | Things going away: starts slow, leaves fast. |
| `--ease-move` | `cubic-bezier(0.4, 0, 0.2, 1)` | Moving between two on-screen states, hovers. |
| `--ease-type` | `steps(14, end)` | Typing only: 14 even jumps. |

## Main process (tab windows)

The tab windows are native Electron views, not HTML, so the main process (`main.js`) cannot read CSS. It keeps copies of two durations:

| Constant in `main.js` | Value | Must match |
| --- | --- | --- |
| `MOTION_SLOW` | 320 | `--motion-slow` |
| `MOTION_BASE` | 200 | `--motion-base` |

If you change either token, change the constant too.

Electron's `View.setBounds(bounds, { animate })` only offers four curves: `linear`, `ease-in`, `ease-out`, `ease-in-out`. NODE maps them like this:

| Electron easing | Stands in for | Used for |
| --- | --- | --- |
| `ease-out` | `--ease-enter` | Focus → Mosaic, Mosaic → Focus |
| `ease-in-out` | `--ease-move` | Tiles moving to new cells when a tab opens or closes in Mosaic |

They are close in feel but not identical curves.

The suggestions widget (10) uses the real cubic-bezier curves instead: `main.js` steps the page view along them itself (`cubicBezier()`, `slideViews()`), because the page edge has to move exactly with the widget, which uses the CSS tokens. The full-screen toolbar (09) slides in its own layer with CSS, so it uses the CSS tokens directly.

| Constant in `main.js` | Value | Must match |
| --- | --- | --- |
| `EASE_ENTER` | `[0, 0, 0.2, 1]` | `--ease-enter` |
| `EASE_EXIT` | `[0.4, 0, 1, 1]` | `--ease-exit` |

## Rules

- Animate only `transform` and `opacity`. Agreed exceptions:
  - colour and border fades on state changes;
  - `height` for a list closing a gap;
  - `clip-path` for the single-line type-out;
  - tab window bounds in Mosaic (08) and when the suggestions widget opens or closes (10): native views can only be moved and resized, not transformed.
- Exits are faster than entrances.
- Motion follows the confirmed state, not the click.
- Animate on user action only.
- Reduced motion: no movement; colour and opacity fades at `--motion-fast`. The main process checks `systemPreferences.getAnimationSettings().prefersReducedMotion` at each change.
- The focus ring (`:focus-visible`, 2px `--signal`, 2px offset) never animates.
