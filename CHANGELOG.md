# Changelog

## Unreleased

- Reorganize documentation into lowercase files and `docs/adr/`.
- Add cross-platform installation and a Windows/macOS/Linux CI matrix.

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
