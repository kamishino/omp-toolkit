import {
  type BalanceAlertThresholds,
  DEFAULT_BALANCE_ALERT,
  type HealthResult,
  sectionsFor,
} from "@omp-toolkit/core";
import { renderProviderUsage } from "@omp-toolkit/tui";
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
  let lastFrame = "";
  let alternateActive = false;

  const clearAlternate = (): void => {
    if (!alternateActive) return;
    alternateActive = false;
    process.stdout.write("\x1b[?25h\x1b[?1049l");
  };

  if (interactive) {
    alternateActive = true;
    process.stdout.write("\x1b[?1049h\x1b[?25l");
  }
  process.on("exit", clearAlternate);
  process.on("SIGINT", () => {
    clearAlternate();
    process.exit(0);
  });

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
    if (interactive) {
      if (frame !== lastFrame) {
        process.stdout.write(`\x1b[H${frame}\x1b[J`);
        lastFrame = frame;
      }
    } else {
      console.log(frame);
      if (watch) console.log();
    }
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
