# ADR-0010: Gateway control plane over OMP

## Status

Accepted.

## Context

Other agent harnesses should use all enrolled Google Antigravity accounts
without manual switching when one account returns `429` or exhausts quota.
OMP source and a live spike (`omp/18.16.0`, 7 Antigravity accounts) show that
OMP already implements the needed data plane: `omp auth-broker serve` owns
the credential vault and refresh, and `omp auth-gateway serve` proxies OpenAI
and Anthropic wire formats over a session-sticky, quota-aware ranked pool
with scoped credential blocks. It is not literal per-request round-robin.
This repo currently contains no proxy, only a PowerShell wrapper around
those external commands, with no version or capability checks. Evidence is
recorded against OMP commit `f3410da` in the internal research note
`docs/research/omp-multi-account-gateway.md` (gitignored by design).

## Decision

- Build a toolkit **control plane** only (spec:
  `docs/gateway-control-plane.md`): daemon lifecycle, fail-closed
  compatibility checks, account/client visibility, and policy writes
  (clients, `auth.accountPolicies`, broker credential blocks).
- Do not build an inference proxy, wire translators, upstream provider
  clients, or a second credential vault. OMP `agent.db` remains the sole
  credential source; raw refresh tokens are never copied or printed.
- Ship it as a standalone Bun app in this monorepo, independent of any OMP
  session, talking to OMP through its broker/gateway APIs and CLI seams
  behind an adapter. Minimum verified OMP version: `18.16.0`; startup
  refuses incompatible installations.
- v1 scope: loopback only, `google-antigravity` only, one gateway client
  token per harness or machine as the affinity unit, OpenAI Chat Completions
  and Anthropic Messages, OMP model ids unchanged, management via CLI,
  TerminUI, and the desktop widget. Account login stays in OMP.
- Accept the observed limits honestly: the gateway exposes no per-request
  account attribution and no per-client pin identity (pin distribution in
  the local sticky cache is readable), streaming header-commit timing is
  inconsistent across observations, and it serves through a locally blocked
  account when no sibling is available. The control plane labels unknown
  state instead of inferring it and queues nothing.

## Consequences

Positive: near-zero duplication of OMP's ranking, cooldown, refresh, and
translation machinery; one refresher, so no token invalidation races; the
existing Cloudflare multi-machine flow remains available as a later phase
(remote clients consume inference only, so roadmap `C23` still holds, as do
`C18` and `C24`).

Negative: the toolkit depends on upstream-owned, externally versioned
broker/gateway wire behavior and on Google's internal Antigravity surface.
Compatibility is enforced by probing and failing closed rather than by
controlling the implementation. If the spike-#2 findings (spec S1) show the
data plane cannot meet streaming or exhaust requirements, this ADR must be
revisited before more than the read-only slice is built.
