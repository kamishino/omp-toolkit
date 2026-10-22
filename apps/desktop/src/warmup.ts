import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isWarmUpReport, type WarmUpReport, type WarmUpRequest } from "@omp-toolkit/core";
import type { DataSource } from "./data";

const execFileAsync = promisify(execFile);

export function parseWarmUpReport(text: string): WarmUpReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("warmup returned invalid JSON");
  }

  if (!isWarmUpReport(parsed)) {
    throw new Error("warmup returned an invalid report");
  }

  return parsed;
}

export function summarizeWarmUp(report: WarmUpReport): string {
  const verb = report.action === "warm" ? "Warmed" : "Checked";
  const resultCount = report.results.length;

  if (report.action === "check" && resultCount > 0) {
    const res = report.results[0];
    return `Checked ${res.account.split("@")[0]}: ${res.status.toUpperCase()} (${res.ms}ms)`;
  }

  const parts = [`${verb} ${resultCount} account(s)`];

  const nonOk = report.skipped.filter((s) => s.reason === "non-ok").length;
  const cooldown = report.skipped.filter((s) => s.reason === "cooldown").length;

  const skipDetails: string[] = [];
  if (nonOk > 0) skipDetails.push(`${nonOk} non-OK`);
  if (cooldown > 0) skipDetails.push(`${cooldown} cooldown`);

  if (skipDetails.length > 0) {
    parts.push(`skipped ${skipDetails.join(", ")}`);
  }

  return parts.join(" · ");
}

export async function fetchWarmUp(
  source: DataSource,
  request: WarmUpRequest,
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<WarmUpReport> {
  const args = [
    source.script,
    request.action === "warm" ? "--warmup" : "--check",
    `--provider=${request.provider}`,
    "--json",
  ];

  if ("all" in request) {
    args.push("--all");
  } else {
    args.push(`--account=${request.account}`);
  }

  const defaultTimeout = "all" in request && request.all ? 180_000 : 30_000;
  const timeout = options?.timeoutMs ?? defaultTimeout;

  try {
    const { stdout } = await execFileAsync(source.bun, args, {
      encoding: "utf8",
      timeout,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
      signal: options?.signal,
    });

    return parseWarmUpReport(String(stdout));
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "killed" in error &&
      (error as { killed?: boolean }).killed
    ) {
      throw new Error(`warmup timed out after ${timeout / 1000}s`);
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
