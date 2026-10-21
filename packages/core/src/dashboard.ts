import { money } from "./format";
import type { BalanceAlertThresholds } from "./settings";
import type { HealthResult, ProviderSection, Status, UsageLimit } from "./types";
import { limitFor, local, providerName, shortProvider, usedPercent } from "./usage";

export type UsageLevel = "ok" | "warn" | "hot" | "critical" | "unknown";
export type RouteText = "OK" | "HANG" | "AUTH" | "MODEL" | "ERR" | "—";
export const DASHBOARD_SCHEMA_VERSION = 2 as const;

export interface DashboardLimit {
  id?: string;
  label: string;
  unit?: string;
  usedFraction?: number;
  resetsAt?: number;
  remaining?: number;
  low: boolean;
  level: UsageLevel;
}

export interface DashboardRoute {
  text: RouteText;
  level: UsageLevel;
}

export interface DashboardRow {
  account: string;
  displayAccount: string;
  health: Status | null;
  maxUsed: number;
  level: UsageLevel;
  route: DashboardRoute;
  limits: DashboardLimit[];
}

export interface DashboardProvider {
  id: string;
  name: string;
  suffix: string;
  accounts: number;
  columns: Array<{ key: string; label: string }>;
  rows: DashboardRow[];
}

export interface DashboardSummary {
  providers: number;
  accounts: number;
  above80: number;
  maxed: number;
  aboveThreshold: number;
  tightest: { provider: string; account: string; usedFraction: number } | null;
}

export interface DashboardHealth {
  checkedAt: number;
  ageMs: number;
  stale: boolean;
}

export interface DashboardBalance {
  unit: "cny" | "usd";
  remaining: number;
  low: boolean;
}

export interface Dashboard {
  fetchedAt: number;
  providers: DashboardProvider[];
  summary: DashboardSummary;
  health: DashboardHealth | null;
  balance: DashboardBalance | null;
  tooltip: string;
  iconLevel: UsageLevel;
}

export interface BuildDashboardOptions {
  fetchedAt: number;
  now: number;
  showHealth: boolean;
  checkedAt?: number;
  thresholds: { warm: number; hot: number; critical: number; above: number };
  staleMinutes: number;
  balanceAlert: BalanceAlertThresholds;
}

export function usageLevel(
  value: number | undefined,
  thresholds: BuildDashboardOptions["thresholds"],
): UsageLevel {
  if (value === undefined) return "unknown";
  if (value >= thresholds.critical) return "critical";
  if (value >= thresholds.hot) return "hot";
  if (value >= thresholds.warm) return "warn";
  return "ok";
}

export function routeFor(health: HealthResult | undefined): DashboardRoute {
  if (!health) return { text: "—", level: "unknown" };
  switch (health.status) {
    case "ok":
      return { text: "OK", level: "ok" };
    case "hang":
      return { text: "HANG", level: "critical" };
    case "error":
      return { text: "ERR", level: "critical" };
    case "auth":
      return { text: "AUTH", level: "warn" };
    case "model-error":
      return { text: "MODEL", level: "warn" };
    default:
      return { text: "ERR", level: "critical" };
  }
}

