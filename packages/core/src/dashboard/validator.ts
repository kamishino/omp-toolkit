import type { WindowEvaluation } from "../schedule";
import type { Dashboard } from "./types";

export const VALID_STATUSES: Record<string, true> = {
  ok: true,
  hang: true,
  error: true,
  auth: true,
  "model-error": true,
};

export const VALID_LEVELS: Record<string, true> = {
  ok: true,
  warn: true,
  hot: true,
  critical: true,
  unknown: true,
};

export const VALID_ROUTES: Record<string, true> = {
  OK: true,
  HANG: true,
  AUTH: true,
  MODEL: true,
  ERR: true,
  "—": true,
};

export function isDashboardColumn(c: unknown): boolean {
  if (!c || typeof c !== "object") return false;
  const col = c as { key?: unknown; label?: unknown };
  return typeof col.key === "string" && typeof col.label === "string";
}

export function isDashboardLimit(l: unknown): boolean {
  if (!l || typeof l !== "object") return false;
  const lim = l as {
    label?: unknown;
    low?: unknown;
    level?: unknown;
    id?: unknown;
    unit?: unknown;
    usedFraction?: unknown;
    resetsAt?: unknown;
    remaining?: unknown;
  };

  if (typeof lim.label !== "string" || typeof lim.low !== "boolean") return false;
  if (!lim.level || typeof lim.level !== "string" || !VALID_LEVELS[lim.level]) return false;
  if (lim.id !== undefined && typeof lim.id !== "string") return false;
  if (lim.unit !== undefined && typeof lim.unit !== "string") return false;
  if (
    lim.usedFraction !== undefined &&
    (typeof lim.usedFraction !== "number" || !Number.isFinite(lim.usedFraction))
  ) {
    return false;
  }
  if (
    lim.resetsAt !== undefined &&
    (typeof lim.resetsAt !== "number" || !Number.isFinite(lim.resetsAt))
  ) {
    return false;
  }
  if (
    lim.remaining !== undefined &&
    (typeof lim.remaining !== "number" || !Number.isFinite(lim.remaining))
  ) {
    return false;
  }
  return true;
}

export function isDashboardRow(r: unknown, columnsCount: number): boolean {
  if (!r || typeof r !== "object") return false;
  const row = r as {
    account?: unknown;
    displayAccount?: unknown;
    health?: unknown;
    maxUsed?: unknown;
    level?: unknown;
    route?: { text?: unknown; level?: unknown };
    limits?: unknown[];
  };

  if (typeof row.account !== "string" || typeof row.displayAccount !== "string") return false;
  if (row.health !== null && (typeof row.health !== "string" || !VALID_STATUSES[row.health])) {
    return false;
  }
  if (typeof row.maxUsed !== "number" || !Number.isFinite(row.maxUsed)) return false;
  if (!row.level || typeof row.level !== "string" || !VALID_LEVELS[row.level]) return false;
  if (!row.route || typeof row.route !== "object") return false;
  if (
    !row.route.text ||
    typeof row.route.text !== "string" ||
    !VALID_ROUTES[row.route.text] ||
    !row.route.level ||
    typeof row.route.level !== "string" ||
    !VALID_LEVELS[row.route.level]
  ) {
    return false;
  }
  if (!Array.isArray(row.limits) || row.limits.length !== columnsCount) return false;

  return row.limits.every(isDashboardLimit);
}

export function isDashboardProvider(p: unknown): boolean {
  if (!p || typeof p !== "object") return false;
  const prov = p as {
    id?: unknown;
    name?: unknown;
    suffix?: unknown;
    accounts?: unknown;
    timeWindow?: unknown;
    columns?: unknown[];
    rows?: unknown[];
  };

  if (
    typeof prov.id !== "string" ||
    typeof prov.name !== "string" ||
    typeof prov.suffix !== "string"
  ) {
    return false;
  }
  if (typeof prov.accounts !== "number" || !Number.isFinite(prov.accounts)) return false;
  if (
    prov.timeWindow !== undefined &&
    prov.timeWindow !== null &&
    (typeof prov.timeWindow !== "object" ||
      typeof (prov.timeWindow as WindowEvaluation).isPeak !== "boolean" ||
      typeof (prov.timeWindow as WindowEvaluation).rateMultiplier !== "number")
  ) {
    return false;
  }
  if (!Array.isArray(prov.columns) || !Array.isArray(prov.rows)) return false;
  if (!prov.columns.every(isDashboardColumn)) return false;

  const colCount = prov.columns.length;
  return prov.rows.every((row) => isDashboardRow(row, colCount));
}

export function isDashboardSummary(s: unknown): boolean {
  if (!s || typeof s !== "object") return false;
  const sum = s as {
    providers?: unknown;
    accounts?: unknown;
    above80?: unknown;
    maxed?: unknown;
    aboveThreshold?: unknown;
    tightest?: {
      provider?: unknown;
      account?: unknown;
      usedFraction?: unknown;
    } | null;
  };

  if (
    typeof sum.providers !== "number" ||
    typeof sum.accounts !== "number" ||
    typeof sum.above80 !== "number" ||
    typeof sum.maxed !== "number" ||
    typeof sum.aboveThreshold !== "number"
  ) {
    return false;
  }

  if (sum.tightest !== null) {
    if (
      !sum.tightest ||
      typeof sum.tightest.provider !== "string" ||
      typeof sum.tightest.account !== "string" ||
      typeof sum.tightest.usedFraction !== "number" ||
      !Number.isFinite(sum.tightest.usedFraction)
    ) {
      return false;
    }
  }

  return true;
}

export function isDashboardHealth(h: unknown): boolean {
  if (!h || typeof h !== "object") return false;
  const health = h as { checkedAt?: unknown; ageMs?: unknown; stale?: unknown };
  return (
    typeof health.checkedAt === "number" &&
    Number.isFinite(health.checkedAt) &&
    typeof health.ageMs === "number" &&
    Number.isFinite(health.ageMs) &&
    typeof health.stale === "boolean"
  );
}

export function isDashboardBalance(b: unknown): boolean {
  if (!b || typeof b !== "object") return false;
  const bal = b as { unit?: unknown; remaining?: unknown; low?: unknown };
  return (
    (bal.unit === "cny" || bal.unit === "usd") &&
    typeof bal.remaining === "number" &&
    Number.isFinite(bal.remaining) &&
    typeof bal.low === "boolean"
  );
}

export function isDashboard(value: unknown): value is Dashboard {
  if (!value || typeof value !== "object") return false;
  const d = value as Partial<Dashboard>;

  if (typeof d.fetchedAt !== "number" || !Number.isFinite(d.fetchedAt)) return false;
  if (!Array.isArray(d.providers) || !d.providers.every(isDashboardProvider)) return false;
  if (!isDashboardSummary(d.summary)) return false;
  if (d.health !== null && !isDashboardHealth(d.health)) return false;
  if (d.balance !== null && !isDashboardBalance(d.balance)) return false;
  if (typeof d.tooltip !== "string") return false;
  if (!d.iconLevel || typeof d.iconLevel !== "string" || !VALID_LEVELS[d.iconLevel]) return false;

  return true;
}
