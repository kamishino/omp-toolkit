/**
 * Circuit Breaker Module for Google Antigravity Gemini Routes.
 *
 * Encapsulates route health probing, streak tracking, temporary account
 * exclusions (reservePct: 100), and policy restoration.
 */

import fs from "node:fs";
import {
  type Account,
  type HealAction,
  type HealthResult,
  type HealthState,
  type Policy,
  type ProbeResult as Result,
  resolveAgentDir,
  resolveSnapshotPath,
  resolveStatePath,
  resolveStreakPath,
  type StreakState,
} from "@omp-toolkit/core";
import { short, writeFileAtomic } from "./fs-util";
import { healthManager } from "./health-manager";
import { type HistoryEventInput, recordEvents } from "./history-store";
import { RoutingPolicyStore } from "./policy-store";

export { short, writeFileAtomic } from "./fs-util";

import {
  AntigravityProbeClient,
  DEFAULT_CONFIRM_DELAY_MS,
  DEFAULT_ENDPOINT,
  DEFAULT_MODEL_WIRE,
  DEFAULT_PROBE_PROMPT,
  DEFAULT_PROBE_TIMEOUT_MS,
  DEFAULT_PROVIDER,
  DEFAULT_USER_AGENT,
} from "./probe-client";

export const PROVIDER = DEFAULT_PROVIDER;
export const MODEL_WIRE = DEFAULT_MODEL_WIRE;
export const PROBE_TIMEOUT_MS = DEFAULT_PROBE_TIMEOUT_MS;
export const PROBE_PROMPT = DEFAULT_PROBE_PROMPT;
export const CONFIRM_DELAY_MS = DEFAULT_CONFIRM_DELAY_MS;
export const AUTO_HEAL_COOLDOWN_MS = 120_000;
export const ENDPOINT = DEFAULT_ENDPOINT;
export const UA_VERSION = process.env.PI_AI_ANTIGRAVITY_VERSION ?? "2.24.0";
export const USER_AGENT = DEFAULT_USER_AGENT;
export const RESTORE_STREAK = Math.max(
  1,
  Number(process.env.GEMINI_HEALTH_RESTORE_STREAK ?? 3) || 3,
);
export const RESTORE_GAP_MS = Math.max(
  30_000,
  (Number(process.env.GEMINI_HEALTH_RESTORE_GAP_SECONDS ?? 60) || 60) * 1000,
);

export const probeClient = new AntigravityProbeClient();
export const tokenCache = new Map<number, { token: string; at: number }>();
export function ompBin(): string {
  return process.env.OMP_BIN || "omp";
}

export function agentDir(): string {
  return resolveAgentDir();
}

export function statePath(): string {
  return resolveStatePath();
}

export function snapshotPath(): string {
  return resolveSnapshotPath();
}

export function streakPath(): string {
  return resolveStreakPath();
}

export function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export function writeState(state: HealthState): void {
  writeFileAtomic(statePath(), `${JSON.stringify(state, null, 2)}\n`);
}

export function readStateForWrite(): HealthState {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), "utf8")) as HealthState;
    if (!parsed || !Array.isArray(parsed.excluded)) {
      throw new Error("invalid gemini-health-state.json");
    }
    return {
      excluded: parsed.excluded.filter((email): email is string => typeof email === "string"),
    };
  } catch (error) {
    if ((error as { code?: string })?.code === "ENOENT") return { excluded: [] };
    throw error;
  }
}

export function readSnapshot(): { checkedAt: number; results: HealthResult[] } | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(snapshotPath(), "utf8")) as {
      checkedAt?: number;
      results?: HealthResult[];
    };
    if (!parsed || !Array.isArray(parsed.results)) return null;
    return {
      checkedAt: Number(parsed.checkedAt) || 0,
      results: parsed.results,
    };
  } catch {
    return null;
  }
}

export function readStreaks(): StreakState {
  try {
    const parsed = JSON.parse(fs.readFileSync(streakPath(), "utf8")) as StreakState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function readStreaksForWrite(): StreakState {
  try {
    const parsed = JSON.parse(fs.readFileSync(streakPath(), "utf8")) as StreakState;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid gemini-health-streaks.json");
    }
    return parsed;
  } catch (error) {
    if ((error as { code?: string })?.code === "ENOENT") return {};
    throw error;
  }
}

export function writeStreaks(state: StreakState): void {
  writeFileAtomic(streakPath(), `${JSON.stringify(state, null, 2)}\n`);
}

let historyWarning: string | null = null;

export function recordHistory(events: HistoryEventInput[]): void {
  try {
    recordEvents(events);
    historyWarning = null;
  } catch (error) {
    if (historyWarning !== null) return;
    historyWarning = short(error);
    console.warn(`[omp-toolkit] history write failed: ${historyWarning}`);
  }
}

export const policyStore = new RoutingPolicyStore();

export async function readPolicies(): Promise<Policy[]> {
  return policyStore.readPolicies();
}

export async function readPoliciesForWrite(): Promise<Policy[]> {
  return policyStore.readPolicies();
}

export async function writePolicies(policies: Policy[]): Promise<void> {
  return policyStore.writePolicies(policies);
}

export async function probe(account: Account): Promise<Result> {
  return probeClient.probe(account);
}

export async function loadAccounts(): Promise<Account[]> {
  return probeClient.loadAccounts();
}

export async function checkAll(confirm = false): Promise<Result[]> {
  return probeClient.checkAll(confirm);
}

export const applyHeal = (
  results: Result[],
  source: "heal" | "auto-heal" | "tool" = "heal",
): Promise<HealAction> => healthManager.applyHeal(results, source);

export const restoreManaged = (): Promise<string[]> => healthManager.restoreManaged();

export const maybeRestoreManaged = (): Promise<string[]> => healthManager.maybeRestoreManaged();

export const removeAccountExclusion = (email: string, detail = "enable"): Promise<void> =>
  healthManager.removeExclusion(email, detail);

export const recordHealth = (
  results: Result[],
  options: { merge?: boolean; source?: "warmup" | "check" } = {},
): void => healthManager.recordHealth(results, options);
