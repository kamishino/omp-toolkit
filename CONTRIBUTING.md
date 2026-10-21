# Contributing

## Project scope
This is an unofficial, Windows-first toolkit for OMP + Orca. Contributions that
improve the provider usage monitor, DeepSeek balance, reliability history,
documentation, and Windows/Orca integration are welcome. Cross-platform support
is best-effort and unsupported.

The Gemini route-health rotation is experimental. Changes to account exclusion,
OMP config mutation, or recovery behavior require a focused issue first.

## Setup
Prerequisites: Windows 10/11, Bun 1.4.3, Git, and OMP 18.12.5. Orca 1.4.226 is
optional and only needed for the Floating Workspace launcher.

```powershell
git clone https://github.com/kamishino/omp-toolkit.git
cd omp-toolkit
bun install
bun run check
```

## Checks
Run before every pull request:

```powershell
bun run check
bun run build
```

`bun run check` runs Biome, `tsc --noEmit`, and the full unit suite. Tests must
not require network access, real OMP credentials, or a running Orca instance.

## Pull requests
- Keep each PR to one concern.
- Add or update tests for behavior changes in `packages/core` or
  `packages/tui`.
- Update `README.md`, `docs/RUNBOOK.md`, or `docs/ARCHITECTURE.md` when the
  user-visible behavior changes.
- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- Do not commit `HANDOFF.md`, `.env`, credentials, OMP state files, terminal
  handles, personal paths, or generated `dist/` output.
- Do not add a new provider adapter without an issue that defines its fixture
  and failure behavior.

## AI assistant artifacts
Do not commit `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.cursor/`, `.claude/`,
`.codex/`, `.agents/`, `.omp/`, `copilot-instructions.md`, session handoffs,
agent transcripts, local skill files, or prompt files. They are gitignored and
must remain local. The `~/.omp/agent` paths in source and docs are the OMP
runtime directory required by the product; they are not a request to publish
local agent state.

## Security
Do not open a public issue with credentials, tokens, or full provider payloads.
See `SECURITY.md`.
