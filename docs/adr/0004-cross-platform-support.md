# ADR-0004: Cross-platform installation and support boundary

- Status: Accepted
- Date: 2026-10-21
- Supersedes: the platform paragraph of ADR-0003

## Context

v0.1.0 documented Windows 10/11 as the only supported platform. The installer,
build, tests, provider-usage CLI, DeepSeek balance, and reliability report use
Bun and Node path APIs; they can run on macOS and Linux. Orca integration
remains platform-specific: the Orca CLI name, terminal shell, and Floating
Workspace shortcut differ by platform.

## Decision

- Installation, build, tests, provider-usage CLI, DeepSeek balance, and
  reliability history/report are supported on Windows 10/11, macOS, and Linux.
- CI runs the full check suite on `windows-latest`, `macos-latest`, and
  `ubuntu-latest`.
- Orca Floating Workspace integration is supported on Windows and best-effort
  on macOS/Linux. The launcher resolves the executable in this order:
  `ORCA_BIN`, `ORCA_CLI_COMMAND`, `ORCA_DEV_REPO_ROOT` (`orca-dev`),
  `orca-ide` on Linux, then `orca`.
- The launcher uses PowerShell command syntax on Windows and POSIX quoting
  elsewhere. The displayed shortcut is `Ctrl+Alt+A` on Windows/Linux and
  `Cmd+Alt+A` on macOS.
- Gemini route-health rotation remains experimental on every platform.

## Consequences

- The README and runbook must show PowerShell and Bash paths.
- CI time increases from one to three jobs.
- Orca-specific issues on macOS/Linux are best-effort and may be closed as
  unsupported.
- The Windows-first reliability roadmap remains a Windows proof; it does not
  claim macOS/Linux Orca parity.
