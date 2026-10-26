import { shortProvider } from "../usage";
import type { DashboardProvider, DashboardSummary } from "./types";

export function calculateSummary(
  providers: DashboardProvider[],
  sectionsCount: number,
  aboveThreshold: number,
): DashboardSummary {
  const allRows = providers.flatMap((provider) => provider.rows);
  const above80 = allRows.filter((row) => row.maxUsed >= aboveThreshold).length;
  const maxed = allRows.filter((row) => row.maxUsed >= 1).length;

  let tightest: DashboardSummary["tightest"] = null;
  for (const provider of providers) {
    for (const row of provider.rows) {
      if (!row.limits.some((limit) => limit.usedFraction !== undefined)) continue;
      if (!tightest || row.maxUsed > tightest.usedFraction) {
        tightest = {
          provider: shortProvider(provider.id),
          account: row.displayAccount,
          usedFraction: row.maxUsed,
        };
      }
    }
  }

  return {
    providers: sectionsCount,
    accounts: allRows.length,
    above80,
    maxed,
    aboveThreshold,
    tightest,
  };
}

export function summaryText(summary: DashboardSummary): string {
  const parts = [
    `${summary.providers} providers`,
    `${summary.accounts} accounts`,
    `${summary.above80} ≥${Math.round(summary.aboveThreshold * 100)}%`,
    `${summary.maxed} maxed`,
  ];
  if (summary.tightest) {
    parts.push(
      `tightest ${summary.tightest.provider}:${summary.tightest.account} ${Math.round(summary.tightest.usedFraction * 100)}%`,
    );
  } else {
    parts.push("no usage data");
  }
  return parts.join(" · ");
}
