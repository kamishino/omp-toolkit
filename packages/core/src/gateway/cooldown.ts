import type { AccountView } from "./account-views";
import { MAX_BLOCK_SECONDS, MIN_BLOCK_SECONDS } from "./blocks";

export interface CooldownBlockDecision {
  id: number;
  durationSeconds: number;
  reason: string;
}

export interface CooldownEvaluation {
  toBlock: CooldownBlockDecision[];
  skippedLastSurviving: number | null;
  activeAccountsCount: number;
}

/**
 * Evaluates which accounts should be placed into temporary cooldown blocks
 * when quota is depleted, while strictly enforcing the Surviving Account Invariant:
 * the control plane will never block the last remaining unblocked account.
 */
export function evaluateQuotaCooldowns(
  accounts: readonly AccountView[],
  nowMs: number,
): CooldownEvaluation {
  // Only evaluate active, non-drained accounts
  const candidates = accounts.filter((a) => !a.policy?.drained);
  const currentlyUnblocked = candidates.filter((a) => !a.blocked);

  const toBlock: CooldownBlockDecision[] = [];
  let skippedLastSurviving: number | null = null;
  let survivingCount = currentlyUnblocked.length;

  for (const account of currentlyUnblocked) {
    const depletedLimits = account.limits.filter(
      (limit) =>
        limit.remainingFraction === 0 ||
        (typeof limit.remainingFraction === "number" && limit.remainingFraction <= 0.01),
    );

    if (depletedLimits.length > 0) {
      if (survivingCount <= 1) {
        skippedLastSurviving = account.id;
        continue;
      }

      // Calculate dynamic duration until reset
      const resetTimes = depletedLimits
        .map((l) => l.resetsAtMs)
        .filter((t): t is number => typeof t === "number" && t > nowMs);

      const resetTarget =
        resetTimes.length > 0
          ? Math.min(...resetTimes)
          : (account.earliestResetMs ?? nowMs + 900_000);

      const diffSeconds = Math.floor((resetTarget - nowMs) / 1_000);
      const durationSeconds = Math.max(MIN_BLOCK_SECONDS, Math.min(MAX_BLOCK_SECONDS, diffSeconds));

      toBlock.push({
        id: account.id,
        durationSeconds,
        reason: "quota-depleted",
      });
      survivingCount--;
    }
  }

  return {
    toBlock,
    skippedLastSurviving,
    activeAccountsCount: survivingCount,
  };
}
