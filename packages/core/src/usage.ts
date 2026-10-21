import type {
  HealthResult,
  ProviderRow,
  ProviderSection,
  UsageColumn,
  UsageLimit,
  UsageReport,
} from "./types";

const WINDOW_ORDER = ["weekly", "5 hour", "5 hours", "30 days", "daily", "monthly", "300m", "1w"];

export function providerName(provider: string): string {
  const names: Record<string, string> = {
    "google-antigravity": "GOOGLE ANTIGRAVITY",
    "openai-codex": "OPENAI CODEX",
    "muse-code": "MUSE CODE",
    deepseek: "DEEPSEEK",
  };
  return names[provider] ?? provider.replace(/-/g, " ").toUpperCase();
}

export function shortProvider(provider: string): string {
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
  const columns = new Map<string, UsageColumn>();
  for (const report of reports) {
    for (const limit of report.limits ?? []) {
      if (
        provider === "google-antigravity" &&
        !/gemini/i.test(limit.label ?? "") &&
        !/gemini/i.test(limit.id ?? "")
      ) {
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
  provider: string,
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
      return {
        report,
        account,
        health: provider === "google-antigravity" ? health.get(account) : undefined,
        max,
      };
    })
    .sort(
      (a, b) =>
        healthRank(a) - healthRank(b) || b.max - a.max || a.account.localeCompare(b.account),
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
      rows: rowsFor(provider, providerReports, columns, health),
    };
  });
}
