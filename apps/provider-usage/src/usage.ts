import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { HealthSnapshot, UsageReport } from "@omp-toolkit/core";

const execFileAsync = promisify(execFile);
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".omp", "agent");
const SNAPSHOT_PATH = path.join(AGENT_DIR, "gemini-health-latest.json");
const EXEC_OPTS = {
  encoding: "utf8" as const,
  timeout: 25_000,
  windowsHide: true,
  maxBuffer: 2 * 1024 * 1024,
};

export async function fetchUsage(): Promise<UsageReport[]> {
  const { stdout } = await execFileAsync(
    process.env.OMP_BIN || "omp",
    ["usage", "--json"],
    EXEC_OPTS,
  );
  const parsed = JSON.parse(String(stdout));
  if (!parsed || !Array.isArray(parsed.reports)) {
    throw new Error("omp usage returned an unexpected payload");
  }
  return parsed.reports as UsageReport[];
}

export function readSnapshot(): HealthSnapshot | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")) as HealthSnapshot;
    if (!parsed || !Array.isArray(parsed.results)) return null;
    const results = parsed.results.filter(
      (result) =>
        !!result &&
        typeof result.email === "string" &&
        typeof result.status === "string" &&
        typeof result.ms === "number",
    );
    return { checkedAt: Number(parsed.checkedAt) || 0, results };
  } catch {
    return null;
  }
}
