import { DEFAULT_STALE_MINUTES, routeFreshness } from "../health";
import type { BalanceAlertThresholds } from "../settings";
import type { HealthResult, UsageLimit } from "../types";
import type { BuildDashboardOptions, DashboardRoute, UsageLevel } from "./types";

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

export function routeFor(
  health: HealthResult | undefined,
  now: number,
  staleMinutes: number = DEFAULT_STALE_MINUTES,
): DashboardRoute {
  if (!health) {
    return {
      text: "—",
      level: "unknown",
      model: null,
      checkedAt: null,
      lastStatus: null,
      detail: null,
    };
  }

  const freshness = routeFreshness(health, now, staleMinutes * 60_000);
  if (freshness === "unknown") {
    return {
      text: "—",
      level: "unknown",
      model: health.model ?? null,
      checkedAt: null,
      lastStatus: null,
      detail: null,
    };
  }

  if (freshness === "stale") {
    return {
      text: "STALE",
      level: "unknown",
      model: health.model ?? null,
      checkedAt: health.checkedAt ?? null,
      lastStatus: health.status ?? null,
      detail: health.detail ?? null,
    };
  }

  const model = health.model ?? null;
  const checkedAt = health.checkedAt ?? null;
  const lastStatus = health.status ?? null;
  const detail = health.detail ?? null;

  switch (health.status) {
    case "ok":
      return { text: "OK", level: "ok", model, checkedAt, lastStatus, detail };
    case "hang":
      return { text: "HANG", level: "critical", model, checkedAt, lastStatus, detail };
    case "error":
      return { text: "ERR", level: "critical", model, checkedAt, lastStatus, detail };
    case "auth":
      return { text: "AUTH", level: "warn", model, checkedAt, lastStatus, detail };
    case "model-error":
      return { text: "MODEL", level: "warn", model, checkedAt, lastStatus, detail };
    default:
      return { text: "ERR", level: "critical", model, checkedAt, lastStatus, detail };
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
