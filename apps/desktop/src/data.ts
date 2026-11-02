import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import { DASHBOARD_SCHEMA_VERSION, type Dashboard, isDashboard } from "@omp-toolkit/core";

const execFileAsync = promisify(execFile);

export interface DataSource {
  bun: string;
  script: string;
  ompBin?: string;
  agentDir?: string;
}

export type MonitorExecFn = (
  file: string,
  args: string[],
  options?: {
    timeoutMs?: number;
    signal?: AbortSignal;
    env?: Record<string, string>;
  },
) => Promise<{ stdout: string }>;

const defaultExec: MonitorExecFn = async (file, args, options) => {
  const { stdout } = await execFileAsync(file, args, {
    encoding: "utf8",
    timeout: options?.timeoutMs ?? 25_000,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
    signal: options?.signal,
    env: options?.env ? { ...process.env, ...options.env } : process.env,
  });
  return { stdout: String(stdout) };
};

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

/**
 * Single data seam (ADR-0005): the installed monitor CLI owns dashboard
 * production — usage fetch, pacing, compile — and this module only runs it
 * (`--json --health`, schema-2) and validates the payload. Balance-alert
 * thresholds cross the seam as env, where the CLI config reads them.
 */
export async function fetchDashboard(
  source?: DataSource,
  options?: {
    timeoutMs?: number;
    signal?: AbortSignal;
    balanceAlert?: { cny: number; usd: number };
  },
  deps: { execFn?: MonitorExecFn } = {},
): Promise<Dashboard> {
  if (!source?.bun || !source?.script || !fs.existsSync(source.script)) {
    throw new Error('Monitor script not found. Run "bun run install:omp".');
  }

  const env: Record<string, string> = {};
  if (options?.balanceAlert) {
    env.DEEPSEEK_BALANCE_ALERT_CNY = String(options.balanceAlert.cny);
    env.DEEPSEEK_BALANCE_ALERT_USD = String(options.balanceAlert.usd);
  }

  const exec = deps.execFn ?? defaultExec;
  const { stdout } = await exec(source.bun, [source.script, "--json", "--health"], {
    timeoutMs: options?.timeoutMs,
    signal: options?.signal,
    env: Object.keys(env).length > 0 ? env : undefined,
  });
  return parseMonitorPayload(stdout);
}
