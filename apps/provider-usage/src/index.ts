import { DashboardEngine, getAllTimeWindowPolicies } from "@omp-toolkit/core";
import { renderProviderUsage, renderScheduleView } from "@omp-toolkit/tui";
import { parseMonitorCliConfig, useAlternateScreen } from "./config";
import { writeHeartbeat } from "./heartbeat";
import { InteractiveMonitor } from "./interactive-monitor";
import { jsonPayload } from "./json";
import { fetchUsage, readSnapshot } from "./usage";

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function main(): Promise<void> {
  const config = parseMonitorCliConfig();
  if (config.schedule) {
    const policies = getAllTimeWindowPolicies();
    console.log(renderScheduleView(policies));
    return;
  }

  const { json, watch, health: showHealth, interval, balanceAlert } = config;

  const interactive = useAlternateScreen({
    watch,
    isTTY: process.stdout.isTTY === true,
    json,
    term: process.env.TERM,
    noAltScreen: !config.altScreen,
  });
  if (interactive) {
    const monitor = new InteractiveMonitor({ config });
    await monitor.start();
    return;
  }

  // Non-interactive / headless fallback
  const runOnce = async (): Promise<void> => {
    const reports = await fetchUsage();
    try {
      writeHeartbeat();
    } catch {
      // The monitor stays usable; the report shows a stale heartbeat.
    }
    const snapshot = showHealth ? readSnapshot() : null;
    const dashboard = DashboardEngine.compile(reports, snapshot, {
      showHealth,
      balanceAlert,
    });
    if (json) {
      console.log(
        JSON.stringify(
          jsonPayload(dashboard, {
            fetchedAt: dashboard.fetchedAt,
            showHealth,
            snapshot,
            balanceAlert,
          }),
          null,
          2,
        ),
      );
      return;
    }

    const frame = renderProviderUsage(dashboard, {
      interval,
      watch,
      showHealth,
      checkedAt: snapshot?.checkedAt,
      balanceAlert,
    });
    console.log(frame);
    if (watch) console.log();
  };

  if (!watch) {
    await runOnce();
    return;
  }

  for (;;) {
    try {
      await runOnce();
    } catch (error) {
      console.error(
        `OMP Provider Usage: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await sleep(interval * 1000);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
