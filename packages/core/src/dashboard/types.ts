import type { WeeklyPacing } from "../pacing";
import type { WindowEvaluation } from "../schedule";
import type { BalanceAlertThresholds } from "../settings";
import type { EffectiveRouteStatus, HealthIncident, Status } from "../types";
export type UsageLevel = "ok" | "warn" | "hot" | "critical" | "unknown";

export const ACCOUNT_SORT_ORDERS = ["weekly-reset", "weekly-usage"] as const;

/**
 * Account ordering inside a provider section.
 * - `weekly-reset`: soonest weekly reset first (default).
 * - `weekly-usage`: highest quota usage first.
 */
export type AccountSortOrder = (typeof ACCOUNT_SORT_ORDERS)[number];

export function isAccountSortOrder(value: unknown): value is AccountSortOrder {
  return typeof value === "string" && (ACCOUNT_SORT_ORDERS as readonly string[]).includes(value);
}

export const DEFAULT_ACCOUNT_SORT_ORDER: AccountSortOrder = "weekly-reset";
export type RouteText = "OK" | "HANG" | "AUTH" | "MODEL" | "ERR" | "STALE" | "—";
export const DASHBOARD_SCHEMA_VERSION = 3 as const;

export interface DashboardLimit {
  id?: string;
  label: string;
  unit?: string;
  usedFraction?: number;
  resetsAt?: number;
  remaining?: number;
  low: boolean;
  level: UsageLevel;
  pacing?: WeeklyPacing;
}

export interface DashboardRoute {
  text: RouteText;
  level: UsageLevel;
  model?: string | null;
  checkedAt?: number | null;
  lastStatus?: Status | null;
  detail?: string | null;
}

export interface DashboardRow {
  account: string;
  displayAccount: string;
  health: EffectiveRouteStatus | null;
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
  timeWindow?: WindowEvaluation | null;
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
  incident: HealthIncident | null;
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
  incident?: HealthIncident | null;
  thresholds: { warm: number; hot: number; critical: number; above: number };
  staleMinutes: number;
  balanceAlert: BalanceAlertThresholds;
  userTimeZone?: string;
}

export const DEFAULT_USAGE_THRESHOLDS = {
  warm: 0.4,
  hot: 0.7,
  critical: 0.85,
  above: 0.8,
} as const;

export { DEFAULT_STALE_MINUTES } from "../health";

export interface AssembleDashboardOptions {
  now?: number;
  showHealth?: boolean;
  thresholds?: { warm: number; hot: number; critical: number; above: number };
  staleMinutes?: number;
  balanceAlert?: BalanceAlertThresholds;
  userTimeZone?: string;
  accountSort?: AccountSortOrder;
  probeModel?: string;
}
