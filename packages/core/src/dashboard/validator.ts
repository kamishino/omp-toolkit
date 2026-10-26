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
    if (
      p.timeWindow !== undefined &&
      p.timeWindow !== null &&
      (typeof p.timeWindow !== "object" ||
        typeof (p.timeWindow as WindowEvaluation).isPeak !== "boolean" ||
        typeof (p.timeWindow as WindowEvaluation).rateMultiplier !== "number")
    ) {
      return false;
    }
    if (!Array.isArray(p.columns) || !Array.isArray(p.rows)) return false;

    for (const c of p.columns) {
      if (!c || typeof c !== "object" || typeof c.key !== "string" || typeof c.label !== "string") {
        return false;
      }
    }

    for (const r of p.rows) {
      if (!r || typeof r !== "object") return false;
      if (typeof r.account !== "string" || typeof r.displayAccount !== "string") return false;
      if (r.health !== null && !VALID_STATUSES[r.health]) return false;
      if (typeof r.maxUsed !== "number" || !Number.isFinite(r.maxUsed)) return false;
      if (!VALID_LEVELS[r.level]) return false;
      if (!r.route || typeof r.route !== "object") return false;
      if (!VALID_ROUTES[r.route.text] || !VALID_LEVELS[r.route.level]) return false;
      if (!Array.isArray(r.limits) || r.limits.length !== p.columns.length) return false;

      for (const l of r.limits) {
        if (!l || typeof l !== "object") return false;
        if (typeof l.label !== "string" || typeof l.low !== "boolean") return false;
        if (!VALID_LEVELS[l.level]) return false;
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
  if (!d.iconLevel || !VALID_LEVELS[d.iconLevel]) return false;

  return true;
}