export function isLowBalance(
  limit: UsageLimit | undefined,
  thresholds: BalanceAlertThresholds,
): boolean {
  if (!limit?.id?.endsWith(":balance")) return false;
  const unit = limit.amount?.unit?.toLowerCase();
  const threshold = unit === "cny" ? thresholds.cny : unit === "usd" ? thresholds.usd : undefined;
  const remaining = limit.amount?.remaining;
  return threshold !== undefined && remaining !== undefined && remaining <= threshold;
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

    return {
      id: section.provider,
      name: providerName(section.provider),
      suffix,
      accounts: section.reports.length,
      columns: section.columns.map((col) => ({ key: col.key, label: col.label })),
      rows,
    };
  });

  const allRows = providers.flatMap((provider) => provider.rows);
  const above80 = allRows.filter((row) => row.maxUsed >= options.thresholds.above).length;
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

  const summary: DashboardSummary = {
    providers: sections.length,
    accounts: allRows.length,
    above80,
    maxed,
    aboveThreshold: options.thresholds.above,
    tightest,
  };

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
  if (tightest) {
    parts.push(`${tightest.account} ${Math.round(tightest.usedFraction * 100)}%`);
  }
  if (badCount > 0) {
    parts.push(`${badCount} HANG`);
  }
  if (balance) {
    parts.push(money(balance.remaining, balance.unit));
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

const VALID_STATUSES = new Set<string>(["ok", "hang", "error", "auth", "model-error"]);
const VALID_LEVELS = new Set<string>(["ok", "warn", "hot", "critical", "unknown"]);
const VALID_ROUTES = new Set<string>(["OK", "HANG", "AUTH", "MODEL", "ERR", "—"]);

export function isDashboard(value: unknown): value is Dashboard {
  if (!value || typeof value !== "object") return false;
  const d = value as Partial<Dashboard>;

  if (typeof d.fetchedAt !== "number" || !Number.isFinite(d.fetchedAt)) return false;
  if (!Array.isArray(d.providers)) return false;

  for (const p of d.providers) {
    if (!p || typeof p !== "object") return false;
    if (typeof p.id !== "string" || typeof p.name !== "string" || typeof p.suffix !== "string") {
      return false;
    }
    if (typeof p.accounts !== "number" || !Number.isFinite(p.accounts)) return false;
    if (!Array.isArray(p.columns) || !Array.isArray(p.rows)) return false;

    for (const c of p.columns) {
      if (!c || typeof c !== "object" || typeof c.key !== "string" || typeof c.label !== "string") {
        return false;
      }
    }

    for (const r of p.rows) {
      if (!r || typeof r !== "object") return false;
      if (typeof r.account !== "string" || typeof r.displayAccount !== "string") return false;
      if (r.health !== null && !VALID_STATUSES.has(r.health)) return false;
      if (typeof r.maxUsed !== "number" || !Number.isFinite(r.maxUsed)) return false;
      if (!VALID_LEVELS.has(r.level)) return false;
      if (!r.route || typeof r.route !== "object") return false;
      if (!VALID_ROUTES.has(r.route.text) || !VALID_LEVELS.has(r.route.level)) return false;
      if (!Array.isArray(r.limits) || r.limits.length !== p.columns.length) return false;

      for (const l of r.limits) {
        if (!l || typeof l !== "object") return false;
        if (typeof l.label !== "string" || typeof l.low !== "boolean") return false;
        if (!VALID_LEVELS.has(l.level)) return false;
        if (l.id !== undefined && typeof l.id !== "string") return false;
        if (l.unit !== undefined && typeof l.unit !== "string") return false;
        if (
          l.usedFraction !== undefined &&
          (typeof l.usedFraction !== "number" || !Number.isFinite(l.usedFraction))
        ) {
          return false;
        }
        if (
          l.resetsAt !== undefined &&
          (typeof l.resetsAt !== "number" || !Number.isFinite(l.resetsAt))
        ) {
          return false;
        }
        if (
          l.remaining !== undefined &&
          (typeof l.remaining !== "number" || !Number.isFinite(l.remaining))
        ) {
          return false;
        }
      }
    }
  }

  if (!d.summary || typeof d.summary !== "object") return false;
  const s = d.summary;
  if (
    typeof s.providers !== "number" ||
    typeof s.accounts !== "number" ||
    typeof s.above80 !== "number" ||
    typeof s.maxed !== "number" ||
    typeof s.aboveThreshold !== "number"
  ) {
    return false;
  }
  if (
    s.tightest !== null &&
    (!s.tightest ||
      typeof s.tightest.provider !== "string" ||
      typeof s.tightest.account !== "string" ||
      typeof s.tightest.usedFraction !== "number" ||
      !Number.isFinite(s.tightest.usedFraction))
  ) {
    return false;
  }

  if (d.health !== null) {
    if (!d.health || typeof d.health !== "object") return false;
    if (
      typeof d.health.checkedAt !== "number" ||
      !Number.isFinite(d.health.checkedAt) ||
      typeof d.health.ageMs !== "number" ||
      !Number.isFinite(d.health.ageMs) ||
      typeof d.health.stale !== "boolean"
    ) {
      return false;
    }
  }

  if (d.balance !== null) {
    if (!d.balance || typeof d.balance !== "object") return false;
    if (d.balance.unit !== "cny" && d.balance.unit !== "usd") return false;
    if (typeof d.balance.remaining !== "number" || !Number.isFinite(d.balance.remaining))
      return false;
    if (typeof d.balance.low !== "boolean") return false;
  }

  if (typeof d.tooltip !== "string") return false;
  if (!d.iconLevel || !VALID_LEVELS.has(d.iconLevel)) return false;

  return true;
}
