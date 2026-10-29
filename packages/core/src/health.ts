import type {
  HealthResult,
  HealthState,
  Policy,
  ProbeResult,
  Status,
  StreakEntry,
  StreakState,
} from "./types";

export function isFailure(status: Status): boolean {
  return status === "hang" || status === "error";
}

export function nextStreaks(
  streaks: StreakState,
  results: ProbeResult[],
  now: number,
  gapMs: number,
): StreakState {
  const next: StreakState = {};
  for (const [email, entry] of Object.entries(streaks)) {
    next[email] = { ...entry };
  }

  for (const result of results) {
    const previous: StreakEntry = next[result.email] ?? { ok: 0, lastAt: 0 };
    if (result.status === "ok") {
      if (now - previous.lastAt >= gapMs) {
        next[result.email] = { ok: previous.ok + 1, lastAt: now };
      } else {
        next[result.email] = previous;
      }
    } else {
      next[result.email] = { ok: 0, lastAt: 0 };
    }
  }
  return next;
}

export function restorableEmails(
  state: HealthState,
  streaks: StreakState,
  threshold: number,
  optedIn: ReadonlySet<string> = new Set(),
  manuallyExcluded: ReadonlySet<string> = new Set(),
): string[] {
  const excludedLower = new Set(state.excluded.map((e) => e.toLowerCase()));
  const optedInLower = new Set([...optedIn].map((e) => e.toLowerCase()));
  const streaksByLower = new Map(
    Object.entries(streaks).map(([email, entry]) => [email.toLowerCase(), entry]),
  );

  return [...new Set([...state.excluded, ...manuallyExcluded])].filter((email) => {
    const lower = email.toLowerCase();
    if (!excludedLower.has(lower) && !optedInLower.has(lower)) return false;
    const streak = streaks[email] ?? streaksByLower.get(lower);
    return (streak?.ok ?? 0) >= threshold;
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

export function mergeHealthResults(
  previous: readonly HealthResult[],
  results: readonly ProbeResult[],
  checkedAt: number,
): HealthResult[] {
  const byEmail = new Map(previous.map((result) => [result.email, result]));
  for (const result of results) {
    byEmail.set(result.email, { ...result, checkedAt });
  }
  return [...byEmail.values()];
}
