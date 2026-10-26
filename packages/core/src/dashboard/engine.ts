import type { HealthSnapshot, UsageReport } from "../types";
import { assembleDashboard } from "./builder";
import type { AssembleDashboardOptions, Dashboard } from "./types";

export interface DashboardCompileOptions extends AssembleDashboardOptions {}

/**
 * Unified Domain Dashboard Engine.
 *
 * Encapsulates the entire multi-stage pipeline:
 * - Provider report grouping
 * - Dynamic column resolution & window ordering
 * - Health status severity sorting
 * - Time-window pricing policy evaluation
 * - DeepSeek currency balance extraction
 * - Header tooltip formatting and overall severity ranking
 *
 * Callers provide raw UsageReport[] and HealthSnapshot inputs and
 * receive a fully hydrated, validated Dashboard view model in one step.
 */
export class DashboardEngine {
  constructor(private readonly defaults: DashboardCompileOptions = {}) {}

  compile(
    reports: UsageReport[],
    snapshot?: HealthSnapshot | null,
    options?: DashboardCompileOptions,
  ): Dashboard {
    return assembleDashboard(reports, snapshot, { ...this.defaults, ...options });
  }

  static compile(
    reports: UsageReport[],
    snapshot?: HealthSnapshot | null,
    options?: DashboardCompileOptions,
  ): Dashboard {
    return assembleDashboard(reports, snapshot, options);
  }
}
