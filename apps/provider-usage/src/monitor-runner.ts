import {
  DashboardEngine,
  getAllTimeWindowPolicies,
  type HealthSnapshot,
  type UsageReport,
} from "@omp-toolkit/core";
import { renderProviderUsage, renderScheduleView } from "@omp-toolkit/tui";
import { type MonitorCliConfig, useAlternateScreen } from "./config";
import { writeHeartbeat } from "./heartbeat";
import { InteractiveMonitor } from "./interactive-monitor";
import { jsonPayload } from "./json";
import { fetchUsage, readSnapshot } from "./usage";

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export interface MonitorRunnerDependencies {
  fetchReports?: () => Promise<UsageReport[]>;
  readSnapshotFn?: () => HealthSnapshot | null;
  writeHeartbeatFn?: () => void;
  outputFn?: (text: string) => void;
  errorFn?: (error: string) => void;
  isTTY?: boolean;
}

/**
 * Deep Coordinator for Provider Usage Monitor Execution.
 *
 * Encapsulates:
 * - Execution mode determination (schedule, interactive TUI, batch text, JSON stream)
 * - Coordinated data acquisition, heartbeat tracking, and snapshot resolution
 * - Unified polling loop with error handling for headless and terminal watch runs
 */
export class MonitorRunner {
  private readonly fetchReports: () => Promise<UsageReport[]>;
  private readonly readSnapshotFn: () => HealthSnapshot | null;
  private readonly writeHeartbeatFn: () => void;
  private readonly outputFn: (text: string) => void;
  private readonly errorFn: (error: string) => void;
  private readonly isTTY: boolean;

  constructor(deps: MonitorRunnerDependencies = {}) {
    this.fetchReports = deps.fetchReports ?? fetchUsage;
    this.readSnapshotFn = deps.readSnapshotFn ?? readSnapshot;
    this.writeHeartbeatFn = deps.writeHeartbeatFn ?? writeHeartbeat;
    this.outputFn = deps.outputFn ?? ((text) => console.log(text));
    this.errorFn = deps.errorFn ?? ((err) => console.error(err));
    this.isTTY = deps.isTTY ?? process.stdout.isTTY === true;
  }

  async executeCycle(config: MonitorCliConfig): Promise<{ output: string }> {
    const reports = await this.fetchReports();
    try {
      this.writeHeartbeatFn();
    } catch {
      // Monitor stays usable even if heartbeat write fails
    }

    const snapshot = config.health ? this.readSnapshotFn() : null;
    const dashboard = DashboardEngine.compile(reports, snapshot, {
      showHealth: config.health,
      balanceAlert: config.balanceAlert,
    });

    if (config.json) {
      const payload = jsonPayload(dashboard, {
        fetchedAt: dashboard.fetchedAt,
        showHealth: config.health,
        snapshot,
        balanceAlert: config.balanceAlert,
      });
      return { output: JSON.stringify(payload, null, 2) };
    }

    const frame = renderProviderUsage(dashboard, {
      interval: config.interval,
      watch: config.watch,
      showHealth: config.health,
      checkedAt: snapshot?.checkedAt,
      balanceAlert: config.balanceAlert,
    });
    return { output: frame };
  }

  async run(config: MonitorCliConfig): Promise<void> {
    if (config.schedule) {
      const policies = getAllTimeWindowPolicies();
      this.outputFn(renderScheduleView(policies));
      return;
    }

    const interactive = useAlternateScreen({
      watch: config.watch,
      isTTY: this.isTTY,
      json: config.json,
      term: process.env.TERM,
      noAltScreen: !config.altScreen,
    });

    if (interactive) {
      const monitor = new InteractiveMonitor({ config });
      await monitor.start();
      return;
    }

    // Run first cycle
    const first = await this.executeCycle(config);
    this.outputFn(first.output);

    if (!config.watch) return;
    if (!config.json) this.outputFn("");

    // Watch loop for headless/non-interactive mode
    for (;;) {
      await sleep(config.interval * 1000);
      try {
        const cycle = await this.executeCycle(config);
        this.outputFn(cycle.output);
        if (!config.json) this.outputFn("");
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.errorFn(`OMP Provider Usage: ${msg}`);
      }
    }
  }
}
