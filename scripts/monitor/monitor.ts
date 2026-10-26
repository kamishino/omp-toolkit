import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_MONITOR_INTERVAL,
  parseMonitorCliConfig,
} from "../../apps/provider-usage/src/config";
import { resolveMonitorScriptCandidates } from "../../packages/core/src/environment";

export const DEFAULT_INTERVAL = DEFAULT_MONITOR_INTERVAL;
export const USAGE =
  "usage: bun run monitor [--interval=<seconds>] [--no-health] [--no-alt-screen]";

export interface MonitorOptions {
  interval: number;
  health: boolean;
  altScreen: boolean;
  unknown: string[];
}

export function parseMonitorArgs(args: string[]): MonitorOptions {
  const config = parseMonitorCliConfig(args);
  return {
    interval: config.interval,
    health: !args.includes("--no-health"),
    altScreen: config.altScreen,
    unknown: config.unknown,
  };
}

export function monitorCommandArgs(script: string, options: MonitorOptions): string[] {
  return [
    script,
    "--watch",
    `--interval=${options.interval}`,
    ...(options.health ? ["--health"] : []),
    ...(options.altScreen ? [] : ["--no-alt-screen"]),
  ];
}

export function resolveMonitorScript(
  agentDir?: string,
  root = path.resolve(import.meta.dir, "../.."),
): string {
  const env = agentDir ? { PI_CODING_AGENT_DIR: agentDir } : process.env;
  const candidates = resolveMonitorScriptCandidates(root, env);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

export function runMonitor(argv: string[] = process.argv.slice(2)): void {
  const options = parseMonitorArgs(argv);
  if (options.unknown.length > 0) {
    console.error(`unknown option: ${options.unknown.join(", ")}`);
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  const script = resolveMonitorScript();
  const child = spawn(process.execPath, monitorCommandArgs(script, options), {
    stdio: "inherit",
    env: process.env,
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }

  child.on("error", (error) => {
    console.error(`monitor: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}

if (import.meta.main) {
  runMonitor();
}
