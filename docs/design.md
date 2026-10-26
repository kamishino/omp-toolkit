# Design

The toolkit supports two visual surfaces: a terminal TUI and a cross-platform
desktop widget. Styling is bound to `design/tokens.json` and consumed through
`packages/tui/src/theme.ts` for ANSI terminal rendering and
`apps/desktop/src/renderer/tokens.ts` for desktop CSS variables. Zero raw color
hex or px literals live in the renderers.

## Color tokens

| Token          | ANSI index | Use                              |
| -------------- | ---------: | -------------------------------- |
| `color.border` |        240 | Frame lines                      |
| `color.muted`  |        245 | Labels, reset times, source line |
| `color.accent` |         81 | Title and provider headers       |
| `color.ok`     |         42 | Usage below the warm threshold   |
| `color.warn`   |        220 | Warm usage                       |
| `color.hot`    |        208 | Hot usage                        |
| `color.danger` |        203 | Critical usage, HANG/ERR         |

ANSI 256 indices are used instead of hex because the terminal owns the palette
and light/dark theme. `NO_COLOR=1` disables all color; the layout and symbols
remain readable. Status is never color-only: `OK`, `HANG`, `AUTH`, `MODEL`, and
`ERR` labels are always printed.

## Thresholds

| Token                         | Value | Meaning                                |
| ----------------------------- | ----: | -------------------------------------- |
| `usage.warmThreshold`         |  0.40 | Green -> yellow                        |
| `usage.hotThreshold`          |  0.70 | Yellow -> orange                       |
| `usage.criticalThreshold`     |  0.85 | Orange -> red                          |
| `usage.aboveThreshold`        |  0.80 | Summary >=80% count                    |
| `health.restoreStreak`        |     3 | Healthy checks before auto-restore     |
| `health.restoreGapSeconds`    |    60 | Minimum spacing between counted checks |
| `health.staleSnapshotMinutes` |    15 | Mark the cached snapshot stale         |

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
- Column width is computed once from the widest section and shared by every
  provider so headers and values align.
- The `ROUTE` column is present for every provider section whenever any
  account has route health; accounts without health show `—`.
- DeepSeek `Balance` cells at or below the configured threshold render red
  with `LOW` (or a red `!` prefix in very narrow columns).

## Desktop panel

- Window dimensions: 700×720 DIP, frameless, always-on-top, clamped to the display work area with 12px margin.
- Theme: follows the OS light/dark appearance via `prefers-color-scheme` and updates live.
- Tokens: defined in `design/tokens.json` under `desktop.color.light`, `desktop.color.dark`, `desktop.space`, `desktop.font`, and `desktop.size`.
- Spacing scale: `xs: 4`, `sm: 8`, `md: 12`, `lg: 16`, `xl: 24`, `2xl: 32`.
- Typography: Inter Variable (UI headings, labels, button text) + JetBrains Mono Variable (account, route, limits, numeric data), self-hosted as WOFF2. Scale: `xs: 12`, `sm: 13`, `md: 14`, `lg: 16`, `xl: 20`.
- Contrast gate: all body, label, and status text meet APCA |Lc| >= 60 against both `surface` and `surfaceRaised`, checked via `scripts/check-tokens.ts`.
- Layout:
  - Header: title `OMP PROVIDER USAGE`, status subtitle (`updated HH:mm`, `Refreshing...`, or `Refresh failed`), Refresh (`mdiRefresh`), Minimize (`mdiWindowMinimize`), and Close (`mdiClose`) vector icon buttons from Material Design Icons (`@mdi/js`).
  - Summary: provider count, account count, >=80% count, maxed count, tightest provider:account.
  - Content: scrollable container holding cards per provider section.
  - Provider cards: each card features a 24 px provider logo slot before the title. Google Antigravity (Gemini mark), OpenAI, and DeepSeek display vector marks from Dashboard-Icons; OpenAI automatically swaps `openai-light.svg` on light themes and `openai-dark.svg` on dark themes; Muse Code displays an empty slot to maintain vertical alignment.
  - Table: `ACCOUNT` (26%), `ROUTE` (12%), and provider limit columns. Account cell colored by row severity.
  - Route cell: text badge (`OK`, `HANG`, `AUTH`, `MODEL`, `ERR`, `—`) with semantic color.
  - Limits: progress bar (`<progress>` with `currentColor` value) + numeric percentage + reset countdown; DeepSeek displays currency amount with red `LOW` label.
  - Footer: data source line with health age (`(stale)` when > 15 minutes) and refresh interval.
  - Tray icon: 16×16 (@2x 32×32) rounded-square app mark with a status badge dot matching the worst route/usage severity rank, anti-aliased with a 1px ring in the theme's surface color.
## Accessibility

- Every colored value has a text label (`HANG`, `LOW`, percentage, reset).
- `NO_COLOR` is honored.
- Bars use `█`/`░` with a numeric percentage, so the magnitude survives
  monochrome terminals.
- Width is capped at 86 columns; the layout does not require a wide terminal.
- On the desktop widget, progress bars use accessible `<progress>` elements with `aria-label` describing the limit and value.
- Desktop icon buttons include explicit `aria-label` attributes (`Refresh`, `Minimize to tray`, `Close to tray`).
- Status updates in the desktop header use `aria-live="polite"` on the status subtitle.
