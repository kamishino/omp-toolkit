import fs from "node:fs";
import path from "node:path";
import { logLine } from "./logger";
import { errorLogPathFor } from "./paths";

export interface LaunchFailure {
  at: number;
  message: string;
}

export function launchFailurePath(agentDir: string): string {
  return path.join(agentDir, "desktop-launch-failure.json");
}

/**
 * Persist a launcher-side failure (build, Electron lookup, spawn) so a
 * detached, console-less launch never fails silently: append to the shared
 * error log and drop a one-shot marker the next successful start surfaces.
 * Never throws — failure recording must not mask the original error.
 */
export function recordLaunchFailure(agentDir: string, error: unknown, now = Date.now()): void {
  const message = error instanceof Error ? error.message : String(error);
  try {
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      launchFailurePath(agentDir),
      `${JSON.stringify({ at: now, message } satisfies LaunchFailure)}\n`,
      "utf8",
    );
  } catch {
    // best effort
  }
  logLine(
    `[${new Date(now).toISOString()}] LAUNCH FAILED: ${message}\n`,
    errorLogPathFor(agentDir),
  );
}

/** Read and clear the pending launch-failure marker, if any. */
export function consumeLaunchFailure(agentDir: string): LaunchFailure | null {
  const file = launchFailurePath(agentDir);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  try {
    fs.unlinkSync(file);
  } catch {
    // best effort
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as LaunchFailure).at === "number" &&
      typeof (parsed as LaunchFailure).message === "string"
    ) {
      return parsed as LaunchFailure;
    }
  } catch {
    // corrupt marker: cleared above, nothing to surface
  }
  return null;
}
