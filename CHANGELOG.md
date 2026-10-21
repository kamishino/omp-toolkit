# Changelog

## Unreleased

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
