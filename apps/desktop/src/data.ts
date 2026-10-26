import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import {
  DASHBOARD_SCHEMA_VERSION,
  type Dashboard,
  DashboardEngine,
  type HealthSnapshot,
  isDashboard,
  UsageDataSource,
  type UsageDataSourceAdapter,
  type UsageReport,
} from "@omp-toolkit/core";

const execFileAsync = promisify(execFile);

export interface DataSource {
  bun: string;
  script: string;
  ompBin?: string;
  agentDir?: string;
}

const desktopAdapter: UsageDataSourceAdapter = {
  execFile: async (file, args, options) => {
    return execFileAsync(file, args, {
      encoding: "utf8",
      timeout: options?.timeout,
      windowsHide: options?.windowsHide,
      maxBuffer: options?.maxBuffer,
      signal: options?.signal,
    });
  },
  readFile: (path) => fs.readFileSync(path, "utf8"),
};

export function readHealthSnapshot(agentDir?: string): HealthSnapshot | null {
  const source = new UsageDataSource(desktopAdapter, { agentDir });
  return source.readSnapshot();
}

export async function fetchRawUsage(
  ompBin = process.env.OMP_BIN || "omp",
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<UsageReport[]> {
  const source = new UsageDataSource(desktopAdapter, { ompBin });
  return source.fetchReports(options);
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
    return DashboardEngine.compile(reports, snapshot);
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
