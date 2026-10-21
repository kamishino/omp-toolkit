# ADR-0001: Event-driven Gemini route health

## Status

Accepted.

## Context

OMP pins a session to one OAuth account. A Gemini 3.8 route can accept a
request and never emit a first SSE event. OMP's stream watchdog then aborts the
request, but a timeout is not a usage-limit or auth failure, so the session pin
does not move and model fallback chains are not consulted. The user wants to
keep `gemini-3.8-flash`, not fall back to a less capable model.

Periodic health probing works, but it spends a small amount of model quota while
idle and adds unnecessary API traffic.

## Decision

- Detect stalls through OMP's `auto_retry_start` (attempt 1) and `agent_end`
  (error) hooks.
- On a qualifying event, probe every Antigravity account, confirm failures, and
  write a temporary `reservePct: 100` policy for a minority of hung accounts.
- Write the result to `gemini-health-latest.json`. UI monitors read this
  snapshot; they never probe.
- Keep a healthy-check streak per account. Managed exclusions auto-restore after
  three checks spaced at least 60 s apart.
- Do not auto-remove manual exclusions. `/gemini-enable` is the explicit,
  snapshot-guarded path.
- Do not use periodic health probes. Freshness is explicit: manual
  `/gemini-health`, the health CLI, or an OMP retry/error event.

## Consequences

Positive:

- Idle monitoring spends zero model tokens.
- Hang detection reacts to the actual failure that affects the session.
- The account circuit breaker preserves `gemini-3.8-flash`.
- The snapshot-driven UI is decoupled from probing.

Negative:

- Recovery is not noticed while everything is idle. A manual check or the next
  event advances the streak.
- The cached route can be stale; the UI marks snapshots older than 15 minutes.
- Two writers (OMP extension and health CLI) can race on state/config. Atomic
  writes prevent corruption, but strict cross-process serialization is not
  implemented.
