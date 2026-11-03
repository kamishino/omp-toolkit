# ADR-0009: Conditional idle recovery sweep

## Status

Accepted. Supersedes the "Do not use periodic health probes" clause of ADR-0001.

## Context

ADR-0001 forbids periodic health probing so idle sessions spend zero model tokens.
That left managed exclusions unrestorable until the next event or manual check.
A bounded sweep can restore accounts while idle without probing healthy routes:
probes are only useful when an exclusion is waiting to be restored.

## Decision

- Run a recovery sweep at most every `GEMINI_HEALTH_RECOVERY_INTERVAL_SECONDS`
  (default 300, minimum 60) from `session_start`.
- The sweep probes only when the agent is idle and at least one restorable
  exclusion exists. With no exclusions it performs no network work.
- The sweep reuses the same probe, streak, lock, and restore path as manual
  checks; it never restores a manual exclusion that did not opt in.
- Event-driven detection and manual probes remain the only ways an exclusion is
  created.

## Consequences

Positive: excluded accounts recover without operator action; idle sessions with
no exclusions still spend zero model tokens.

Negative: an idle session with a pending exclusion spends probe tokens at most
once per interval; the sweep is timer-driven rather than purely event-driven.
