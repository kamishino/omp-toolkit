<div align="center">

<h2>OMP Toolkit</h2>

<p>One terminal and desktop view for OMP provider usage, Gemini route health, DeepSeek balance, and 30-day reliability history.</p>

[![check](https://github.com/kamishino/omp-toolkit/actions/workflows/check.yml/badge.svg)](https://github.com/kamishino/omp-toolkit/actions/workflows/check.yml)
![Bun](https://img.shields.io/badge/Bun-1.4.3-000000?style=for-the-badge&logo=bun&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![OMP](https://img.shields.io/badge/OMP-18.12.5-111111?style=for-the-badge)
![Platforms](https://img.shields.io/badge/platform-windows%20%7C%20macos%20%7C%20linux-4B5563?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)

</div>

> [!IMPORTANT]
> **Unofficial.** Not affiliated with OMP, Orca, or Google. Gemini account rotation is experimental. Provider terms may restrict automated account rotation; use at your own risk.

## Overview

OMP Toolkit is an unofficial, Windows-first, cross-platform toolkit for OMP. It aggregates `omp usage --json` and cached route health snapshots into a single ANSI frame or desktop tray widget, revealing quota consumption, circuit-broken accounts, and reset countdowns across providers.

The monitor performs passive reads and never probes models directly, ensuring an active monitoring tab consumes zero model tokens. Route health checks are strictly event-driven or manually triggered, exclusions are tracked in atomic state files and a 30-day SQLite history ledger, and managed exclusions auto-restore only after spaced healthy-check streaks.

## Features

- **Provider usage monitor:** Unified frame for Google Antigravity, OpenAI Codex, Muse Code, and DeepSeek with quota progress bars, percentages, reset countdowns, and aligned route status columns.
- **Gemini route health circuit breaker:** Detects per-account `OK`, `HANG`, `ERR`, `AUTH`, and `MODEL` states; applies automatic temporary exclusions on route stalls, and executes guarded auto-restore upon consecutive healthy checks.
- **DeepSeek balance tracking:** Currency-aware balance reporting (CNY-preferred with USD fallback) with configurable low-balance warning alerts.
- **Flexible presentation surfaces:** In-place ANSI redraw for Windows Terminal, PowerShell, Git Bash, tmux, and standard TTYs; optional alternate-screen suppression (`--no-alt-screen`).
- **Desktop system tray widget (optional):** Cross-platform Electron tray and panel for Windows and macOS (best-effort on Linux). Features OS light/dark OKLCH theme adaptation, startup login registration, and account warm-up actions.
- **Orca Floating Workspace (optional):** One-command live monitor tab launching in Orca with `Ctrl+Alt+A` (Windows) and `Cmd+Alt+A` (macOS) shortcuts.
- **Local reliability history:** Local-first SQLite event ledger recording route checks, policy modifications, and heartbeat timestamps with 30-day reporting (`reliability:report`).

## Architecture

The codebase enforces strict unidirectional layering with zero I/O leakage into domain models:

| Layer                       | Package / Path        | Responsibility                                                                                                                          |
| --------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Domain**                  | `packages/core`       | Pure usage grouping, column selection, route ordering, streak transitions, and dashboard models (0 filesystem, network, or OMP imports) |
| **Presentation (terminal)** | `packages/tui`        | ANSI design tokens, semantic thresholds, progress bars, percentages, and provider usage views                                           |
| **Presentation (desktop)**  | `apps/desktop`        | Electron host, system tray, OS login item, and context-isolated webview panel styled via OKLCH tokens                                   |
| **Adapters (OMP)**          | `apps/omp-extension`  | OMP hooks, auto-heal coordinator, CLI commands, tool definitions, account probing client, and state persistence                         |
| **Adapters (CLI)**          | `apps/provider-usage` | CLI flags, `omp usage` reader, snapshot cache reader, watch loop, and schema-2 JSON payload emitter                                     |
| **Design**                  | `design/tokens.json`  | Design-token single source of truth for TUI ANSI and desktop OKLCH palettes                                                             |

For complete architectural diagrams, data transformation pipelines, and circuit-breaker event sequence diagrams, see [docs/architecture.md](docs/architecture.md).

## Tech Stack

- **Bun 1.4.3** — Runtime, package workspace manager, unified bundler (`Bun.build`), and test runner.
- **TypeScript** — Strongly-typed domain and adapter contracts checked via `tsc --noEmit`.
- **Electron** — Desktop widget host with context isolation and Content Security Policy blocking external network access.
- **Inter & JetBrains Mono** — Self-hosted variable font pairing via Fontsource (SIL OFL 1.1) for high-density tabular presentation.
- **Biome** — Formatter and lint gate.
- **SQLite** — Reliability history event ledger powered by `bun:sqlite`.
- **OMP 18.12.5** — Extension host and `omp usage --json` data source.
- **Orca 1.4.226** — Optional host for Floating Workspace integration.

## Data Sources and Integrations

- **OMP CLI** — Authoritative usage metrics (`omp usage --json`). Quota windows, limits, and account metadata are read directly from local OMP runtimes without scraping.
- **DeepSeek Balance API** — Queried via `https://api.deepseek.com/user/balance` using `DEEPSEEK_API_KEY` by the registered extension provider.
- **Desktop Widget** — Local-first; executes the installed CLI script and renders versioned JSON locally without outbound network access.
- **Orca CLI** — Spawns or focuses the floating terminal workspace tab when Orca is running.

## Getting Started

### Prerequisites

- **Bun** 1.4.3 or newer — [Installation Guide](https://bun.sh/docs/installation)
- **Git**
- **OMP** 18.12.5
- **Orca** 1.4.226 — Optional; required only for `monitor:orca`

### One-Command Quickstart

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/kamishino/omp-toolkit/main/install.ps1 | iex
```

**macOS / Linux (Bash):**

```bash
curl -fsSL https://raw.githubusercontent.com/kamishino/omp-toolkit/main/install.sh | bash
```

The installer verifies prerequisites, clones or updates `~/.omp/omp-toolkit`, runs `bun install --frozen-lockfile`, and executes `bun run install:omp`.

### Manual Installation

```bash
git clone https://github.com/kamishino/omp-toolkit.git
cd omp-toolkit
bun install --frozen-lockfile
bun run install:omp
```

To preview installation actions without modifying the filesystem:

```bash
bun scripts/install.ts --dry-run
```

`install:omp` creates atomic backups under `~/.omp/agent/backups/`, installs `gemini-health.js` into `~/.omp/agent/extensions`, and installs `omp-provider-usage.js` into `~/.omp/agent/scripts`.

### Verification

```bash
bun "$HOME/.omp/agent/scripts/omp-provider-usage.js" --health
bun run desktop:once
```

Expected output: a complete provider usage frame displaying quota columns (`ROUTE`, `WEEKLY`, `5 HOUR`), followed by a plain-text diagnostic summary from the desktop widget.

## Platform Support

| Component                         | Status               | Target Platforms                                                      |
| --------------------------------- | -------------------- | --------------------------------------------------------------------- |
| **Terminal Monitor (TUI)**        | Supported            | Windows, macOS, Linux (any ANSI TTY)                                  |
| **Desktop Widget**                | Supported            | Windows 10/11, macOS; Linux best-effort (StatusNotifier/AppIndicator) |
| **DeepSeek Balance & Alerts**     | Supported            | Windows, macOS, Linux                                                 |
| **Reliability History & Reports** | Supported            | Windows, macOS, Linux                                                 |
| **Orca Workspace Launcher**       | Supported (Optional) | Windows; macOS/Linux via `ORCA_BIN` or `orca-ide`                     |
| **Gemini Route Circuit Breaker**  | Experimental         | Windows, macOS, Linux (OMP CLI)                                       |

## Usage

### Terminal Monitor

Run directly from the repository checkout:

```bash
bun run monitor
bun run monitor --interval=600
bun run monitor --no-health
bun run monitor --no-alt-screen
```

Or execute the installed standalone script without the repository checkout:

```bash
bun "$HOME/.omp/agent/scripts/omp-provider-usage.js"
bun "$HOME/.omp/agent/scripts/omp-provider-usage.js" --health
bun "$HOME/.omp/agent/scripts/omp-provider-usage.js" --json
bun "$HOME/.omp/agent/scripts/omp-provider-usage.js" --watch --interval=300 --health
```

Sample output:

```text
╭─ OMP Provider Usage ───────────────────────────────────────────────── 08:53:04 PM ─╮
│ 2 providers · 3 accounts · 0 ≥80% · 0 maxed · tightest antigravity:alpha 70%       │
├────────────────────────────────────────────────────────────────────────────────────┤
│ GOOGLE ANTIGRAVITY · 2 accounts · Gemini                                           │
│ ACCOUNT              ROUTE  WEEKLY                     5 HOUR                      │
│ bravo                HANG   ░░░░░░░░░░   0.2%  1d23h   ░░░░░░░░░░   0.0%    59m    │
│ alpha                  —    ███████░░░  69.9%  2d23h   █░░░░░░░░░  12.0%  3h59m    │
├────────────────────────────────────────────────────────────────────────────────────┤
│ DEEPSEEK · 1 account · CNY                                                         │
│ ACCOUNT              ROUTE  BALANCE                    GRANTED                     │
│ api-key                —    ¥42.50                     ¥0.00                       │
├────────────────────────────────────────────────────────────────────────────────────┤
│ Source: omp usage · health 3m ago · one-shot                                       │
╰────────────────────────────────────────────────────────────────────────────────────╯
```

### OMP Extension Commands

Interact with the circuit breaker directly from inside OMP:

```text
/gemini-health [--confirm]                   # Probe all accounts and refresh status
/gemini-heal [--dry-run]                     # Reserve failing accounts (reservePct: 100)
/gemini-restore                              # Remove exclusions managed by auto-heal
/gemini-enable <account> [--force]           # Re-enable an excluded account
/gemini-health-widget [on|off]               # Toggle TUI status widget visibility
/gemini-warmup <account>|--all               # Send minimal warm-up request to OK accounts
/gemini-check <account>                      # Probe specific account to verify route recovery
```

### Desktop Widget

```bash
bun run desktop             # Launch tray widget in background
bun run desktop:preview     # Launch widget with panel immediately visible
bun run desktop:once        # Run headless diagnostic and output summary
bun run desktop:shortcut    # Create desktop launcher (Windows, macOS, Linux)
```

Create a desktop shortcut to launch the widget with one click:

```bash
bun run desktop:shortcut
```

On Windows, `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/create-desktop-shortcut.ps1` can also be executed directly.

The desktop panel includes a `Warm up all` header control and per-account `Warm up` and `Check` buttons. Warm-up sends minimal model prompts to eligible accounts (skipping non-OK rows) while enforcing a 60-second cooldown per account and cross-process single-flight locking.

### Orca Floating Workspace

```bash
bun run monitor:orca
```

Shortcut: `Ctrl+Alt+A` on Windows, `Cmd+Alt+A` on macOS. Launches or focuses a dedicated floating monitor tab inside Orca.

## Configuration

| Environment Variable                | Description                                          | Default              |
| ----------------------------------- | ---------------------------------------------------- | -------------------- |
| `DEEPSEEK_API_KEY`                  | API key for DeepSeek balance queries                 | —                    |
| `DEEPSEEK_BALANCE_ALERT_CNY`        | Low-balance threshold in CNY                         | `10`                 |
| `DEEPSEEK_BALANCE_ALERT_USD`        | Low-balance threshold in USD                         | `10`                 |
| `OMP_BIN`                           | Path or name of OMP executable                       | `omp`                |
| `OMP_TOOLKIT_HOME`                  | Repository checkout directory path                   | `~/.omp/omp-toolkit` |
| `OMP_WIDGET_INTERVAL_SECONDS`       | Desktop widget polling interval in seconds           | `300` (min: `30`)    |
| `BUN_BIN`                           | Bun executable override for desktop subprocesses     | System `bun`         |
| `PI_CODING_AGENT_DIR`               | OMP agent state directory override                   | `~/.omp/agent`       |
| `GEMINI_HEALTH_RESTORE_STREAK`      | Consecutive healthy checks required for auto-restore | `3`                  |
| `GEMINI_HEALTH_RESTORE_GAP_SECONDS` | Minimum seconds required between streak checks       | `60`                 |
| `PI_AI_ANTIGRAVITY_VERSION`         | Antigravity client version header override           | `2.24.0`             |
| `ORCA_BIN`                          | Custom Orca CLI executable path override             | Auto-detected        |
| `ORCA_CLI_COMMAND`                  | Custom Orca-managed CLI command override             | Auto-detected        |

## Project Structure

```text
apps/
  desktop/              Desktop widget host (Electron main, tray, panel, webview renderer)
  omp-extension/        OMP plugin (lifecycle hooks, commands, tools, circuit-breaker)
  provider-usage/       Terminal monitor CLI and schema-2 JSON payload emitter
packages/
  core/                 Pure domain logic: dashboard models, timetable schedule evaluator, types
  tui/                  ANSI presentation tokens, formatting widgets, and terminal views
design/tokens.json      Design-token single source of truth for ANSI and OKLCH
docs/
  adr/                  Architecture decision records (ADR 0001–0008)
  architecture.md       Layering, build pipelines, and Mermaid interaction diagrams
  design.md             Visual tokens, layout spacing, and threshold rules
  roadmap.md            90-day reliability scaling and platform roadmap
  runbook.md            Operational diagnostics and incident runbooks
scripts/                Unified build orchestrator, installer, monitor launcher, reliability report
```

## Development

```bash
bun install             # Install dependencies
bun test                # Run unit tests across all packages
bun run typecheck       # Check TypeScript types (workspace and desktop)
bun run check           # Run Biome linter, typecheck, tests, and token checks
bun run build           # Compile all workspace bundles (extension, CLI, desktop)
bun run build:desktop   # Compile desktop bundles only
```

## Documentation

- [Architecture Blueprint](docs/architecture.md)
- [Folder Structure Blueprint](Project_Folders_Structure_Blueprint.md)
- [Design Tokens & UI System](docs/design.md)
- [Operational Runbook](docs/runbook.md)
- [Reliability Roadmap](docs/roadmap.md)
- [Architecture Decision Records (ADRs)](docs/adr/README.md)
- [System Glossary](GLOSSARY.md)
