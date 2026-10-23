import {
  assembleDashboard,
  getAllTimeWindowPolicies,
  type HealthResult,
  type HealthSnapshot,
  sectionsFor,
  type UsageReport,
} from "@omp-toolkit/core";
import {
  createStdoutBackend,
  createTerminal,
  drawProviderUsage,
  drawScheduleView,
  renderProviderUsage,
  renderScheduleView,
  terminalDraw,
} from "@omp-toolkit/tui";
import { parseMonitorCliConfig } from "./config";
import { writeHeartbeat } from "./heartbeat";
import { jsonPayload } from "./json";
import { useAlternateScreen } from "./terminal";
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
    const backend = createStdoutBackend(process.stdout);
    const terminal = createTerminal(backend);
    let activeView: "usage" | "schedule" = "usage";
    let alternateActive = true;
    let rawModeActive = false;

    const cleanup = (): void => {
      if (!alternateActive) return;
      alternateActive = false;
      if (rawModeActive && typeof process.stdin.setRawMode === "function") {
        try {
          process.stdin.setRawMode(false);
          process.stdin.pause();
        } catch {
          // ignore
        }
      }
      backend.showCursor();
      process.stdout.write("\x1b[?1049l");
    };

    process.on("exit", cleanup);
    process.on("SIGINT", () => {
      cleanup();
      process.exit(0);
    });

    process.stdout.write("\x1b[?1049h");
    backend.hideCursor();

    let triggerRefresh: (() => void) | null = null;

    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
      try {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        rawModeActive = true;
        process.stdin.on("data", (chunk: Buffer) => {
          const str = chunk.toString("utf8");
          if (str === "q" || str === "\u0003") {
            cleanup();
            process.exit(0);
          } else if (str === "r") {
            triggerRefresh?.();
          } else if (str === "s" || str === "\t") {
            activeView = activeView === "usage" ? "schedule" : "usage";
            drawCurrent();
          }
        });
      } catch {
        // ignore
      }
    }

    let currentReports: UsageReport[] = [];
    let currentSnapshot: HealthSnapshot | null = null;

    const drawCurrent = (): void => {
      terminalDraw(terminal, (frame) => {
        if (activeView === "schedule") {
          const policies = getAllTimeWindowPolicies();
          drawScheduleView(frame, policies);
        } else {
          const now = Date.now();
          const dashboard = assembleDashboard(currentReports, currentSnapshot, {
            now,
            showHealth,
            balanceAlert,
          });
          drawProviderUsage(frame, dashboard, {
            interval,
            watch,
            showHealth,
            checkedAt: currentSnapshot?.checkedAt,
            balanceAlert,
          });
        }
      });
    };

    const refresh = async (): Promise<void> => {
      currentReports = await fetchUsage();
      try {
        writeHeartbeat();
      } catch {
        // The monitor stays usable; the report shows a stale heartbeat.
      }
      currentSnapshot = showHealth ? readSnapshot() : null;
      drawCurrent();
    };

    triggerRefresh = () => {
      void refresh();
    };

    await refresh();

    for (;;) {
      await sleep(interval * 1000);
      try {
        await refresh();
      } catch (error) {
        console.error(
          `OMP Provider Usage: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
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
    const health = new Map<string, HealthResult>(
      (snapshot?.results ?? []).map((result) => [result.email, result]),
    );
    const sections = sectionsFor(reports, health);

    if (json) {
      const fetchedAt = Date.now();
      console.log(
        JSON.stringify(
          jsonPayload(sections, { fetchedAt, showHealth, snapshot, balanceAlert }),
          null,
          2,
        ),
      );
      return;
    }

    const frame = renderProviderUsage(sections, {
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
