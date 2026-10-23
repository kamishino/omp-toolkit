import {
  type BalanceAlertThresholds,
  buildDashboard,
  DEFAULT_BALANCE_ALERT,
  getAllTimeWindowPolicies,
  type HealthResult,
  type HealthSnapshot,
  type ProviderSection,
  sectionsFor,
} from "@omp-toolkit/core";
import {
  createStdoutBackend,
  createTerminal,
  drawProviderUsage,
  drawScheduleView,
  HEALTH_THRESHOLDS,
  renderProviderUsage,
  renderScheduleView,
  terminalDraw,
  USAGE_THRESHOLDS,
} from "@omp-toolkit/tui";
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
  if (process.argv.includes("--schedule")) {
    const policies = getAllTimeWindowPolicies();
    console.log(renderScheduleView(policies));
    return;
  }

  const json = process.argv.includes("--json");
  const watch = process.argv.includes("--watch");
  const showHealth = process.argv.includes("--health");
  const intervalArg = process.argv.find((arg) => arg.startsWith("--interval="));
  const interval = Math.max(10, Number(intervalArg?.slice("--interval=".length) ?? 300) || 300);
  function threshold(name: string, fallback: number): number {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  const balanceAlert: BalanceAlertThresholds = {
    cny: threshold("DEEPSEEK_BALANCE_ALERT_CNY", DEFAULT_BALANCE_ALERT.cny),
    usd: threshold("DEEPSEEK_BALANCE_ALERT_USD", DEFAULT_BALANCE_ALERT.usd),
  };

  const interactive = useAlternateScreen({
    watch,
    isTTY: process.stdout.isTTY === true,
    json,
    term: process.env.TERM,
    noAltScreen: process.argv.includes("--no-alt-screen"),
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

    let currentSections: ProviderSection[] = [];
    let currentSnapshot: HealthSnapshot | null = null;

    const drawCurrent = (): void => {
      terminalDraw(terminal, (frame) => {
        if (activeView === "schedule") {
          const policies = getAllTimeWindowPolicies();
          drawScheduleView(frame, policies);
        } else {
          const now = Date.now();
          const dashboard = buildDashboard(currentSections, {
            fetchedAt: now,
            now,
            showHealth,
            checkedAt: currentSnapshot?.checkedAt,
            thresholds: USAGE_THRESHOLDS,
            staleMinutes: HEALTH_THRESHOLDS.staleSnapshotMinutes,
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
      const reports = await fetchUsage();
      try {
        writeHeartbeat();
      } catch {
        // The monitor stays usable; the report shows a stale heartbeat.
      }
      currentSnapshot = showHealth ? readSnapshot() : null;
      const health = new Map<string, HealthResult>(
        (currentSnapshot?.results ?? []).map((result) => [result.email, result]),
      );
      currentSections = sectionsFor(reports, health);
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
