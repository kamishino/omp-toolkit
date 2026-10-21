<div align="center">

<h2>OMP Toolkit</h2>

<p>One terminal view for OMP provider usage, Gemini route health, DeepSeek balance, and a 30-day reliability history.</p>

[![check](https://github.com/kamishino/omp-toolkit/actions/workflows/check.yml/badge.svg)](https://github.com/kamishino/omp-toolkit/actions/workflows/check.yml)
![Bun](https://img.shields.io/badge/Bun-1.4.3-000000?style=for-the-badge&logo=bun&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![OMP](https://img.shields.io/badge/OMP-18.12.5-111111?style=for-the-badge)
![Platforms](https://img.shields.io/badge/platform-windows%20%7C%20macos%20%7C%20linux-4B5563?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)

</div>

> **Unofficial.** Not affiliated with OMP, Orca, or Google. Gemini account
> rotation is experimental. Provider terms may restrict automated account
> rotation; use at your own risk.

## 💡 Overview

OMP Toolkit is an unofficial, Windows-first toolkit for OMP. It reads
`omp usage --json` and the extension's cached route snapshot, then renders one
ANSI frame in any terminal showing which provider window is burning, which
Gemini account is circuit-broken, and when each limit resets.

The monitor never probes a model, so an idle watch tab spends zero tokens.
Route checks are event-driven, exclusions are backed by a local snapshot and a
30-day SQLite history, and managed exclusions restore only after a configurable
healthy streak. Orca's Floating Workspace is an optional host; the monitor does
not require Orca.

## ✨ Features

- **📊 Provider usage monitor:** One frame for Google Antigravity, OpenAI Codex,
  Muse Code, and DeepSeek, with bars, percentages, reset countdowns, and aligned
  `ROUTE` columns.
- **🩺 Gemini route health:** Per-account `OK` / `HANG` / `ERR` / `AUTH` /
  `MODEL` states, temporary circuit breakers, and guarded auto-restore.
- **💰 DeepSeek balance alerts:** CNY-preferred balance with USD fallback and a
  red `LOW` label at configurable thresholds.
- **🗂️ Reliability history:** Local SQLite log of route checks, policy changes,
  interventions, and monitor heartbeats, plus a 30-day `reliability:report`.
- **🖥️ Any terminal:** `--watch` redraws in place in Windows Terminal,
  PowerShell, cmd, Git Bash, iTerm2, Terminal.app, GNOME Terminal, tmux, and
  screen. `--no-alt-screen` appends frames for terminals without alternate
  screen support.
- **🪟 Orca Floating Workspace (optional):** One-command live monitor tab on
  Windows; `Ctrl+Alt+A` on Windows and `Cmd+Alt+A` on macOS.
- **🔒 Local-first:** No server and no telemetry; state stays under
  `~/.omp/agent`.

## 👩‍💻 Tech Stack

- **Bun 1.4.3** — runtime, workspace manager, bundler (`Bun.build`), and test
  runner.
- **TypeScript** — domain and adapter code checked with `tsc --noEmit`.
- **Biome** — formatter and lint gate.
- **SQLite** — reliability history through `bun:sqlite`.
- **OMP 18.12.5** — extension host and the `omp usage --json` data source.
- **Orca 1.4.226** — optional host for the Floating Workspace tab.

## 📖 Sources and external APIs

- **OMP CLI** — the only usage source (`omp usage --json`). Limits and account
  metadata come from the local OMP runtime; the toolkit does not scrape
  provider dashboards.
- **DeepSeek balance API** — `https://api.deepseek.com/user/balance`, read by
  the `deepseek` usage provider that the extension registers with OMP, using
  `DEEPSEEK_API_KEY`.
- **Orca CLI** — launches the Floating Workspace tab when Orca is running.
- **Gemini / Antigravity, OpenAI Codex, Muse Code** — authenticated accounts,
  windows, and usage are supplied by OMP.

## 📦 Getting Started

Install the toolkit with one command, or use the manual steps if you prefer to
read every command first.

### 🚀 Prerequisites

- **Bun** 1.4.3 or newer — [installation guide](https://bun.sh/docs/installation)
- **Git**
- **OMP** 18.12.5
- **Orca** 1.4.226 — optional; only needed for `monitor:orca`

## 🛠️ Installation

### ⚡ One command

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/kamishino/omp-toolkit/main/install.ps1 | iex
```

**macOS / Linux (Bash):**

```bash
curl -fsSL https://raw.githubusercontent.com/kamishino/omp-toolkit/main/install.sh | bash
```

The installer:

1. checks for Git and Bun 1.4.3 or newer,
2. clones or updates `~/.omp/omp-toolkit` (`OMP_TOOLKIT_HOME` overrides the
   checkout path),
3. runs `bun install --frozen-lockfile` and `bun run install:omp`.

`install:omp` backs up existing files under `~/.omp/agent/backups/`, then
installs `gemini-health.js` into `~/.omp/agent/extensions` and
`omp-provider-usage.js` into `~/.omp/agent/scripts`. No administrator rights
are required. Set `PI_CODING_AGENT_DIR` to install under a different OMP agent
directory.

Re-run the same command to update. The installers are plain
[PowerShell](install.ps1) and [Bash](install.sh); read them before piping them
into a shell.

### 🔧 Manual install

```bash
git clone https://github.com/kamishino/omp-toolkit.git
cd omp-toolkit
bun install --frozen-lockfile
bun run install:omp
```

Preview the file copies without changing anything:

```bash
bun scripts/install.ts --dry-run
```

### ✅ Verify

```bash
bun "$HOME/.omp/agent/scripts/omp-provider-usage.js" --health
```

Expected: the provider usage frame with `ROUTE`, `WEEKLY`, and `5 HOUR`
columns. In OMP, run `/gemini-health` to probe all accounts and refresh the
widget.

## 📊 Status and platform support

| Component | Status | Platforms |
|---|---|---|
| Provider usage monitor / TUI | Supported | Windows, macOS, Linux (any ANSI TTY) |
| DeepSeek balance and alerts | Supported | Windows, macOS, Linux |
| Reliability history and report | Supported | Windows, macOS, Linux |
| Orca Floating Workspace launcher | Best-effort (optional) | Supported on Windows; resolves `orca-ide` or `ORCA_BIN` elsewhere |
| Gemini route-health rotation | Experimental | Windows, macOS, Linux (OMP CLI) |

Windows 10/11 is the primary platform. CI runs the full check suite on
`windows-latest`, `macos-latest`, and `ubuntu-latest`.

## 📖 Usage

### 🖥️ Any terminal

From a checkout, `bun run monitor` starts the watch view in the current
terminal with health data and a 300 s interval:

```bash
bun run monitor
bun run monitor --interval=600
bun run monitor --no-health
bun run monitor --no-alt-screen
```

The installed CLI works without the checkout:

```bash
bun "$HOME/.omp/agent/scripts/omp-provider-usage.js"
bun "$HOME/.omp/agent/scripts/omp-provider-usage.js" --health
bun "$HOME/.omp/agent/scripts/omp-provider-usage.js" --json
bun "$HOME/.omp/agent/scripts/omp-provider-usage.js" --watch --interval=300 --health
```

`--watch` redraws in place every `--interval` seconds (default 300). Press
`Ctrl+C` to leave the alternate screen. `--json` prints the same sections for
scripting. The monitor falls back to append-only frames when stdout is not a
TTY, `TERM=dumb`, or `--no-alt-screen` is passed.

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

### 🧩 OMP extension commands

```text
/gemini-health [--confirm]
/gemini-heal [--dry-run]
/gemini-restore
/gemini-enable <email-or-local-part> [--force]
/gemini-health-widget [on|off]
```

### 🪟 Orca Floating Workspace (optional)

Orca is the preferred host on Windows but is not required.
```bash
bun run monitor:orca
```

Windows shortcut: `Ctrl+Alt+A`. macOS shortcut: `Cmd+Alt+A`. The launcher
resolves `ORCA_BIN`, then `ORCA_CLI_COMMAND`, then `ORCA_DEV_REPO_ROOT`
(`orca-dev`), then `orca-ide` on Linux, then `orca`. Orca integration outside
Windows is best-effort.

## ⚙️ Configuration

| Variable | Purpose |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek balance queries |
| `DEEPSEEK_BALANCE_ALERT_CNY` | Low-balance threshold in CNY, default 10 |
| `DEEPSEEK_BALANCE_ALERT_USD` | Low-balance threshold in USD, default 10 |
| `OMP_BIN` | OMP executable, default `omp` |
| `OMP_TOOLKIT_HOME` | Installer checkout path, default `~/.omp/omp-toolkit` |
| `PI_CODING_AGENT_DIR` | OMP agent directory override |
| `GEMINI_HEALTH_RESTORE_STREAK` | Healthy checks before auto-restore |
| `GEMINI_HEALTH_RESTORE_GAP_SECONDS` | Minimum spacing between checks |
| `PI_AI_ANTIGRAVITY_VERSION` | Antigravity client version header |
| `ORCA_BIN` | Orca CLI executable override |
| `ORCA_CLI_COMMAND` | Orca-managed CLI command override |

## 🧱 Project structure

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
scripts/                Build, install, monitor launchers, reliability report
```

## 🧑‍💻 Development

```bash
bun install
bun test
bun run typecheck
bun run format
bun run check
bun run build
```

`bun run check` runs Biome, `tsc --noEmit`, and the full unit suite.

## 📚 Documentation

- [Architecture](docs/architecture.md)
- [Design](docs/design.md)
- [Runbook](docs/runbook.md)
- [Roadmap](docs/roadmap.md)
- [ADRs](docs/adr/README.md)
- [Glossary](GLOSSARY.md)

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for scope, checks, and AI-artifact
rules. Before opening a pull request, run `bun run check`.

1. **Fork the repository.**
2. **Create a branch** (`git checkout -b feature/your-feature-name`).
3. **Make your changes** and commit them (`git commit -m 'feat: add ...'`).
4. **Push the branch** (`git push origin feature/your-feature-name`).
5. **Open a pull request.**

## 🐛 Issues

Search [existing issues](https://github.com/kamishino/omp-toolkit/issues)
first. When opening a new issue, include:

- A clear title and the exact command you ran.
- Operating system and `bun --version`.
- OMP version and installation method.
- Expected and actual output, with credentials, account emails, and provider
  payloads removed.

## 🔒 Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
Never post credentials, tokens, or full provider payloads in an issue.

## 📜 License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.
