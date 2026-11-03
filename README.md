<div align="center">

<h2>OMP Toolkit</h2>

<p>See your OMP provider quotas, per-account route health, and DeepSeek balance in one terminal view or tray widget.</p>

[![check](https://github.com/kamishino/omp-toolkit/actions/workflows/check.yml/badge.svg)](https://github.com/kamishino/omp-toolkit/actions/workflows/check.yml)
![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)
![Platforms](https://img.shields.io/badge/platform-windows%20%7C%20macos%20%7C%20linux-4B5563?style=for-the-badge)

</div>

> [!IMPORTANT]
> **Unofficial.** Not affiliated with OMP, Orca, or Google. Automatic Gemini account rotation is experimental, and provider terms may restrict it. Use it at your own risk.

## Why use it

OMP pins a session to one account. If that account's route hangs, the session stalls even when other accounts are healthy. OMP Toolkit shows what every provider is using and moves a hung Antigravity account out of the way.

- One frame for Google Antigravity, OpenAI Codex, Muse Code, and DeepSeek quotas.
- Per-account route health: `OK`, `HANG`, `ERR`, `AUTH`, or `MODEL`.
- A hung account is temporarily excluded and restored after three healthy checks at least 60 s apart.
- DeepSeek balance with a configurable `LOW` alert, plus 30 days of local route history (`bun run reliability:report`).
- Terminal, tray widget, or Orca tab. Monitoring reads quota data and cached health only; it never sends a model request.

Example output (sample data):

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

Sample data. `bun run monitor` keeps this view live and refreshes every 300 s.

## Quick start

You need **Bun 1.4.3+**, **Git**, and **OMP 18.12.5**. Orca is optional.

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/kamishino/omp-toolkit/main/install.ps1 | iex
```

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/kamishino/omp-toolkit/main/install.sh | bash
```

The installer clones or updates `~/.omp/omp-toolkit`, runs `bun install --frozen-lockfile`, and installs the OMP extension, monitor CLI, and helper scripts into `~/.omp/agent`. Set `OMP_TOOLKIT_HOME` to use a different checkout.

Check the install:

```bash
bun "$HOME/.omp/agent/scripts/omp-provider-usage.js" --health
cd "$HOME/.omp/omp-toolkit"
bun run desktop:once
```

The first command prints the usage frame with a `ROUTE` column. The second prints a short text summary and exits; `bun run desktop` starts the tray widget. For a manual checkout, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Everyday commands

Run `monitor` and `desktop` commands from the checkout (`~/.omp/omp-toolkit` after the installer).

| Task | Command |
| --- | --- |
| Live quota view | `bun run monitor` |
| Slower refresh | `bun run monitor --interval=600` |
| Pricing schedule | `bun run monitor --schedule` |
| Tray widget | `bun run desktop` |
| Headless check | `bun run desktop:once` |
| Desktop shortcut | `bun run desktop:shortcut` |
| Orca floating tab | `bun run monitor:orca` (`Ctrl+Alt+A` / `Cmd+Alt+A`) |

`--no-health` hides the route column; `--no-alt-screen` keeps output in the scrollback; in watch mode `Tab` switches between usage and schedule.

Inside OMP:

| Task | Command |
| --- | --- |
| Check every account now | `/gemini-health` |
| Preview exclusions | `/gemini-heal --dry-run` |
| Undo toolkit exclusions | `/gemini-restore` |
| Warm one account (60 s cooldown) | `/gemini-warmup <account>` |
| Re-check one account | `/gemini-check <account>` |
| Full command list | [OMP Extension Guide](apps/omp-extension/README.md) |

## Configuration

| Variable | What it does | Default |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | Enables DeepSeek balance lookup | — |
| `DEEPSEEK_BALANCE_ALERT_CNY` | Low-balance threshold, CNY | `10` |
| `DEEPSEEK_BALANCE_ALERT_USD` | Low-balance threshold, USD | `10` |
| `OMP_BIN` | OMP executable name or path | `omp` |
| `OMP_TOOLKIT_HOME` | Checkout used by installers and templates | `~/.omp/omp-toolkit` |
| `PI_CODING_AGENT_DIR` | OMP state directory | `~/.omp/agent` |
| `OMP_TOOLKIT_HISTORY_DB` | Override the SQLite history file | `<agentDir>/omp-toolkit-history.db` |
| `OMP_WIDGET_INTERVAL_SECONDS` | Tray refresh interval (minimum 30) | `300` |
| `BUN_BIN` | Bun executable for desktop subprocesses | system `bun` |
| `GEMINI_HEALTH_RESTORE_STREAK` | Healthy checks needed to restore an account | `3` |
| `GEMINI_HEALTH_RESTORE_GAP_SECONDS` | Minimum seconds between streak checks | `60` |
| `GEMINI_HEALTH_RECOVERY_INTERVAL_SECONDS` | Recovery sweep interval (minimum 60) | `300` |
| `PI_AI_ANTIGRAVITY_VERSION` | Antigravity client version header | `2.24.0` |
| `ORCA_BIN` | Orca executable override | auto-detected |
| `ORCA_CLI_COMMAND` | Orca-managed CLI command override | auto-detected |
| `NO_COLOR` | Set to `1` to disable ANSI color | unset |

## FAQ

**What does `HANG` mean?** The account accepted the probe but sent no first stream event within 15 s, or failed with a retryable error.

**Why is an account excluded?** The toolkit set `reservePct: 100` so OMP stops routing to it. `/gemini-restore` removes toolkit-managed exclusions; `/gemini-enable <account>` re-enables one account. Manual exclusions stay until you run `/gemini-auto-restore <account>` to opt in.

**The footer says the snapshot is stale.** The last check is older than 15 minutes. Run `/gemini-health` or `bun ~/.omp/agent/extensions/gemini-health.js`.

**Does monitoring cost model tokens?** No. Health probes cost roughly 11 tokens per account and a warm-up about 8.

**Does it send data anywhere?** No telemetry and no upload path. It reads local OMP state and calls `https://api.deepseek.com/user/balance` only when `DEEPSEEK_API_KEY` is set.

**How do I uninstall?** Run `/gemini-restore` first so no account stays excluded, then delete `~/.omp/agent/extensions/gemini-health.js`, `~/.omp/agent/scripts/omp-provider-usage.js`, `~/.omp/agent/scripts/windows-toast.ps1`, and `~/.omp/agent/scripts/omp-gateway.ps1` if present. Delete the checkout; optionally delete `~/.omp/agent/gemini-health-*.json`, `gemini-warmup-state.json`, `omp-toolkit-history.db*`, and `omp-toolkit-machine.json`.

## Platform support

| Component | Status | Platforms |
| --- | --- | --- |
| Terminal monitor | Supported | Windows, macOS, Linux |
| Desktop tray widget | Supported | Windows 10/11, macOS; Linux best-effort |
| DeepSeek balance and alerts | Supported | Windows, macOS, Linux |
| Reliability history and reports | Supported | Windows, macOS, Linux |
| Orca workspace launcher | Optional | Windows; macOS/Linux best-effort |
| Gemini route health | Experimental | Windows, macOS, Linux |

Tested with Bun 1.4.3, OMP 18.12.5, and Orca 1.4.226. The primary target is Windows 10/11.

## For developers

`packages/core` is pure domain logic (no network, OMP, or arbitrary I/O; deterministic path resolution only). `packages/tui` renders the terminal frame. `apps/*` own OMP, CLI, Electron, and process boundaries. See [Architecture](docs/architecture.md) for the layer table and data flow.

```bash
bun install             # dependencies
bun test                # unit tests
bun run typecheck       # TypeScript workspace and desktop
bun run check           # Biome, typecheck, tests, token contrast
bun run build           # extension, CLI, and desktop bundles
```

## Documentation

- [OMP Extension Guide](apps/omp-extension/README.md)
- [Architecture](docs/architecture.md)
- [Design tokens](docs/design.md)
- [Runbook](docs/runbook.md)
- [Roadmap](docs/roadmap.md)
- [ADRs](docs/adr/README.md)
- [Glossary](GLOSSARY.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License

MIT — see [LICENSE](LICENSE). Not affiliated with OMP, Orca, or Google.
