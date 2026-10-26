import { type DashboardCompileOptions, DashboardEngine } from "./dashboard/engine";
import type { Dashboard } from "./dashboard/types";
import { resolveSnapshotPath } from "./environment";
import type { HealthSnapshot, UsageReport } from "./types";

export function parseRawUsage(stdout: string): UsageReport[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("omp usage returned invalid JSON");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { reports?: unknown }).reports)
  ) {
    throw new Error("omp usage returned an unexpected payload");
  }
  return (parsed as { reports: UsageReport[] }).reports;
}

export function parseHealthSnapshot(rawJson: string): HealthSnapshot | null {
  try {
    const parsed = JSON.parse(rawJson) as HealthSnapshot;
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

export interface UsageDataSourceAdapter {
  execFile(
    file: string,
    args: string[],
    options?: { timeout?: number; windowsHide?: boolean; maxBuffer?: number; signal?: AbortSignal },
  ): Promise<{ stdout: string | Buffer }>;
  readFile(path: string): string;
}

export interface UsageDataSourceOptions {
  ompBin?: string;
  agentDir?: string;
  env?: Record<string, string | undefined>;
}

/**
 * Deep Data Acquisition Coordinator.
 *
 * Implements a pure ports-and-adapters seam for fetching usage and reading health snapshots:
 * - Abstracts child process execution and filesystem access through UsageDataSourceAdapter
 * - Robust JSON parsing and validation
 * - Direct compilation to Dashboard view model via DashboardEngine
 */
export class UsageDataSource {
  constructor(
    private readonly adapter: UsageDataSourceAdapter,
    private readonly options: UsageDataSourceOptions = {},
  ) {}

  async fetchReports(options?: {
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<UsageReport[]> {
    const bin = this.options.ompBin || this.options.env?.OMP_BIN || "omp";
    const res = await this.adapter.execFile(bin, ["usage", "--json"], {
      timeout: options?.timeoutMs ?? 25_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
      signal: options?.signal,
    });
    return parseRawUsage(String(res.stdout));
  }

  readSnapshot(): HealthSnapshot | null {
    const snapshotFile = resolveSnapshotPath(
      this.options.agentDir ? { PI_CODING_AGENT_DIR: this.options.agentDir } : this.options.env,
    );
    try {
      const raw = this.adapter.readFile(snapshotFile);
      return parseHealthSnapshot(raw);
    } catch {
      return null;
    }
  }

  async fetchDashboard(compileOptions?: DashboardCompileOptions): Promise<Dashboard> {
    const [reports, snapshot] = await Promise.all([
      this.fetchReports(),
      Promise.resolve(this.readSnapshot()),
    ]);
    return DashboardEngine.compile(reports, snapshot, compileOptions);
  }
}
