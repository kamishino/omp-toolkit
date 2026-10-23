import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import {
  assembleDashboard,
  DASHBOARD_SCHEMA_VERSION,
  type Dashboard,
  type HealthSnapshot,
  isDashboard,
  resolveSnapshotPath,
  type UsageReport,
} from "@omp-toolkit/core";

const execFileAsync = promisify(execFile);

export interface DataSource {
  bun: string;
  script: string;
  ompBin?: string;
  agentDir?: string;
}

export function readHealthSnapshot(agentDir?: string): HealthSnapshot | null {
  const snapshotFile = resolveSnapshotPath(
    agentDir ? { PI_CODING_AGENT_DIR: agentDir } : process.env,
  );
  try {
    const raw = fs.readFileSync(snapshotFile, "utf8");
    const parsed = JSON.parse(raw) as HealthSnapshot;
    if (parsed && Array.isArray(parsed.results)) return parsed;
    return null;
  } catch {
    return null;
  }
}

export async function fetchRawUsage(
  ompBin = process.env.OMP_BIN || "omp",
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<UsageReport[]> {
  const { stdout } = await execFileAsync(ompBin, ["usage", "--json"], {
    encoding: "utf8",
    timeout: options?.timeoutMs ?? 25_000,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
    signal: options?.signal,
  });
  const parsed = JSON.parse(String(stdout));
  if (!parsed || !Array.isArray(parsed.reports)) {
    throw new Error("omp usage returned an unexpected payload");
  }
  return parsed.reports as UsageReport[];
}
export function parseMonitorPayload(text: string): Dashboard {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("omp-provider-usage returned invalid JSON");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("omp-provider-usage returned an invalid dashboard");
  }

  const payload = parsed as { schemaVersion?: unknown; dashboard?: unknown };
  if (payload.schemaVersion !== DASHBOARD_SCHEMA_VERSION) {
    throw new Error(
      `unsupported monitor schema: ${String(payload.schemaVersion)} (expected ${DASHBOARD_SCHEMA_VERSION})`,
    );
  }

  if (!isDashboard(payload.dashboard)) {
    throw new Error("omp-provider-usage returned an invalid dashboard");
  }

  return payload.dashboard;
}

export async function fetchDashboard(
  source?: DataSource,
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<Dashboard> {
  try {
    const reports = await fetchRawUsage(source?.ompBin, options);
    const snapshot = readHealthSnapshot(source?.agentDir);
    return assembleDashboard(reports, snapshot);
  } catch (directError) {
    if (source?.bun && source?.script && fs.existsSync(source.script)) {
      const { stdout } = await execFileAsync(source.bun, [source.script, "--json", "--health"], {
        encoding: "utf8",
        timeout: options?.timeoutMs ?? 25_000,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
        signal: options?.signal,
      });
      return parseMonitorPayload(String(stdout));
    }
    throw directError;
  }
}
