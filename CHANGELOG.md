# Changelog

## 0.4.0 — Desktop configuration settings, script modularization, and UX polish (2026-10-26)

- Add in-panel Desktop User Configuration Settings view toggled via header gear icon.
- Add atomic persistence for settings in Electron's `userData/settings.json`.
- Support live runtime reloading for polling intervals (30–3600s), DeepSeek balance alert thresholds, theme preferences (`system`, `light`, `dark`), and "start at login" autostart.
- Re-architect and modularize `scripts/` into cohesive feature subfolders: `build/`, `desktop/`, `eval/`, `install/`, `monitor/`, `reliability/`, and `tokens/`.
- Add cross-platform desktop shortcut generation CLI and module (`scripts/desktop/create-desktop-shortcut.ts`, `.ps1`).
- Polish desktop webview styling: segmented controls for theme switching, custom toggle switch, tactile button active states, and enhanced error state with in-line retry.
- Add interactive keybinding hints in TUI monitor (`r` refresh, `q` quit, `Tab` schedule).

## 0.3.0 — Desktop widget refresh, terminal launchers, and scrolling (2026-10-22)

- Add cross-platform terminal launchers (`omp-widget.cmd`, `omp-widget.sh`) and
  Windows desktop shortcut creator (`scripts/create-desktop-shortcut.ps1`).
- Fix desktop panel container height so provider content scrolls properly
  instead of clipping off-screen.
- Replace theSVG provider marks with Dashboard-Icons (Gemini, OpenAI,
  DeepSeek).
- Add self-hosted variable font pairing: Inter Variable for UI hierarchy and
  JetBrains Mono Variable for numeric and route tabular density.
- Expand desktop panel to 700×720 CSS Grid with roomier card padding, 24 px
  logos, and 30 px action buttons.
- Add rounded-square app-mark chip tray icon with bottom-right status badge
  dot.
- Add minimize-to-tray affordance with dynamic tray-menu label (`Minimize to tray`
  / `Show panel`).
- Add `desktop`, `desktop:preview`, and `desktop:once` NPM scripts; keep
  `bun run widget` as a compatibility alias.
- Fix desktop Electron entry point path to resolve `dist/main.cjs`.
## 0.2.0 — Cross-platform desktop widget (2026-10-21)

- Add Electron desktop widget host (`bun run widget`) with a notification-area /
  menu-bar icon and compact always-on-top panel.
- Add OKLCH desktop light and dark color tokens, spacing, typography, and an
  automated APCA (|Lc| >= 60) contrast gate (`scripts/check-tokens.ts`).
- Add pure shared dashboard model in `@omp-toolkit/core` with versioned schema-2
  JSON payload in `apps/provider-usage`.
- Refactor `@omp-toolkit/tui` to consume the shared core dashboard model without
  output drift.
- Add vector Material Design Icons (`@mdi/js`) for panel actions and provider
  brand logos from theSVG (Google, OpenAI, DeepSeek).
- Use maintained dependencies (`colorjs.io/fn`, `which`, `shell-quote`, `plist`,
  `@mdi/js`) with partial-import paths.
- Reorganize documentation into lowercase files, record ADR-0005, and add a
  Windows/macOS/Linux CI matrix.
- Add `THIRD_PARTY_NOTICES.md` covering all third-party dependencies and brand
  trademarks.
## 0.1.0 — Initial public release (2026-10-21)

- Add `@omp-toolkit/core` domain package for provider usage grouping, column
  selection, route ordering, healthy streaks, and policy membership.
- Add `@omp-toolkit/tui` package with design-token-backed ANSI theme and the
  OMP Provider Usage frame.
- Add `apps/provider-usage` CLI showing all authenticated OMP providers with
  per-account Gemini route status.
- Add `apps/omp-extension` event-driven Gemini health adapter with temporary
  account circuit breakers, healthy-streak auto-restore, guarded explicit
  re-enable, and health snapshot persistence.
- Add provider-usage monitor, DeepSeek balance, Gemini route health, reliability
  history, and Orca Floating Workspace launcher.
- Publish under the MIT license with a Windows-first support boundary.
- Add Bun workspace tooling, tests, build/install scripts, and docs.
