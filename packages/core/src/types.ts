/**
 * Shared Type Definitions for @omp-toolkit/core
 *
 * Structured into three architectural layers:
 * 1. Route Health & Circuit Breaker Domain
 * 2. External Wire Schemas & Telemetry
 * 3. Tabular Presentation & Compilation Models
 */

// ── 1. Route Health & Circuit Breaker Domain ────────────────────────────────

export const STATUS_VALUES = ["ok", "hang", "error", "auth", "model-error"] as const;
export type Status = (typeof STATUS_VALUES)[number];

export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUS_VALUES as readonly string[]).includes(value);
}

export const EFFECTIVE_STATUS_VALUES = [...STATUS_VALUES, "stale"] as const;
export type EffectiveRouteStatus = (typeof EFFECTIVE_STATUS_VALUES)[number];

export function isEffectiveRouteStatus(value: unknown): value is EffectiveRouteStatus {
  return (
    typeof value === "string" && (EFFECTIVE_STATUS_VALUES as readonly string[]).includes(value)
  );
}

export interface RouteIdentity {
  provider: "google-antigravity";
  email: string;
  project: string;
  model: string;
}

export const ROUTE_FAILURE_KINDS = [
  "timeout",
  "auth",
  "credential",
  "model",
  "rate-limit",
  "transient",
  "network",
  "protocol",
] as const;
export type RouteFailureKind = (typeof ROUTE_FAILURE_KINDS)[number];

export function isRouteFailureKind(value: unknown): value is RouteFailureKind {
  return typeof value === "string" && (ROUTE_FAILURE_KINDS as readonly string[]).includes(value);
}

export interface HealthResult extends RouteIdentity {
  status: Status;
  ms: number;
  startedAt: number;
  checkedAt: number;
  failureKind: RouteFailureKind | null;
  confirmed: boolean;
  detail?: string;
}

export interface Account {
  index: number;
  email: string;
  project: string;
}

export interface ProbeResult extends Account, HealthResult {}

export interface ProbeSweep {
  startedAt: number;
  results: ProbeResult[];
}

export const HEALTH_INCIDENT_KINDS = [
  "all-failed",
  "restore-failed",
  "lock-timeout",
  "history-error",
] as const;
export type HealthIncidentKind = (typeof HEALTH_INCIDENT_KINDS)[number];

export interface HealthIncident {
  id: string;
  at: number;
  kind: HealthIncidentKind;
  detail: string;
}

export interface StreakEntry {
  ok: number;
  firstAt: number;
  lastAt: number;
}

export type StreakState = Record<string, StreakEntry>;

export interface HealthSnapshot {
  schemaVersion: 2;
  probeModel: string;
  sweepStartedAt: number | null;
  checkedAt: number;
  results: HealthResult[];
  streaks: StreakState;
  incident?: HealthIncident;
}

export interface Policy {
  provider?: string;
  account?: { email?: string; accountId?: string; projectId?: string };
  reservePct?: number;
  priority?: number;
  [key: string]: unknown;
}

export interface HealthState {
  schemaVersion: 2;
  excluded: string[];
  pending: string[];
}

export interface HealAction {
  changed: string[];
  skipped: string[];
  reason: string;
}

// ── 2. External Wire Schemas & Telemetry ────────────────────────────────────

export interface UsageAmount {
  usedFraction?: number;
  remainingFraction?: number;
  used?: number;
  limit?: number;
  remaining?: number;
  unit?: string;
}

export interface UsageLimit {
  id?: string;
  label?: string;
  window?: { label?: string; resetsAt?: number };
  amount?: UsageAmount;
  status?: string;
  notes?: string[];
  scope?: {
    provider?: string;
    accountId?: string;
    projectId?: string;
    windowId?: string;
    tier?: string;
    shared?: boolean;
  };
}

export interface UsageBalance {
  currency: string;
  total: number;
  granted?: number;
  toppedUp?: number;
  available?: boolean;
}

export interface MonitorHeartbeat {
  at: number;
  hostname: string;
  pid: number;
}

export interface UsageReport {
  provider: string;
  fetchedAt?: number;
  metadata?: {
    email?: string;
    accountId?: string;
    projectId?: string;
    plan?: string;
    balance?: UsageBalance;
  };
  limits?: UsageLimit[];
}

// ── 3. Tabular Presentation & Compilation Models ────────────────────────────

export interface UsageColumn {
  key: string;
  label: string;
}

export interface ProviderRow {
  report: UsageReport;
  account: string;
  health?: HealthResult;
  max: number;
  primary?: number;
  secondary?: number;
}

export interface ProviderSection {
  provider: string;
  reports: UsageReport[];
  columns: UsageColumn[];
  rows: ProviderRow[];
}
