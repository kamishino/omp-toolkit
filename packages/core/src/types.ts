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

export interface Account {
  index: number;
  email: string;
  project: string;
}

export interface ProbeResult extends Account {
  status: Status;
  ms: number;
  detail?: string;
}

export interface HealthResult {
  email: string;
  status: Status;
  ms: number;
  detail?: string;
  checkedAt?: number;
}

export interface HealthSnapshot {
  checkedAt: number;
  results: HealthResult[];
}

export interface Policy {
  provider?: string;
  account?: { email?: string; accountId?: string; projectId?: string };
  reservePct?: number;
  priority?: number;
  [key: string]: unknown;
}

export interface HealthState {
  excluded: string[];
  updatedAt?: string;
}

export interface StreakEntry {
  ok: number;
  lastAt: number;
}

export type StreakState = Record<string, StreakEntry>;

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
}

export interface ProviderSection {
  provider: string;
  reports: UsageReport[];
  columns: UsageColumn[];
  rows: ProviderRow[];
}
