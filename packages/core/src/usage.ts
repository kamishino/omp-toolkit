import type { AccountSortOrder } from "./dashboard/types";
import { DEFAULT_MODEL_WIRE, routeFreshness, routeKey } from "./health";
import type {
  HealthResult,
  ProviderRow,
  ProviderSection,
  UsageColumn,
  UsageLimit,
  UsageReport,
} from "./types";
import { getUsageProviderAdapter } from "./usage-providers";

const WINDOW_ORDER = [
  "5 hour",
  "5 hours",
  "5h",
  "300m",
  "daily",
  "weekly",
  "1w",
  "monthly",
  "30 days",
];

export function providerName(provider: string): string {
  const adapter = getUsageProviderAdapter(provider);
  if (adapter?.displayName) return adapter.displayName;
  const names: Record<string, string> = {
    "google-antigravity": "GOOGLE ANTIGRAVITY",
    "openai-codex": "OPENAI CODEX",
    "muse-code": "MUSE CODE",
    deepseek: "DEEPSEEK",
  };
  return names[provider] ?? provider.replace(/-/g, " ").toUpperCase();
}

export function shortProvider(provider: string): string {
  const adapter = getUsageProviderAdapter(provider);
  if (adapter?.shortName) return adapter.shortName;
  const names: Record<string, string> = {
    "google-antigravity": "antigravity",
    "openai-codex": "codex",
    "muse-code": "muse",
  };
  return names[provider] ?? provider;
}

export function accountName(report: UsageReport): string {
  return (
    report.metadata?.email ?? report.metadata?.accountId ?? report.metadata?.projectId ?? "unknown"
  );
}

export function local(email: string): string {
  return email.split("@")[0] ?? email;
}

export function usedPercent(limit: UsageLimit | undefined): number | undefined {
  const value = limit?.amount?.usedFraction;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : undefined;
}

function limitKey(limit: UsageLimit): string {
  return `${limit.label ?? ""}|${limit.window?.label ?? limit.label ?? "limit"}`;
}

export function columnsFor(provider: string, reports: UsageReport[]): UsageColumn[] {
  const adapter = getUsageProviderAdapter(provider);
  const columns = new Map<string, UsageColumn>();
  for (const report of reports) {
    for (const limit of report.limits ?? []) {
      if (adapter?.filterLimit && !adapter.filterLimit(limit)) {
        continue;
      }
      const key = limitKey(limit);
      if (!columns.has(key)) {
        columns.set(key, {
          key,
          label: limit.window?.label ?? limit.label ?? "LIMIT",
        });
      }
    }
  }
  return [...columns.values()].sort((a, b) => {
    const ai = WINDOW_ORDER.indexOf(a.label.toLowerCase());
    const bi = WINDOW_ORDER.indexOf(b.label.toLowerCase());
    const ar = ai === -1 ? 99 : ai;
    const br = bi === -1 ? 99 : bi;
    return ar - br || a.label.localeCompare(b.label);
  });
}

export function limitFor(report: UsageReport, column: UsageColumn): UsageLimit | undefined {
  return (report.limits ?? []).find((limit) => limitKey(limit) === column.key);
}

function healthRank(row: ProviderRow, now: number): number {
  if (!row.health) return 2;
  const freshness = routeFreshness(row.health, now);
  if (freshness !== "fresh") return 2;

  switch (row.health.status) {
    case "hang":
    case "error":
      return 0;
    case "auth":
    case "model-error":
      return 1;
    case "ok":
      return 3;
    default:
      return 1;
  }
}

export interface RowSortOptions {
  sortOrder?: AccountSortOrder;
  now?: number;
  probeModel?: string;
}

interface SortableRow {
  row: ProviderRow;
  timeToReset: number;
}

function compareAscending(a: number, b: number): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Weekly limit for a report: the column labelled "weekly" when present,
 * otherwise the first limit carrying a `window.resetsAt`.
 */
function weeklyResetAt(
  report: UsageReport,
  weeklyCol: UsageColumn | undefined,
): number | undefined {
  const weekly = weeklyCol ? limitFor(report, weeklyCol) : undefined;
  const weeklyResetsAt = weekly?.window?.resetsAt;
  if (typeof weeklyResetsAt === "number" && Number.isFinite(weeklyResetsAt)) return weeklyResetsAt;
  for (const limit of report.limits ?? []) {
    const resetsAt = limit.window?.resetsAt;
    if (typeof resetsAt === "number" && Number.isFinite(resetsAt)) return resetsAt;
  }
  return undefined;
}

function compareWeeklyReset(a: SortableRow, b: SortableRow): number {
  return (
    compareAscending(a.timeToReset, b.timeToReset) ||
    (b.row.primary ?? b.row.max) - (a.row.primary ?? a.row.max) ||
    a.row.account.localeCompare(b.row.account)
  );
}

