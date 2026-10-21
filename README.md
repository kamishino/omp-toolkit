# OMP Toolkit

> **Unofficial.** Not affiliated with OMP, Orca, or Google. Gemini account
> rotation is experimental. Provider terms may restrict automated account
> rotation; use at your own risk.

[![check](https://github.com/kamishino/omp-toolkit/actions/workflows/check.yml/badge.svg)](https://github.com/kamishino/omp-toolkit/actions/workflows/check.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

One terminal view for OMP provider usage, Gemini route health, DeepSeek balance,
and a 30-day reliability history.

## Features

- Provider usage monitor for Google Antigravity, OpenAI Codex, Muse Code, and
  DeepSeek.
- Per-account Gemini route health with temporary account circuit breakers.
- DeepSeek balance with CNY preference and USD fallback.
- Local SQLite reliability history and `reliability:report`.
- One-command Orca Floating Workspace launcher on Windows; best-effort on
  macOS/Linux.

## Status

| Component | Status |
|---|---|
| Provider usage monitor / TUI | Supported |
| DeepSeek balance (CNY preferred) | Supported |
| Reliability history and report | Supported |
| Orca Floating Workspace launcher | Supported on Windows; best-effort on macOS/Linux |
| Gemini route-health rotation | Experimental |

## Platform support

| Platform | Install / build / CLI | Orca Floating Workspace |
|---|---|---|
| Windows 10/11 | Supported | Supported |
| macOS | Supported | Best-effort |
| Linux | Supported | Best-effort; resolves `orca-ide` or `ORCA_BIN` |

CI runs the full check suite on `windows-latest`, `macos-latest`, and
`ubuntu-latest`.

## Requirements

- Bun 1.4.3 or newer
- OMP 18.12.5
- Git
- Orca 1.4.226 (optional; only for `monitor:orca`)

## Installation

### Windows (PowerShell)

```powershell
git clone https://github.com/kamishino/omp-toolkit.git
cd omp-toolkit
bun install
bun run check
bun run install:omp
```

### macOS / Linux (Bash)

```bash
git clone https://github.com/kamishino/omp-toolkit.git
cd omp-toolkit
bun install
bun run check
bun run install:omp
```

`install:omp` writes to `$HOME/.omp/agent` (or `PI_CODING_AGENT_DIR`) and
backs up existing artifacts first. Use
`bun scripts/install.ts --dry-run` to print the source and destination paths
without changing anything.

## Quick start

```bash
bun "$HOME/.omp/agent/scripts/omp-provider-usage.js" --health
bun "$HOME/.omp/agent/scripts/omp-provider-usage.js" --watch --interval=300 --health
```

Windows PowerShell accepts the same `$HOME` paths.

## Usage

### OMP extension commands

```text
/gemini-health [--confirm]
/gemini-heal [--dry-run]
/gemini-restore
/gemini-enable <email-or-local-part> [--force]
/gemini-health-widget [on|off]
```

### Provider usage CLI

```bash
bun "$HOME/.omp/agent/scripts/omp-provider-usage.js"
bun "$HOME/.omp/agent/scripts/omp-provider-usage.js" --health
bun "$HOME/.omp/agent/scripts/omp-provider-usage.js" --json
bun "$HOME/.omp/agent/scripts/omp-provider-usage.js" --watch --interval=300 --health
```

### Orca Floating Workspace

```bash
bun run monitor:orca
```

Windows shortcut: `Ctrl+Alt+A`. macOS shortcut: `Cmd+Alt+A`.
The launcher resolves `ORCA_BIN`, then `ORCA_CLI_COMMAND`, then
`ORCA_DEV_REPO_ROOT` (`orca-dev`), then `orca-ide` on Linux, then `orca`.
Orca integration outside Windows is best-effort.

## Configuration

| Variable | Purpose |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek balance queries |
| `DEEPSEEK_BALANCE_ALERT_CNY` | Low-balance threshold in CNY, default 10 |
| `DEEPSEEK_BALANCE_ALERT_USD` | Low-balance threshold in USD, default 10 |
| `OMP_BIN` | OMP executable, default `omp` |
| `PI_CODING_AGENT_DIR` | OMP agent directory override |
| `GEMINI_HEALTH_RESTORE_STREAK` | Healthy checks before auto-restore |
| `GEMINI_HEALTH_RESTORE_GAP_SECONDS` | Minimum spacing between checks |
| `PI_AI_ANTIGRAVITY_VERSION` | Antigravity client version header |
| `ORCA_BIN` | Orca CLI executable override |
| `ORCA_CLI_COMMAND` | Orca-managed CLI command override |

## Project structure

```text
apps/
  omp-extension/        OMP adapter: hooks, commands, tool, health CLI
  provider-usage/       OMP Provider Usage CLI
packages/
  core/                 Pure domain logic and history types
  tui/                  ANSI design tokens and provider usage renderer
docs/
  adr/                  Architecture decision records
  architecture.md
  design.md
  roadmap.md
  runbook.md
design/tokens.json      Design-token SSOT
scripts/                Build, install, Orca launcher, reliability report
```

## Development

```bash
bun test
bun run typecheck
bun run format
bun run check
bun run build
```

## Documentation

- [Architecture](docs/architecture.md)
- [Design](docs/design.md)
- [Runbook](docs/runbook.md)
- [Roadmap](docs/roadmap.md)
- [ADRs](docs/adr/README.md)
- [Glossary](GLOSSARY.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). AI assistant instructions, session
handoffs, transcripts, and local tool configuration are intentionally not
tracked.

## Security

See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
