import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DASHBOARD_SCHEMA_VERSION, type Dashboard, isDashboard } from "@omp-toolkit/core";

const execFileAsync = promisify(execFile);

export interface DataSource {
  bun: string;
  script: string;
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
  source: DataSource,
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<Dashboard> {
  try {
    const { stdout } = await execFileAsync(source.bun, [source.script, "--json", "--health"], {
      encoding: "utf8",
      timeout: options?.timeoutMs ?? 25_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
      signal: options?.signal,
    });

    return parseMonitorPayload(String(stdout));
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "killed" in error &&
      (error as { killed?: boolean }).killed
    ) {
      throw new Error("omp-provider-usage timed out after 25s");
    }

    const stderr = (error as { stderr?: string })?.stderr?.trim();
    if (stderr) {
      throw new Error(stderr);
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error(String(error));
  }
}
