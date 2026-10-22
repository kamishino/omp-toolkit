import type { Status } from "./types";

export type WarmUpAction = "warm" | "check";
export type WarmUpEligibility = "warm" | "check" | "unsupported";
export type WarmUpSkipReason = "non-ok" | "cooldown";

export interface WarmUpResult {
  account: string;
  status: Status;
  ms: number;
  checkedAt: number;
  detail?: string;
}

export interface WarmUpSkip {
  account: string;
  status: Status | null;
  reason: WarmUpSkipReason;
}

export interface WarmUpReport {
  action: WarmUpAction;
  provider: string;
  checkedAt: number;
  results: WarmUpResult[];
  skipped: WarmUpSkip[];
}

export type WarmUpRequest =
  | { provider: string; action: "warm"; all: true }
  | { provider: string; action: "warm" | "check"; account: string };

export function supportsWarmUp(provider: string): boolean {
  return provider === "google-antigravity";
}

export function warmUpEligibility(provider: string, status: Status | null): WarmUpEligibility {
  if (!supportsWarmUp(provider)) return "unsupported";
  return status === "ok" || status === null ? "warm" : "check";
}

export function isWarmUpReport(value: unknown): value is WarmUpReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<WarmUpReport>;
  if (report.action !== "warm" && report.action !== "check") return false;
  if (typeof report.provider !== "string") return false;
  if (typeof report.checkedAt !== "number" || !Number.isFinite(report.checkedAt)) return false;
  if (!Array.isArray(report.results) || !Array.isArray(report.skipped)) return false;

  const statuses = new Set(["ok", "hang", "error", "auth", "model-error"]);
  const reasons = new Set(["non-ok", "cooldown"]);

  for (const result of report.results) {
    if (!result || typeof result !== "object") return false;
    if (typeof result.account !== "string" || !statuses.has(result.status)) return false;
    if (typeof result.ms !== "number" || !Number.isFinite(result.ms)) return false;
    if (typeof result.checkedAt !== "number" || !Number.isFinite(result.checkedAt)) return false;
    if (result.detail !== undefined && typeof result.detail !== "string") return false;
  }

  for (const skip of report.skipped) {
    if (!skip || typeof skip !== "object") return false;
    if (typeof skip.account !== "string") return false;
    if (skip.status !== null && !statuses.has(skip.status)) return false;
    if (!reasons.has(skip.reason)) return false;
  }

  return true;
}
