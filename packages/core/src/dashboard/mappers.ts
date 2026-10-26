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
