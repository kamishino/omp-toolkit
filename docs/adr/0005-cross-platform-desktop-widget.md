# ADR-0005: Cross-platform desktop widget host

- Status: Accepted
- Date: 2026-10-21

## Context

The Windows-only PowerShell/WinForms tray plan would have introduced a second
presentation stack with duplicate provider formatting, thresholds, and ad-hoc
RGB colors, and it could not run on macOS or Linux. The repository is a
Bun/TypeScript monorepo with pure domain logic in `packages/core`, ANSI
rendering in `packages/tui`, and a source-only release policy defined by
ADR-0003.

## Decision

- Implement the desktop widget using Electron and TypeScript in `apps/desktop`.
  The UI renderer is vanilla DOM and CSS without frameworks.
- Distribution is source-run only via `bun run desktop` (`bun run widget`
  remains a compatibility alias); no packaged binaries,
  installers, codesigning identities, or auto-updaters are introduced.
- The installed monitor CLI (`omp-provider-usage.js --json --health`) is the
  single data seam. It outputs a versioned schema-2 payload containing a
  `dashboard` object built by `packages/core`.
- `design/tokens.json` remains the single source of truth for both TUI ANSI
  colors and desktop OKLCH light/dark palettes, validated by APCA |Lc| >= 60.
- Platform support: Windows 10/11 and macOS are supported. Linux is best-effort
  because system tray icon delivery depends on StatusNotifierItem/AppIndicator.
- Autostart is opt-in per OS using native registration without administrator
  privileges.

## Consequences

- `bun install` downloads the Electron binary on local machines; CI sets
  `ELECTRON_SKIP_BINARY_DOWNLOAD=1` to keep checks lightweight.
- `omp-provider-usage --json` shifts to schema 2, breaking unversioned callers.
- Packaged releases and signed installers remain out of scope and require a
  future ADR.
- Linux environments lacking a system tray daemon fall back to the terminal TUI
  (`bun run monitor`).
