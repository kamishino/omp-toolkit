import type { UsageReport } from "./types";
import { usedPercent } from "./usage";

export interface QuotaAlertItem {
  account: string;
  provider: string;
  kind: "warn-90" | "reset";
  title: string;
  message: string;
  severity: "warn" | "info";
}

export interface AccountAlertHistoryEntry {
  lastWarnAt?: number;
  lastResetAt?: number;
  previousUsedFraction?: number;
}

export type QuotaAlertHistory = Record<string, AccountAlertHistoryEntry>;

export const QUOTA_ALERT_DEBOUNCE_MS = 900_000; // 15 minutes

/**
 * Evaluates whether any account has crossed the 90% warning threshold
 * or rolled over after being depleted, debouncing alerts to 15 minutes.
 */
export function evaluateQuotaAlerts(
  reports: readonly UsageReport[],
  history: QuotaAlertHistory,
  nowMs: number = Date.now(),
): { alerts: QuotaAlertItem[]; updatedHistory: QuotaAlertHistory } {
  const alerts: QuotaAlertItem[] = [];
  const updatedHistory: QuotaAlertHistory = { ...history };

  for (const report of reports) {
    const account = report.metadata?.email ?? report.metadata?.accountId ?? "unknown";
    if (account === "unknown") continue;

    const limits = report.limits ?? [];
    if (limits.length === 0) continue;

    // Determine primary window usage
    const weeklyLimit = limits.find((l) => l.label?.toLowerCase() === "weekly");
    const primaryLimit = weeklyLimit ?? limits[0];
    const used = usedPercent(primaryLimit) ?? 0;

    const entry: AccountAlertHistoryEntry = { ...(updatedHistory[account] ?? {}) };
    const prevUsed = entry.previousUsedFraction ?? used;

    // 1. Quota >= 90% alert
    if (used >= 0.9) {
      const timeSinceWarn = nowMs - (entry.lastWarnAt ?? 0);
      if (
        timeSinceWarn >= QUOTA_ALERT_DEBOUNCE_MS &&
        (entry.lastWarnAt === undefined || prevUsed < 0.9)
      ) {
        alerts.push({
          account,
          provider: report.provider,
          kind: "warn-90",
          title: "Quota Warning (≥90%)",
          message: `${account} has reached ${Math.round(used * 100)}% quota on ${report.provider}.`,
          severity: "warn",
        });
        entry.lastWarnAt = nowMs;
      }
    }

    // 2. Quota Reset alert (previously >= 80%, now dropped < 20%)
    if (prevUsed >= 0.8 && used < 0.2) {
      const timeSinceReset = nowMs - (entry.lastResetAt ?? 0);
      if (timeSinceReset >= QUOTA_ALERT_DEBOUNCE_MS) {
        alerts.push({
          account,
          provider: report.provider,
          kind: "reset",
          title: "Quota Rollover Reset",
          message: `${account} quota has reset (${Math.round(used * 100)}% used). Ready for tasks.`,
          severity: "info",
        });
        entry.lastResetAt = nowMs;
      }
    }

    entry.previousUsedFraction = used;
    updatedHistory[account] = entry;
  }

  return { alerts, updatedHistory };
}
