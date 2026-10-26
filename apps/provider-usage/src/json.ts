import {
  type BalanceAlertThresholds,
  DASHBOARD_SCHEMA_VERSION,
  type Dashboard,
  type HealthSnapshot,
} from "@omp-toolkit/core";

export interface MonitorJsonPayload {
  schemaVersion: 2;
  fetchedAt: number;
  dashboard: Dashboard;
  snapshot?: HealthSnapshot | null;
}

export interface JsonOptions {
  fetchedAt: number;
  showHealth: boolean;
  snapshot: HealthSnapshot | null;
  balanceAlert: BalanceAlertThresholds;
}

export function jsonPayload(dashboard: Dashboard, options: JsonOptions): MonitorJsonPayload {
  return {
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    fetchedAt: options.fetchedAt,
    dashboard,
    ...(options.showHealth ? { snapshot: options.snapshot } : {}),
  };
}
