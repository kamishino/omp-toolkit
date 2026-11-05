import {
  type AccountSortOrder,
  type BalanceAlertThresholds,
  DEFAULT_ACCOUNT_SORT_ORDER,
  DEFAULT_BALANCE_ALERT,
} from "@omp-toolkit/core";

export interface MonitorCliConfig {
  schedule: boolean;
  json: boolean;
  watch: boolean;
  health: boolean;
  interval: number;
  altScreen: boolean;
  balanceAlert: BalanceAlertThresholds;
  accountSort: AccountSortOrder;
  unknown: string[];
}

export const DEFAULT_MONITOR_INTERVAL = 300;

export interface AlternateScreenOptions {
  watch: boolean;
  isTTY: boolean;
  json: boolean;
  noAltScreen: boolean;
  term?: string;
}

export function useAlternateScreen(options: AlternateScreenOptions): boolean {
  return (
    options.watch &&
    options.isTTY &&
    !options.json &&
    !options.noAltScreen &&
    options.term !== "dumb"
  );
}

export function parseThreshold(envValue: string | undefined, fallback: number): number {
  const value = Number(envValue);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Maps `--sort`/`OMP_ACCOUNT_SORT` values (aliases allowed) to a sort order. */
export function parseAccountSort(raw: string | undefined): AccountSortOrder {
  switch (raw?.trim().toLowerCase()) {
    case "weekly-usage":
    case "usage":
      return "weekly-usage";
    default:
      return DEFAULT_ACCOUNT_SORT_ORDER;
  }
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

  const sortArg = argv.find((arg) => arg.startsWith("--sort="));
  const accountSort = parseAccountSort(sortArg?.slice("--sort=".length) ?? env.OMP_ACCOUNT_SORT);

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
    (arg) =>
      arg.startsWith("--") &&
      !arg.startsWith("--interval=") &&
      !arg.startsWith("--sort=") &&
      !knownFlags[arg],
  );

  return {
    schedule,
    json,
    watch,
    health,
    interval,
    altScreen,
    balanceAlert,
    accountSort,
    unknown,
  };
}
