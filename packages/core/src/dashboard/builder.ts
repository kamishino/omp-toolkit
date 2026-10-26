import { money } from "../format";
import { scheduleRegistry } from "../schedule";
import { DEFAULT_BALANCE_ALERT } from "../settings";
import type { HealthResult, HealthSnapshot, ProviderSection, UsageReport } from "../types";
import { limitFor, local, providerName, sectionsFor, usedPercent } from "../usage";
import { isLowBalance, routeFor, usageLevel } from "./mappers";
import { calculateSummary } from "./summary";
import {
  type AssembleDashboardOptions,
  type BuildDashboardOptions,
  type Dashboard,
  type DashboardBalance,
  type DashboardHealth,
  type DashboardLimit,
  type DashboardProvider,
  type DashboardRow,
  type DashboardSummary,
  DEFAULT_STALE_MINUTES,
  DEFAULT_USAGE_THRESHOLDS,
  type UsageLevel,
} from "./types";

export function assembleDashboard(
  reports: UsageReport[],
  snapshot?: HealthSnapshot | null,
  options: AssembleDashboardOptions = {},
): Dashboard {
  const now = options.now ?? Date.now();
  const showHealth = options.showHealth ?? (snapshot !== undefined && snapshot !== null);
  const health = new Map<string, HealthResult>(
    (snapshot?.results ?? []).map((result) => [result.email, result]),
  );
  const sections = sectionsFor(reports, health);

  return buildDashboard(sections, {
    fetchedAt: now,
    now,
    showHealth,
    checkedAt: snapshot?.checkedAt,
    thresholds: options.thresholds ?? DEFAULT_USAGE_THRESHOLDS,
    staleMinutes: options.staleMinutes ?? DEFAULT_STALE_MINUTES,
    balanceAlert: options.balanceAlert ?? DEFAULT_BALANCE_ALERT,
    userTimeZone: options.userTimeZone,
  });
}

export function buildDashboard(
  sections: ProviderSection[],
  options: BuildDashboardOptions,
): Dashboard {
  const providers: DashboardProvider[] = sections.map((section) => {
    const plans = [
      ...new Set(
        section.reports
          .map((report) => report.metadata?.plan)
          .filter((plan): plan is string => typeof plan === "string" && plan.length > 0),
      ),
    ];
    const balanceCurrency = section.reports
      .map((report) => report.metadata?.balance?.currency)
      .find((currency): currency is string => typeof currency === "string" && currency.length > 0);

    const suffix =
      section.provider === "google-antigravity"
        ? " · Gemini"
        : balanceCurrency
          ? ` · ${balanceCurrency.toUpperCase()}`
          : plans.length === 1
            ? ` · ${plans[0]}`
            : "";

    const rows: DashboardRow[] = section.rows.map((row) => {
      const limits: DashboardLimit[] = section.columns.map((column) => {
        const limit = limitFor(row.report, column);
        const unit = limit?.amount?.unit?.toLowerCase();
        const usedFraction = usedPercent(limit);
        const low = isLowBalance(limit, options.balanceAlert);
        const level: UsageLevel =
          unit === "cny" || unit === "usd"
            ? low
              ? "critical"
              : "ok"
            : usageLevel(usedFraction, options.thresholds);

        return {
          id: limit?.id,
          label: column.label,
          ...(unit !== undefined ? { unit } : {}),
          ...(usedFraction !== undefined ? { usedFraction } : {}),
          ...(typeof limit?.window?.resetsAt === "number"
            ? { resetsAt: limit.window.resetsAt }
            : {}),
          ...(typeof limit?.amount?.remaining === "number"
            ? { remaining: limit.amount.remaining }
            : {}),
          low,
          level,
        };
      });

      return {
        account: row.account,
        displayAccount: local(row.account),
        health: row.health?.status ?? null,
        maxUsed: row.max,
        level: usageLevel(row.max, options.thresholds),
        route: routeFor(row.health),
        limits,
      };
    });

    const timeWindow = scheduleRegistry.evaluate(
      section.provider,
      options.now,
      options.userTimeZone,
    );

    return {
      id: section.provider,
      name: providerName(section.provider),
      suffix,
      accounts: section.reports.length,
      columns: section.columns.map((col) => ({ key: col.key, label: col.label })),
      rows,
      timeWindow,
    };
  });

  const allRows = providers.flatMap((provider) => provider.rows);
  const summary = calculateSummary(providers, sections.length, options.thresholds.above);
  const health = options.showHealth
    ? buildDashboardHealth(options.checkedAt, options.now, options.staleMinutes)
    : null;
  const balance = extractDeepSeekBalance(providers);
  const tooltip = buildDashboardTooltip(summary, allRows, balance, providers);
  const iconLevel = computeWorstUsageLevel(allRows);

  return {
    fetchedAt: options.fetchedAt,
    providers,
    summary,
    health,
    balance,
    tooltip,
    iconLevel,
  };
}

export function buildDashboardHealth(
  checkedAt: number | undefined,
  now: number,
  staleMinutes: number,
): DashboardHealth {
  const ts = checkedAt ?? 0;
  return {
    checkedAt: ts,
    ageMs: ts > 0 ? Math.max(0, now - ts) : 0,
    stale: ts > 0 && now - ts > staleMinutes * 60_000,
  };
}

export function extractDeepSeekBalance(
  providers: readonly DashboardProvider[],
): DashboardBalance | null {
  let balance: DashboardBalance | null = null;
  for (const provider of providers) {
    for (const row of provider.rows) {
      for (const limit of row.limits) {
        if (limit.id !== "deepseek:balance" || limit.remaining === undefined) continue;
        if (limit.unit !== "cny" && limit.unit !== "usd") continue;
        if (!balance || (limit.unit === "cny" && balance.unit === "usd")) {
          balance = {
            unit: limit.unit,
            remaining: limit.remaining,
            low: limit.low,
          };
        }
      }
    }
  }
  return balance;
}

export function buildDashboardTooltip(
  summary: DashboardSummary,
  allRows: readonly DashboardRow[],
  balance: DashboardBalance | null,
  providers: readonly DashboardProvider[],
): string {
  const badCount = allRows.filter((row) => row.health === "hang" || row.health === "error").length;
  const parts: string[] = [];
  if (summary.tightest) {
    parts.push(`${summary.tightest.account} ${Math.round(summary.tightest.usedFraction * 100)}%`);
  }
  if (badCount > 0) {
    parts.push(`${badCount} HANG`);
  }
  if (balance) {
    parts.push(money(balance.remaining, balance.unit));
  }
  const activePricing = providers.find((p) => p.timeWindow)?.timeWindow;
  if (activePricing) {
    parts.push(activePricing.isPeak ? "Peak" : "Off-Peak");
  }
  return parts.length > 0 ? `OMP: ${parts.join(" · ")}` : "OMP: no usage data";
}

const USAGE_LEVEL_RANK: Record<UsageLevel, number> = {
  unknown: 0,
  ok: 1,
  warn: 2,
  hot: 3,
  critical: 4,
};

export function computeWorstUsageLevel(allRows: readonly DashboardRow[]): UsageLevel {
  if (allRows.length === 0) return "unknown";
  let iconLevel: UsageLevel = "ok";
  for (const row of allRows) {
    if (
      row.route.level !== "unknown" &&
      USAGE_LEVEL_RANK[row.route.level] > USAGE_LEVEL_RANK[iconLevel]
    ) {
      iconLevel = row.route.level;
    }
    if (USAGE_LEVEL_RANK[row.level] > USAGE_LEVEL_RANK[iconLevel]) {
      iconLevel = row.level;
    }
  }
  return iconLevel;
}
