import { homedir } from "node:os";
import path from "node:path";

/**
 * Authoritative path and environment resolver for OMP agent configuration,
 * state files, and installed toolkit scripts.
 */

export function resolveAgentDir(
  env: Record<string, string | undefined> = process.env,
  home = homedir(),
): string {
  return env.PI_CODING_AGENT_DIR ?? path.join(home, ".omp", "agent");
}

export function resolveSnapshotPath(env = process.env, home = homedir()): string {
  return path.join(resolveAgentDir(env, home), "gemini-health-latest.json");
}

export function resolveStatePath(env = process.env, home = homedir()): string {
  return path.join(resolveAgentDir(env, home), "gemini-health-state.json");
}

export function resolveStreakPath(env = process.env, home = homedir()): string {
  return path.join(resolveAgentDir(env, home), "gemini-health-streaks.json");
}

export function resolveWidgetStatePath(env = process.env, home = homedir()): string {
  return path.join(resolveAgentDir(env, home), "gemini-health-widget.json");
}

export function resolveHistoryDbPath(env = process.env, home = homedir()): string {
  return (
    env.OMP_TOOLKIT_HISTORY_DB ?? path.join(resolveAgentDir(env, home), "omp-toolkit-history.db")
  );
}

export function resolveMachinePath(env = process.env, home = homedir()): string {
  return path.join(resolveAgentDir(env, home), "omp-toolkit-machine.json");
}

export function resolveInstalledScript(
  scriptName: string,
  env = process.env,
  home = homedir(),
): string {
  return path.join(resolveAgentDir(env, home), "scripts", scriptName);
}

export function resolveMonitorScriptCandidates(
  checkoutRoot: string,
  env = process.env,
  home = homedir(),
): string[] {
  return [
    resolveInstalledScript("omp-provider-usage.js", env, home),
    path.join(checkoutRoot, "apps", "provider-usage", "dist", "index.js"),
    path.join(checkoutRoot, "apps", "provider-usage", "src", "index.ts"),
  ];
}

export function resolveHealthScriptCandidates(
  checkoutRoot: string,
  env = process.env,
  home = homedir(),
): string[] {
  return [
    path.join(checkoutRoot, "apps", "omp-extension", "dist", "index.js"),
    path.join(resolveAgentDir(env, home), "extensions", "gemini-health.js"),
    path.join(checkoutRoot, "apps", "omp-extension", "src", "index.ts"),
  ];
}
