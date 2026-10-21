# Runbook

## Platform notes

Windows examples use PowerShell. macOS/Linux use the same `bun` commands in
Bash. `bun run install:omp` and `bun run reliability:report` work on all
supported platforms. Orca integration is best-effort outside Windows.

## Normal checks

```bash
# Provider usage + cached route health (fast, no model tokens)
bun ~/.omp/agent/scripts/omp-provider-usage.js --health

# Refresh the health snapshot (probes six accounts; ~66 tokens)
bun ~/.omp/agent/extensions/gemini-health.js

# Inside an OMP TUI
/gemini-health

# Reliability audit & doctor checks (see roadmap.md; run on each machine)
bun run reliability:report --days=7
bun run reliability:report --days=30
bun run doctor
```
Interpretation:

| Route | Meaning | Action |
|---|---|---|
| `OK` | First SSE event within 15 s | None |
| `HANG` | No first event within 15 s | Account is circuit-broken |
| `ERR` | HTTP 5xx | Account is circuit-broken |
| `AUTH` | 401/403; token cache cleared | Re-login the account |
| `MODEL` | 404 / wire model mismatch | Update the probe model id |

`health ... (stale)` means the snapshot is older than 15 minutes. Run
`/gemini-health` or the health CLI.

## Balance alerts

A DeepSeek `Balance` at or below `DEEPSEEK_BALANCE_ALERT_CNY` (default 10) or
`DEEPSEEK_BALANCE_ALERT_USD` (default 10) renders red with `LOW`. The
`Granted` column never alerts. Use the environment variable for the displayed
currency; the preferred currency is still CNY when both are returned.
## Healing

```text
/gemini-heal --dry-run    # show which accounts would be excluded
/gemini-heal              # exclude hung accounts, reload settings
/gemini-restore           # remove exclusions managed by the extension
/gemini-enable <email>    # explicit re-enable (refused if latest route is not OK)
/gemini-enable <email> --force
```

- Heal does nothing when every account fails; that is a provider-wide incident.
- Healing preserves `gemini-3.8-flash`; there is no model fallback.
- Auto-restore applies only to extension-managed exclusions after three spaced
  healthy checks. Manual policies are never auto-removed.
- `/gemini-enable` refuses a non-OK snapshot. `--force` is the explicit override.
- After a policy change, reload the session (`/gemini-heal` does this) or start
  `/new` so a warm pin moves.

## Auto-restore

Defaults:

```text
GEMINI_HEALTH_RESTORE_STREAK=3
GEMINI_HEALTH_RESTORE_GAP_SECONDS=60
```

A managed exclusion restores after three healthy checks that are at least 60 s
apart. Checks occur only on an event/manual probe; there is no idle polling.

## Orca widget

One-command launcher (Floating Workspace):

```bash
bun run monitor:orca
```

Press `Ctrl+Alt+A` on Windows/Linux (or `Cmd+Alt+A` on macOS) to show the
Floating Workspace panel. Note that `--focus` focuses the tab inside the
floating layout but does not unhide or open the panel overlay if it is
currently closed.

The launcher resolves `ORCA_BIN`, then `ORCA_CLI_COMMAND`, then
`ORCA_DEV_REPO_ROOT` (`orca-dev`), then `orca-ide` on Linux, then `orca`.
Windows/Linux use `Ctrl+Alt+A`; macOS uses `Cmd+Alt+A`.

To restart or re-anchor the monitor:

```bash
bun run monitor:orca --restart
```

Manual fallback in another worktree:

```bash
orca terminal create \
  --worktree <selector> \
  --title "OMP Provider Usage" \
  --command "bun \"\$HOME/.omp/agent/scripts/omp-provider-usage.js\" --watch --interval=300 --health" \
  --json
```

Recommended interval: **300 s**. `omp usage` is a quota read; the monitor spends
zero model tokens. Use `600 s` to halve API traffic.

Close it:

```bash
orca terminal close --terminal <terminal-handle> --json
```

## Hide Orca's native usage

Preferred: Settings (`Ctrl+,`) -> Appearance -> Status bar toggles. Turn off
the provider items (Gemini, Antigravity, and any others you do not want).

File fallback: quit Orca first, back up:

```text
Windows: %APPDATA%\orca\profiles\local-default\orca-data.json
macOS:   ~/Library/Application Support/orca/profiles/local-default/orca-data.json
Linux:   ~/.config/orca/profiles/local-default/orca-data.json
```

then set:

```json
"statusBarItems": ["ssh", "resource-usage", "ports"]
```

Relaunch. Do not edit while Orca is running; it may overwrite settings on exit.
The custom **OMP Provider Usage** tab is unaffected.

## Token cost

| Action | Tokens |
|---|---:|
| `omp-provider-usage.js --watch` | 0 |
| `omp usage --json` | 0 (quota read) |
| Snapshot read | 0 |
| Health sweep | ~66 per six accounts |
| Failed/hung probe | ~6 prompt tokens or none |

## Troubleshooting

**Snapshot missing or stale**

```bash
bun ~/.omp/agent/extensions/gemini-health.js
```

**OMP extension not loaded**

```bash
ls ~/.omp/agent/extensions/gemini-health.js
omp -p --no-session --model deepseek/deepseek-flash \
  "Call gemini_health with confirm=false and print its output."
```

Check `~/.omp/logs/omp.<date>.<pid>.log` for extension-load errors.

**Usage call fails**

The watch loop prints `OMP Provider Usage: ...` once and keeps running. Check:

```bash
omp usage --json
```

**Policy write fails**

The extension reports `Gemini heal failed: ...`. Do not edit state files by
hand; inspect:

```bash
omp config get auth.accountPolicies
cat ~/.omp/agent/gemini-health-state.json
```

**Update the installed toolkit**

```bash
cd omp-toolkit
bun test && bun run typecheck
bun run install:omp
```

The installer backs up existing OMP artifacts first.
