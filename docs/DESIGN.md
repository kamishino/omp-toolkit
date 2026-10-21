# Design

The UI is a terminal surface. Styling is bound to `design/tokens.json` and
consumed through `packages/tui/src/theme.ts`. No raw color hex or padding
literals live in the renderer.

## Color tokens

| Token | ANSI index | Use |
|---|---:|---|
| `color.border` | 240 | Frame lines |
| `color.muted` | 245 | Labels, reset times, source line |
| `color.accent` | 81 | Title and provider headers |
| `color.ok` | 42 | Usage below the warm threshold |
| `color.warn` | 220 | Warm usage |
| `color.hot` | 208 | Hot usage |
| `color.danger` | 203 | Critical usage, HANG/ERR |

ANSI 256 indices are used instead of hex because the terminal owns the palette
and light/dark theme. `NO_COLOR=1` disables all color; the layout and symbols
remain readable. Status is never color-only: `OK`, `HANG`, `AUTH`, `MODEL`, and
`ERR` labels are always printed.

## Thresholds

| Token | Value | Meaning |
|---|---:|---|
| `usage.warmThreshold` | 0.40 | Green -> yellow |
| `usage.hotThreshold` | 0.70 | Yellow -> orange |
| `usage.criticalThreshold` | 0.85 | Orange -> red |
| `health.restoreStreak` | 3 | Healthy checks before auto-restore |
| `health.restoreGapSeconds` | 60 | Minimum spacing between counted checks |
| `health.staleSnapshotMinutes` | 15 | Mark the cached snapshot stale |

## Provider usage frame

- Fixed width: 86 columns.
- Frame: `╭ ╮ ╰ ╯ ├ ┤ │ ─`.
- Account column: 20 characters; local part of the email.
- Route column: 5 characters plus spacing, Google Antigravity only.
- Each usage window: 24 characters = 10-character bar + 6-character percent +
  6-character reset.
- Rows are sorted by route severity first (`HANG`/`ERR`, `AUTH`/`MODEL`, `OK`),
  then by highest selected usage.
- Summary: provider count, account count, >=80% count, maxed count, and the
  tightest provider:account.
- Provider sections are separated by a full-width rule.
- Google Antigravity is labeled `Gemini`; shared Claude/GPT 3P limits are not
  shown in this focused view.
- DeepSeek balances use `BALANCE`/`GRANTED` columns with `¥` for CNY and `$` for
  USD; CNY is preferred when both are returned.
## Accessibility

- Every colored value has a text label (`HANG`, percentage, reset).
- `NO_COLOR` is honored.
- Bars use `█`/`░` with a numeric percentage, so the magnitude survives
  monochrome terminals.
- Width is capped at 86 columns; the layout does not require a wide terminal.
