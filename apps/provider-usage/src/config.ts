import { type BalanceAlertThresholds, DEFAULT_BALANCE_ALERT } from "@omp-toolkit/core";

export interface MonitorCliConfig {
  schedule: boolean;
  json: boolean;
  watch: boolean;
  health: boolean;
  interval: number;
  altScreen: boolean;
  balanceAlert: BalanceAlertThresholds;
  unknown: string[];
}

export const DEFAULT_MONITOR_INTERVAL = 300;

export function parseThreshold(envValue: string | undefined, fallback: number): number {
  const value = Number(envValue);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Deep configuration module encapsulating CLI argument parsing,
 * environment variable fallbacks, interval bounding, and flag validation.
 */
export function parseMonitorCliConfig(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): MonitorCliConfig {
  const schedule = argv.includes("--schedule");
  const json = argv.includes("--json");
  const watch = argv.includes("--watch");
  const altScreen = !argv.includes("--no-alt-screen");

  // Health defaults to true if --health passed, or when neither is passed, false if --no-health
  const health = argv.includes("--health")
    ? true
    : argv.includes("--no-health")
      ? false
      : argv.includes("--watch") || argv.includes("-w");

  const intervalArg = argv.find((arg) => arg.startsWith("--interval="));
  const rawInterval = Number(intervalArg?.slice("--interval=".length) ?? DEFAULT_MONITOR_INTERVAL);
  const interval = Math.max(
    10,
    Number.isFinite(rawInterval) ? rawInterval : DEFAULT_MONITOR_INTERVAL,
  );

  const balanceAlert: BalanceAlertThresholds = {
    cny: parseThreshold(env.DEEPSEEK_BALANCE_ALERT_CNY, DEFAULT_BALANCE_ALERT.cny),
    usd: parseThreshold(env.DEEPSEEK_BALANCE_ALERT_USD, DEFAULT_BALANCE_ALERT.usd),
  };

  const knownFlags: Record<string, true> = {
    "--schedule": true,
    "--json": true,
    "--watch": true,
    "-w": true,
    "--health": true,
    "--no-health": true,
    "--no-alt-screen": true,
  };
  const unknown = argv.filter(
    (arg) => arg.startsWith("--") && !arg.startsWith("--interval=") && !knownFlags[arg],
  );

  return {
    schedule,
    json,
    watch,
    health,
    interval,
    altScreen,
    balanceAlert,
    unknown,
  };
}

export function buildCliArgs(config: Partial<MonitorCliConfig>): string[] {
  const args: string[] = [];
  if (config.schedule) args.push("--schedule");
  if (config.json) args.push("--json");
  if (config.watch) args.push("--watch");
  if (config.interval !== undefined) args.push(`--interval=${config.interval}`);
  if (config.health === false) {
    args.push("--no-health");
  } else if (config.health === true) {
    args.push("--health");
  }
  if (config.altScreen === false) args.push("--no-alt-screen");
  return args;
}
