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

export function limitKey(limit: UsageLimit): string {
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

export function healthRank(row: ProviderRow): number {
  if (!row.health) return 3;
  switch (row.health.status) {
    case "hang":
    case "error":
      return 0;
    case "auth":
    case "model-error":
      return 1;
    case "ok":
      return 2;
    default:
      return 1;
  }
}

export function rowsFor(
  reports: UsageReport[],
  columns: UsageColumn[],
  health: Map<string, HealthResult>,
): ProviderRow[] {
  return reports
    .map((report) => {
      const account = accountName(report);
      const selected = columns
        .map((column) => limitFor(report, column))
        .filter((limit): limit is UsageLimit => !!limit);
      const source = selected.length > 0 ? selected : (report.limits ?? []);
      const max = Math.max(0, ...source.map((limit) => usedPercent(limit) ?? 0));
      const primary = selected[0] ? (usedPercent(selected[0]) ?? 0) : max;
      return {
        report,
        account,
        health:
          health.get(account) ??
          (typeof report.metadata?.email === "string"
            ? health.get(report.metadata.email)
            : undefined),
        max,
        primary,
      };
    })
    .sort(
      (a, b) =>
        healthRank(a) - healthRank(b) ||
        (b.primary ?? b.max) - (a.primary ?? a.max) ||
        b.max - a.max ||
        a.account.localeCompare(b.account),
    );
}

export function groupReports(reports: UsageReport[]): Map<string, UsageReport[]> {
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
): ProviderSection[] {
  return [...groupReports(reports).entries()].map(([provider, providerReports]) => {
    const columns = columnsFor(provider, providerReports);
    return {
      provider,
      reports: providerReports,
      columns,
      rows: rowsFor(providerReports, columns, health),
    };
  });
}
