import { type DashboardCompileOptions, DashboardEngine } from "./dashboard/engine";
import type { Dashboard } from "./dashboard/types";
import { resolveSnapshotPath } from "./environment";
import {
  HEALTH_INCIDENT_KINDS,
  type HealthIncident,
  type HealthResult,
  type HealthSnapshot,
  isRouteFailureKind,
  isStatus,
  type StreakEntry,
  type StreakState,
  type UsageReport,
} from "./types";
import { filterActiveReports } from "./usage";

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
    const parsed = JSON.parse(rawJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const snap = parsed as Partial<HealthSnapshot>;
    if (snap.schemaVersion !== 2) return null;
    if (typeof snap.probeModel !== "string" || snap.probeModel.trim().length === 0) return null;
    if (
      typeof snap.checkedAt !== "number" ||
      !Number.isFinite(snap.checkedAt) ||
      snap.checkedAt < 0
    ) {
      return null;
    }
    if (
      snap.sweepStartedAt !== null &&
      snap.sweepStartedAt !== undefined &&
      (typeof snap.sweepStartedAt !== "number" ||
        !Number.isFinite(snap.sweepStartedAt) ||
        snap.sweepStartedAt < 0)
    ) {
      return null;
    }
    if (!snap.streaks || typeof snap.streaks !== "object" || Array.isArray(snap.streaks))
      return null;
    if (!Array.isArray(snap.results)) return null;

    const validResults: HealthResult[] = [];
    for (const item of snap.results) {
      if (!item || typeof item !== "object") continue;
      const r = item as Partial<HealthResult>;
      if (r.provider !== "google-antigravity") continue;
      if (typeof r.email !== "string" || r.email.trim().length === 0) continue;
      if (typeof r.project !== "string" || r.project.length === 0) continue;
      if (typeof r.model !== "string" || r.model.length === 0) continue;
      if (!isStatus(r.status)) continue;
      if (typeof r.ms !== "number" || !Number.isFinite(r.ms) || r.ms < 0) continue;
      if (typeof r.startedAt !== "number" || !Number.isFinite(r.startedAt) || r.startedAt < 0)
        continue;
      if (typeof r.checkedAt !== "number" || !Number.isFinite(r.checkedAt) || r.checkedAt < 0)
        continue;
      if (r.startedAt > r.checkedAt) continue;
      if (typeof r.confirmed !== "boolean") continue;
      if (r.detail !== undefined && typeof r.detail !== "string") continue;

      // Validate consistent outcome / failureKind combinations
      if (r.status === "ok") {
        if (r.failureKind !== null && r.failureKind !== undefined) continue;
      } else {
        if (!r.failureKind || !isRouteFailureKind(r.failureKind)) continue;
        if (r.status === "hang" && r.failureKind !== "timeout") continue;
        if (r.status === "auth" && r.failureKind !== "auth" && r.failureKind !== "credential")
          continue;
        if (r.status === "model-error" && r.failureKind !== "model") continue;
        if (
          r.status === "error" &&
          !["rate-limit", "transient", "network", "protocol"].includes(r.failureKind)
        ) {
          continue;
        }
      }

      validResults.push({
        provider: "google-antigravity",
        email: r.email,
        project: r.project,
        model: r.model,
        status: r.status,
        ms: r.ms,
        startedAt: r.startedAt,
        checkedAt: r.checkedAt,
        failureKind: r.status === "ok" ? null : (r.failureKind ?? null),
        confirmed: r.confirmed,
        ...(r.detail !== undefined ? { detail: r.detail } : {}),
      });
    }

    const validStreaks: StreakState = {};
    for (const [key, val] of Object.entries(snap.streaks)) {
      if (!val || typeof val !== "object") continue;
      const entry = val as Partial<StreakEntry>;
      if (
        typeof entry.ok !== "number" ||
        !Number.isInteger(entry.ok) ||
        entry.ok < 0 ||
        typeof entry.firstAt !== "number" ||
        !Number.isFinite(entry.firstAt) ||
        entry.firstAt < 0 ||
        typeof entry.lastAt !== "number" ||
        !Number.isFinite(entry.lastAt) ||
        entry.lastAt < 0
      ) {
        continue;
      }
      if (entry.ok > 0 && entry.firstAt > entry.lastAt) {
        continue;
      }
      validStreaks[key] = {
        ok: entry.ok,
        firstAt: entry.firstAt,
        lastAt: entry.lastAt,
      };
    }

    let incident: HealthIncident | undefined;
    if (snap.incident && typeof snap.incident === "object") {
      const inc = snap.incident as Partial<HealthIncident>;
      if (
        typeof inc.id === "string" &&
        inc.id.length > 0 &&
        typeof inc.at === "number" &&
        Number.isFinite(inc.at) &&
        inc.at >= 0 &&
        typeof inc.kind === "string" &&
        (HEALTH_INCIDENT_KINDS as readonly string[]).includes(inc.kind) &&
        typeof inc.detail === "string"
      ) {
        incident = {
          id: inc.id,
          at: inc.at,
          kind: inc.kind as HealthIncident["kind"],
          detail: inc.detail,
        };
      }
    }

    const maxCheckedAt = validResults.reduce((max, r) => Math.max(max, r.checkedAt), 0);

    return {
      schemaVersion: 2,
      probeModel: snap.probeModel,
      sweepStartedAt: snap.sweepStartedAt ?? null,
      checkedAt: maxCheckedAt,
      results: validResults,
      streaks: validStreaks,
      ...(incident ? { incident } : {}),
    };
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

export function parseAuthenticatedProviders(stdout: string): ReadonlySet<string> {
  const parsed: unknown = JSON.parse(stdout);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("accounts" in parsed) ||
    !Array.isArray(parsed.accounts)
  ) {
    throw new Error("omp usage accounts returned an unexpected payload");
  }
  const providers = new Set<string>();
  for (const entry of parsed.accounts) {
    if (!entry || typeof entry !== "object" || !("provider" in entry)) continue;
    const provider = entry.provider;
    if (typeof provider === "string" && provider.length > 0) providers.add(provider);
  }
  return providers;
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

  /**
   * Providers with a live credential on this machine; `undefined` when the
   * lookup fails so callers prune only cached ("carried") reports.
   */
  async fetchAuthenticatedProviders(options?: {
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<ReadonlySet<string> | undefined> {
    try {
      const bin = this.options.ompBin || this.options.env?.OMP_BIN || "omp";
      const res = await this.adapter.execFile(bin, ["usage", "accounts", "--json"], {
        timeout: options?.timeoutMs ?? 25_000,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
        signal: options?.signal,
      });
      return parseAuthenticatedProviders(String(res.stdout));
    } catch {
      return undefined;
    }
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
    const [reports, snapshot, authenticated] = await Promise.all([
      this.fetchReports(),
      Promise.resolve(this.readSnapshot()),
      this.fetchAuthenticatedProviders(),
    ]);
    return DashboardEngine.compile(
      filterActiveReports(reports, authenticated),
      snapshot,
      compileOptions,
    );
  }
}
