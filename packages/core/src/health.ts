import tokens from "../../../design/tokens.json";
import type {
  HealthResult,
  HealthSnapshot,
  HealthState,
  Policy,
  ProbeResult,
  RouteIdentity,
  StreakState,
} from "./types";

export const DEFAULT_MODEL_WIRE = "gemini-3.8-flash-high";
export const DEFAULT_RESTORE_STREAK = tokens.health.restoreStreak.$value;
export const DEFAULT_RESTORE_GAP_SECONDS = tokens.health.restoreGapSeconds.$value;
export const DEFAULT_RESTORE_GAP_MS = DEFAULT_RESTORE_GAP_SECONDS * 1000;
export const DEFAULT_STALE_MINUTES = tokens.health.staleSnapshotMinutes.$value;
export const ROUTE_STALE_MS = DEFAULT_STALE_MINUTES * 60_000;

export function routeKey(route: RouteIdentity): string {
  return JSON.stringify([
    route.provider,
    route.email.trim().toLowerCase(),
    route.project,
    route.model,
  ]);
}

export function routeFreshness(
  result: HealthResult | undefined,
  now: number,
  staleMs: number = ROUTE_STALE_MS,
): "fresh" | "stale" | "unknown" {
  if (
    !result ||
    typeof result.checkedAt !== "number" ||
    !Number.isFinite(result.checkedAt) ||
    result.checkedAt <= 0 ||
    result.checkedAt > now
  ) {
    return "unknown";
  }
  if (now - result.checkedAt > staleMs) {
    return "stale";
  }
  return "fresh";
}

export function isRetryableRouteFailure(result: HealthResult): boolean {
  return (
    (result.status === "hang" && result.failureKind === "timeout") ||
    (result.status === "error" && result.failureKind === "transient")
  );
}

export function mergeHealthResults(
  previous: readonly HealthResult[],
  results: readonly ProbeResult[],
): HealthResult[] {
  const byKey = new Map<string, HealthResult>();
  for (const prev of previous) {
    byKey.set(routeKey(prev), prev);
  }

  for (const next of results) {
    const key = routeKey(next);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, next);
      continue;
    }
    // Accept only evidence newer by (startedAt, checkedAt) lexicographically
    if (
      next.startedAt > existing.startedAt ||
      (next.startedAt === existing.startedAt && next.checkedAt > existing.checkedAt)
    ) {
      byKey.set(key, next);
    }
  }

  return [...byKey.values()];
}

export function nextStreaks(
  streaks: StreakState,
  results: readonly ProbeResult[],
  now: number,
  gapMs: number = DEFAULT_RESTORE_GAP_MS,
  staleMs: number = ROUTE_STALE_MS,
): StreakState {
  const next: StreakState = { ...streaks };

  for (const result of results) {
    const key = routeKey(result);
    const prev = next[key];

    // Duplicate or older observation cannot increment or reset a streak
    if (prev && prev.lastAt > 0 && result.checkedAt <= prev.lastAt) {
      continue;
    }

    if (result.status === "ok") {
      if (!prev || prev.ok === 0) {
        next[key] = { ok: 1, firstAt: result.checkedAt, lastAt: result.checkedAt };
      } else {
        // Restart at one if first counted observation is older than freshness window, or previous is stale
        if (now - prev.firstAt > staleMs || now - prev.lastAt > staleMs) {
          next[key] = { ok: 1, firstAt: result.checkedAt, lastAt: result.checkedAt };
        } else if (result.checkedAt - prev.lastAt >= gapMs) {
          next[key] = { ok: prev.ok + 1, firstAt: prev.firstAt, lastAt: result.checkedAt };
        } else {
          // Within gapMs: don't increment, retain previous
          next[key] = prev;
        }
      }
    } else {
      next[key] = { ok: 0, firstAt: 0, lastAt: 0 };
    }
  }

  return next;
}

export function restorableEmails(
  state: HealthState,
  streaks: StreakState,
  threshold: number,
  snapshot: HealthSnapshot,
  model: string,
  now: number,
  optedIn: ReadonlySet<string> = new Set(),
  manuallyExcluded: ReadonlySet<string> = new Set(),
): string[] {
  const excludedLower = new Set(state.excluded.map((e) => e.toLowerCase()));
  const optedInLower = new Set([...optedIn].map((e) => e.toLowerCase()));

  const candidateEmails = [...new Set([...state.excluded, ...manuallyExcluded])];

  return candidateEmails.filter((email) => {
    const lower = email.toLowerCase();
    if (!excludedLower.has(lower) && !optedInLower.has(lower)) {
      return false;
    }

    // Filter snapshot results for this account on the target provider and model
    const matching = snapshot.results.filter(
      (r) =>
        r.provider === "google-antigravity" &&
        r.email.trim().toLowerCase() === lower &&
        r.model === model,
    );

    // Reject missing evidence or ambiguity across project identities
    if (matching.length !== 1) {
      return false;
    }

    const observation = matching[0];
    if (observation.status !== "ok" || routeFreshness(observation, now) !== "fresh") {
      return false;
    }

    const key = routeKey(observation);
    const streak = streaks[key];
    if (!streak || streak.ok < threshold) {
      return false;
    }

    // At restore evaluation time, also require that stored completed streak has not expired
    if (now - streak.firstAt > ROUTE_STALE_MS || now - streak.lastAt > ROUTE_STALE_MS) {
      return false;
    }

    return true;
  });
}

export function excludedEmails(policies: Policy[]): Set<string> {
  const emails = new Set<string>();
  for (const policy of policies) {
    if (policy.provider !== "google-antigravity") continue;
    const email = policy.account?.email;
    if (typeof email === "string" && (policy.reservePct ?? 0) >= 100) {
      emails.add(email);
    }
  }
  return emails;
}
