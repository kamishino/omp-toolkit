import type { WindowEvaluation } from "../schedule";
import type { BalanceAlertThresholds } from "../settings";
import type { Status } from "../types";

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
  userTimeZone?: string;
}

export const DEFAULT_USAGE_THRESHOLDS = {
  warm: 0.4,
  hot: 0.7,
  critical: 0.85,
  above: 0.8,
} as const;

export const DEFAULT_STALE_MINUTES = 15;

export interface AssembleDashboardOptions {
  now?: number;
  showHealth?: boolean;
  thresholds?: { warm: number; hot: number; critical: number; above: number };
  staleMinutes?: number;
  balanceAlert?: BalanceAlertThresholds;
  userTimeZone?: string;
}
