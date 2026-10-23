import fs from "node:fs";
import path from "node:path";
import { DEFAULT_MONITOR_INTERVAL, parseMonitorCliConfig } from "../apps/provider-usage/src/config";
import { resolveMonitorScriptCandidates } from "../packages/core/src/environment";

export const DEFAULT_INTERVAL = DEFAULT_MONITOR_INTERVAL;

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
  root = path.resolve(import.meta.dir, ".."),
): string {
  const env = agentDir ? { PI_CODING_AGENT_DIR: agentDir } : process.env;
  const candidates = resolveMonitorScriptCandidates(root, env);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}
