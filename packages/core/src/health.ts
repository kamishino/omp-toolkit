import type { HealthState, Policy, ProbeResult, Status, StreakEntry, StreakState } from "./types";

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
): string[] {
  return state.excluded.filter((email) => (streaks[email]?.ok ?? 0) >= threshold);
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
