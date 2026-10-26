# ADR-0003: Public release scope and support boundary

> Platform boundary updated by ADR-0004.
- Status: Accepted; platform boundary superseded by ADR-0004
- Date: 2026-10-21

## Context

The toolkit began as a personal Windows/Orca/OMP setup. Publishing it creates a
choice between a narrow, trustworthy release and a broad platform promise.
It also exposes personal data unless the public repository starts from a clean
history.

The health rotation mutates OMP account policies and may interact with provider
terms. The monitor, DeepSeek balance, and history report do not mutate routing
state and are easier to support.

## Decision

Publish the full toolkit from a fresh public history:

- The provider usage monitor, TUI, DeepSeek balance, reliability history/report,
  and Orca launcher are supported.
- Gemini route-health rotation is experimental and carries an explicit
  unofficial/ToS caution. It makes no quota-bypass claims.
- The supported platform is Windows 10/11 with Bun 1.4.3 and OMP 18.12.5.
  macOS and Linux are unsupported and best-effort.
- The license is MIT.
- Contributions are maintainer-led: issues and focused PRs are welcome; the
  maintainer sets direction and merges.
- Releases are source-only GitHub tags. The project does not publish npm
  packages or signed binaries.
- The public repository is `kamishino/omp-toolkit`, created from a sanitized
  snapshot with no personal emails, terminal handles, local paths, agent
  instructions, session handoffs, transcripts, or AI tool configuration in its
  history. The `~/.omp/agent` paths in source and docs are the OMP runtime
  directory required by the product, not local agent state.

## Consequences

- The README must state the unofficial status, experimental health feature, and
  Windows support matrix.
- Security reports use private GitHub advisories; public issues must not contain
  credentials or provider payloads.
- Contributors cannot expect cross-platform support or npm semver guarantees.
- AI assistant artifacts stay local and gitignored; public PRs must not add
  `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, transcripts, or local skill files.
- If a credible provider-policy objection arises, the health rotation can be
  moved to a separate experimental repository without changing the monitor's
  public contract.
