import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveAgentDir,
  resolveHealthScriptCandidates,
  resolveMonitorScriptCandidates,
} from "@omp-toolkit/core";
import which from "which";

function isRegularFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export interface PanelPaths {
  distDir: string;
  preload: string;
  html: string;
}

export function panelPaths(appPath: string): PanelPaths {
  const distDir = path.join(appPath, "dist");
  return {
    distDir,
    preload: path.join(distDir, "preload.cjs"),
    html: path.join(distDir, "index.html"),
  };
}

export function agentDir(env = process.env, home = os.homedir()): string {
  return resolveAgentDir(env, home);
}

export function findBun(
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
): string | null {
  if (env.BUN_BIN) {
    return env.BUN_BIN;
  }

  try {
    const found = which.sync("bun", {
      nothrow: true,
      path: env.PATH,
      pathExt: env.PATHEXT,
    });
    if (found) {
      return found;
    }
  } catch {
    // ignore and fall through to fallback
  }

  const fallback = path.join(home, ".bun", "bin", platform === "win32" ? "bun.exe" : "bun");
  if (isRegularFile(fallback)) {
    return fallback;
  }

  return null;
}

export function resolveMonitorScript(
  env = process.env,
  checkoutRoot: string,
  home = os.homedir(),
): string | null {
  return resolveMonitorScriptCandidates(checkoutRoot, env, home).find(isRegularFile) ?? null;
}

export function resolveHealthScript(
  env = process.env,
  checkoutRoot: string,
  home = os.homedir(),
): string | null {
  return resolveHealthScriptCandidates(checkoutRoot, env, home).find(isRegularFile) ?? null;
}

export function resolveCheckout(
  env = process.env,
  checkoutRoot: string,
  home = os.homedir(),
): string | null {
  const candidates = [
    env.OMP_TOOLKIT_HOME,
    path.join(home, ".omp", "omp-toolkit"),
    checkoutRoot,
  ].filter((p): p is string => Boolean(p && p.trim().length > 0));

  for (const candidate of candidates) {
    const probe = path.join(candidate, "scripts", "orca-monitor.ts");
    if (isRegularFile(probe)) {
      return path.resolve(candidate);
    }
  }

  return null;
}

export function errorLogPath(env = process.env, home = os.homedir()): string {
  return path.join(agentDir(env, home), "desktop-widget-error.log");
}
