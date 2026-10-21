# OMP Toolkit

> **Unofficial.** This project is not affiliated with OMP, Orca, or Google.
> Gemini account rotation is experimental. Provider terms may restrict automated
> account rotation; use at your own risk.

[![check](https://github.com/kamishino/omp-toolkit/actions/workflows/check.yml/badge.svg)](https://github.com/kamishino/omp-toolkit/actions/workflows/check.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Status

| Component | Status |
|---|---|
| Provider usage monitor / TUI | Supported |
| DeepSeek balance (CNY preferred) | Supported |
| Reliability history and report | Supported |
| Orca Floating Workspace launcher | Supported on Windows |
| Gemini route-health rotation | Experimental |

## Requirements

- Windows 10 or 11
- Bun 1.4.3 or newer
- OMP 18.12.5
- Orca 1.4.226 (optional; only for `monitor:orca`)

macOS and Linux are not supported. Contributions that improve Windows behavior
are welcome; cross-platform ports are best-effort.

A Bun workspace monorepo for OMP operations tooling:

- **OMP Provider Usage** - one terminal view for every authenticated OMP
  provider, with per-account Gemini route health layered onto Google
  Antigravity.
- **Gemini Health extension** - event-driven route probing, temporary account
  circuit breakers, healthy-streak auto-restore, and guarded manual recovery.

The toolkit keeps `gemini-3.8-flash`; it rotates around a saturated account
instead of falling back to a less capable model.

## Layout

```text
omp-toolkit/
├─ apps/
│  ├─ omp-extension/        OMP adapter: hooks, commands, tool, health CLI
│  └─ provider-usage/       OMP Provider Usage CLI
├─ packages/
│  ├─ core/                 Pure domain: usage grouping, streaks, policies
│  └─ tui/                  ANSI design tokens + provider usage renderer
├─ design/tokens.json       Design-token SSOT for the terminal UI
├─ docs/                    Architecture, runbook, design, ADRs
├─ scripts/                 Build and install tooling
├─ package.json             Bun workspaces
├─ tsconfig.json
└─ biome.json
```

## Quick start

```powershell
git clone https://github.com/kamishino/omp-toolkit.git
cd omp-toolkit
bun install
bun run check
bun run install:omp
```

`install:omp` builds both apps, backs up the existing OMP artifacts under
`~/.omp/agent/backups/<timestamp>/`, installs:

```text
~/.omp/agent/extensions/gemini-health.js
~/.omp/agent/scripts/omp-provider-usage.js
```

and removes the legacy `.ts` copies so OMP does not load both.

## Commands

OMP extension:

```text
/gemini-health [--confirm]
/gemini-heal [--dry-run]
/gemini-restore
/gemini-enable <email-or-local-part> [--force]
/gemini-health-widget [on|off]
```

Provider usage CLI:

```bash
bun ~/.omp/agent/scripts/omp-provider-usage.js
bun ~/.omp/agent/scripts/omp-provider-usage.js --health
bun ~/.omp/agent/scripts/omp-provider-usage.js --watch --interval=300 --health
bun ~/.omp/agent/scripts/omp-provider-usage.js --json
```

Orca terminal tab (Floating Workspace):

```bash
bun run monitor:orca
```

Press `Ctrl+Alt+A` to toggle the Floating Workspace panel.

Manual fallback in another worktree:

```powershell
orca terminal create `
  --worktree active `
  --title "OMP Provider Usage" `
  --command "bun `"$HOME/.omp/agent/scripts/omp-provider-usage.js`" --watch --interval=300 --health" `
  --json
```

## Data flow

```text
OMP auto_retry_start / agent_end
        │
        ▼
gemini-health probe sweep (event/manual only)
        │
        ├─ auth.accountPolicies (reservePct=100)
        ├─ gemini-health-state.json
        ├─ gemini-health-streaks.json
        └─ gemini-health-latest.json
                    │
                    ▼
OMP Provider Usage CLI reads omp usage + the snapshot
```

- Usage reads (`omp usage`) are quota queries, not inference.
- The provider usage view reads the last health snapshot; it never probes.
- Health probes run only on a retry/error, a manual command, or the health CLI.
- Auto-restore applies to managed exclusions after three spaced healthy checks.
- Manual exclusions require `/gemini-enable` (guarded by the snapshot).

## Intervals and cost

Recommended refresh: **300 s**.

| Interval | `omp usage` calls/day | Model tokens |
|---:|---:|---:|
| 60 s | 1,440 | 0 |
| 120 s | 720 | 0 |
| 300 s | 288 | 0 |
| 600 s | 144 | 0 |

A health sweep (six Antigravity accounts) is about **66 tokens**; it happens
only on an event/manual check, not on the monitor's interval.

## Configuration

Environment variables:

```text
GEMINI_HEALTH_RESTORE_STREAK=3
GEMINI_HEALTH_RESTORE_GAP_SECONDS=60
PI_AI_ANTIGRAVITY_VERSION=2.24.0
OMP_BIN=omp
PI_CODING_AGENT_DIR=...
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Runbook](docs/RUNBOOK.md)
- [Roadmap](docs/ROADMAP.md)
- [Glossary](GLOSSARY.md)
- [Design tokens](docs/DESIGN.md)
- [ADR-0001: event-driven health](docs/ADR-0001-event-driven-health.md)
- [ADR-0002: opt-in auto-restore](docs/ADR-0002-opt-in-auto-restore.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [License](LICENSE)

## Development

```bash
bun test          # domain + TUI tests, no network
bun run typecheck # tsc --noEmit
bun run format    # Biome formatter
bun run check     # Biome + tsc + tests
bun run build     # bundle both apps
```

The OMP extension is deliberately bundled to one file because OMP auto-discovers
single extension modules. Shared domain and presentation logic lives in the
workspace packages.

Local AI assistant instructions, session handoffs, transcripts, and tool
configuration are intentionally not tracked. See `CONTRIBUTING.md`.
