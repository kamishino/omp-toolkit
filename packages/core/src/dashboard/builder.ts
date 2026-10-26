import { money } from "../format";
import { evaluateWindow, getTimeWindowPolicy } from "../schedule";
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

    const policy = getTimeWindowPolicy(section.provider);
    const timeWindow = policy ? evaluateWindow(policy, options.now, options.userTimeZone) : null;

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

  const checkedAt = options.checkedAt;
  let health: DashboardHealth | null = null;
  if (options.showHealth) {
    const ts = checkedAt ?? 0;
    health = {
      checkedAt: ts,
      ageMs: ts > 0 ? Math.max(0, options.now - ts) : 0,
      stale: ts > 0 && options.now - ts > options.staleMinutes * 60_000,
    };
  }

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
  const tooltip = parts.length > 0 ? `OMP: ${parts.join(" · ")}` : "OMP: no usage data";

  const rank: Record<UsageLevel, number> = {
    unknown: 0,
    ok: 1,
    warn: 2,
    hot: 3,
    critical: 4,
  };

  let iconLevel: UsageLevel = allRows.length === 0 ? "unknown" : "ok";
  if (allRows.length > 0) {
    for (const row of allRows) {
      if (row.route.level !== "unknown" && rank[row.route.level] > rank[iconLevel]) {
        iconLevel = row.route.level;
      }
      if (rank[row.level] > rank[iconLevel]) {
        iconLevel = row.level;
      }
    }
  }

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
