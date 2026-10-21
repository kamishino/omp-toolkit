import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_INTERVAL = 300;

export interface MonitorOptions {
  interval: number;
  health: boolean;
  altScreen: boolean;
  unknown: string[];
}

export function parseMonitorArgs(args: string[]): MonitorOptions {
  const intervalArg = args.find((arg) => arg.startsWith("--interval="));
  const rawInterval = Number(intervalArg?.slice("--interval=".length) ?? DEFAULT_INTERVAL);
  const known = new Set(["--no-health", "--no-alt-screen"]);
  const unknown = args.filter(
    (arg) => arg.startsWith("--") && !arg.startsWith("--interval=") && !known.has(arg),
  );
  return {
    interval: Math.max(10, Number.isFinite(rawInterval) ? rawInterval : DEFAULT_INTERVAL),
    health: !args.includes("--no-health"),
    altScreen: !args.includes("--no-alt-screen"),
    unknown,
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
  agentDir = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".omp", "agent"),
  root = path.resolve(import.meta.dir, ".."),
): string {
  const installed = path.join(agentDir, "scripts", "omp-provider-usage.js");
  const dist = path.resolve(root, "apps/provider-usage/dist/index.js");
  const source = path.resolve(root, "apps/provider-usage/src/index.ts");
  const candidates = [installed, dist, source];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? installed;
}
