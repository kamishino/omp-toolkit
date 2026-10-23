# ADR-0007: Multi-provider time-window scheduling and context-aware monitoring

- Status: Accepted
- Date: 2026-10-23

## Context

Upstream model providers (starting with DeepSeek) implement time-of-day API
pricing where token costs vary by 50% between off-peak and peak windows.
Operators and automated agents risk spending 2× standard costs when executing
token-heavy workloads (such as evals or batch sweeps) during peak hours.
Additionally, providers publish schedules anchored to their authoritative
reference timezones (such as UTC or China Standard Time), whereas operators run
workstations in heterogeneous local timezones.

Hardcoding provider hours in CLI presentation scripts would violate the
monorepo architectural seam (`packages/core` owning all business logic with zero
I/O), prevent multi-provider extensibility, and duplicate timezone logic across
CLI and UI hosts.

## Decision

- Implement an extensible `TimeWindowPolicy` registry in `packages/core` that
  evaluates provider time windows as a pure function of timestamp, policy, and
  target timezone.
- Prioritize DeepSeek as the initial policy: Monday–Friday 01:00–04:00 UTC and
  06:00–10:00 UTC are Peak (1.0× multiplier), while all other hours including
  100% of weekends are Off-Peak (0.5× multiplier, 50% discount).
- Timezone normalization MUST use standard ECMAScript `Intl` APIs with IANA
  timezone identifiers (zero new third-party dependencies).
- Context-awareness MUST operate as non-blocking visibility: render real-time
  advisory badges (`[OFF-PEAK: 50% OFF]` / `[PEAK: 2× Rate]`) and countdown
  timers in the dashboard header, alongside an inspection `--schedule` command,
  without halting or rejecting interactive model invocations.
- Dashboard integration MUST bind to `design/tokens.json` (`color.ok` for
  off-peak discount, `color.warn` for peak rate).

## Consequences

- Time window calculations remain completely deterministic, fast, and isolated
  within `packages/core` without system clock dependencies or mocking.
- Operators can instantly inspect local equivalent schedules via
  `omp usage --schedule`.
- Future providers introducing time-varying rates can register policies without
  modifying dashboard or presentation rendering code.
