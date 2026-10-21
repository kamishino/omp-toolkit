import {
  type BalanceAlertThresholds,
  buildDashboard,
  DASHBOARD_SCHEMA_VERSION,
  type Dashboard,
  type HealthSnapshot,
  type ProviderSection,
} from "@omp-toolkit/core";
import { HEALTH_THRESHOLDS, USAGE_THRESHOLDS } from "@omp-toolkit/tui";

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

export function jsonPayload(sections: ProviderSection[], options: JsonOptions): MonitorJsonPayload {
  const dashboard = buildDashboard(sections, {
    fetchedAt: options.fetchedAt,
    now: options.fetchedAt,
    showHealth: options.showHealth,
    checkedAt: options.snapshot?.checkedAt,
    thresholds: {
      warm: USAGE_THRESHOLDS.warm,
      hot: USAGE_THRESHOLDS.hot,
      critical: USAGE_THRESHOLDS.critical,
      above: USAGE_THRESHOLDS.above,
    },
    staleMinutes: HEALTH_THRESHOLDS.staleSnapshotMinutes,
    balanceAlert: options.balanceAlert,
  });

  return {
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    fetchedAt: options.fetchedAt,
    dashboard,
    ...(options.showHealth ? { snapshot: options.snapshot } : {}),
  };
}
