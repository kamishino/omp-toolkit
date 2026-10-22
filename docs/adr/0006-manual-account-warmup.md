# ADR-0006: Manual account warm-up and unhang check

- Status: Accepted
- Date: 2026-10-22

## Context

The toolkit detects Gemini 3.8 route hangs via event hooks (`auto_retry_start`,
`agent_end`) and runs full multi-account health probes (`/gemini-health`).
However, operators need a deliberate, low-cost way to test or pre-warm specific
accounts before heavy use, and to verify whether a previously hung or failed
account has recovered without waiting for another stall or probing all accounts.

Probing hung accounts blindly during bulk operations risks wasting quota or
prolonging session stalls. Furthermore, running model requests in the background
without operator consent would violate ADR-0001's zero-idle-token policy.

## Decision

- Warm-up is strictly manual: no periodic background probing or autonomous loops
  are introduced.
- Provider scope: Google Antigravity is implemented first via `WarmUpAdapter`.
  Other providers (OpenAI Codex, Muse Code, DeepSeek) lack per-account route
  probes and return unsupported. The adapter seam allows future providers to be
  added without altering domain logic or UI layout.
- Safety & routing boundary: Warm-up does not mutate OMP account pins,
  `auth.accountPolicies`, or `reservePct`. It only tests and records route
  health.
- HANG safety: Provider-wide warm-up skips known non-OK accounts (`hang`,
  `error`, `auth`, `model-error`). Individual non-OK rows expose an unhang Check
  action instead.
- Execution: Sequential, one account at a time, with a 1-second pause between
  targets. Failures continue without automatic retries.
- Concurrency & cooldown: A cross-process lock (`gemini-warmup.lock`) serializes
  warm-up and check runs. A 60-second per-account cooldown prevents accidental
  rapid re-probing. Check actions bypass the cooldown but acquire the lock.
- State: Per-account `checkedAt` timestamps are preserved in snapshot results;
  the overall snapshot `checkedAt` tracks the newest operation. Healthy streaks
  are updated, but managed exclusions do not restore immediately; the 3-check
  streak policy remains the sole restore path.
- Client architecture: The desktop panel triggers actions by spawning the
  installed extension CLI with `--json`. The renderer has no direct network or
  credential access.

## Consequences

- Operators can safely warm eligible routes and verify recovered accounts on
  demand.
- Zero model tokens are spent while idle.
- Hung accounts cannot be spammed during bulk operations.
- The desktop panel and OMP slash commands share identical execution semantics
  and state.