function compareWeeklyUsage(a: SortableRow, b: SortableRow): number {
  return (
    (b.row.primary ?? b.row.max) - (a.row.primary ?? a.row.max) ||
    (b.row.secondary ?? b.row.max) - (a.row.secondary ?? a.row.max) ||
    b.row.max - a.row.max ||
    a.row.account.localeCompare(b.row.account)
  );
}

function rowsFor(
  reports: UsageReport[],
  columns: UsageColumn[],
  health: Map<string, HealthResult>,
  options: RowSortOptions = {},
): ProviderRow[] {
  const weeklyCol = columns.find((c) => c.label.toLowerCase() === "weekly");
  const now = options.now ?? Date.now();
  const sortOrder = options.sortOrder ?? "weekly-reset";
  const model = options.probeModel ?? DEFAULT_MODEL_WIRE;

  const sortable: SortableRow[] = reports.map((report) => {
    const account = accountName(report);
    const selected = columns
      .map((column) => limitFor(report, column))
      .filter((limit): limit is UsageLimit => !!limit);
    const source = selected.length > 0 ? selected : (report.limits ?? []);
    const max = Math.max(0, ...source.map((limit) => usedPercent(limit) ?? 0));
    const weeklyLimit = weeklyCol ? limitFor(report, weeklyCol) : undefined;
    const weeklyUsed = weeklyLimit ? usedPercent(weeklyLimit) : undefined;
    const firstUsed = selected[0] ? (usedPercent(selected[0]) ?? 0) : max;
    const primary = weeklyUsed !== undefined ? weeklyUsed : firstUsed;
    const secondary = weeklyUsed !== undefined ? firstUsed : max;
    const resetsAt = weeklyResetAt(report, weeklyCol);

    let healthResult: HealthResult | undefined;
    if (report.provider === "google-antigravity") {
      const email = report.metadata?.email;
      const project = report.metadata?.projectId;
      if (typeof email === "string" && typeof project === "string") {
        const k = routeKey({
          provider: "google-antigravity",
          email,
          project,
          model,
        });
        healthResult = health.get(k);
      }
      if (!healthResult && typeof email === "string") {
        healthResult = health.get(email.toLowerCase()) ?? health.get(email);
      }
      if (!healthResult) {
        healthResult = health.get(account.toLowerCase()) ?? health.get(account);
      }
    }
    if (healthResult && (healthResult.checkedAt === undefined || healthResult.checkedAt === null)) {
      healthResult = { ...healthResult, checkedAt: now };
    }
    return {
      timeToReset: typeof resetsAt === "number" && resetsAt > now ? resetsAt - now : Infinity,
      row: {
        report,
        account,
        health: healthResult,
        max,
        primary,
        secondary,
      },
    };
  });

  const compare = sortOrder === "weekly-usage" ? compareWeeklyUsage : compareWeeklyReset;
  sortable.sort((a, b) => healthRank(a.row, now) - healthRank(b.row, now) || compare(a, b));
  return sortable.map((entry) => entry.row);
}

function groupReports(reports: UsageReport[]): Map<string, UsageReport[]> {
  const grouped = new Map<string, UsageReport[]>();
  for (const report of reports) {
    const list = grouped.get(report.provider) ?? [];
    list.push(report);
    grouped.set(report.provider, list);
  }
  return grouped;
}

export function sectionsFor(
  reports: UsageReport[],
  health: Map<string, HealthResult>,
  options: RowSortOptions = {},
): ProviderSection[] {
  return [...groupReports(reports).entries()].map(([provider, providerReports]) => {
    const columns = columnsFor(provider, providerReports);
    return {
      provider,
      reports: providerReports,
      columns,
      rows: rowsFor(providerReports, columns, health, options),
    };
  });
}

/** Providers that authenticate through OAuth credentials (not plain API keys). */
export const OAUTH_USAGE_PROVIDERS: readonly string[] = [
  "google-antigravity",
  "muse-code",
  "openai-codex",
];

const CARRIED_NOTE = "Carried from the last reported usage";

/** A report reconstructed from cached history because the live fetch failed. */
export function isCarriedReport(report: UsageReport): boolean {
  return (report.limits ?? []).some((limit) =>
    (limit.notes ?? []).some((note) => note.includes(CARRIED_NOTE)),
  );
}

/**
 * Drops reports that cannot be backed by local credentials on this machine.
 *
 * `authenticatedProviders` comes from `omp usage accounts`; `undefined` means
 * the lookup failed, so only cached "carried" reports are pruned.
 */
export function filterActiveReports(
  reports: UsageReport[],
  authenticatedProviders?: ReadonlySet<string> | null,
): UsageReport[] {
  const authenticated = authenticatedProviders ?? undefined;
  return reports.filter((report) => {
    const carried = isCarriedReport(report);
    if (OAUTH_USAGE_PROVIDERS.includes(report.provider)) {
      return authenticated ? authenticated.has(report.provider) : !carried;
    }
    return !carried || report.metadata?.balance?.available !== false;
  });
}
