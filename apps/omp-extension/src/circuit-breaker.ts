/**
 * Circuit Breaker Module for Google Antigravity Gemini Routes.
 *
 * Encapsulates route health probing, streak tracking, temporary account
 * exclusions (reservePct: 100), and policy restoration.
 */

import fs from "node:fs";
import {
  type Account,
  excludedEmails,
  type HealAction,
  type HealthResult,
  type HealthState,
  mergeHealthResults,
  nextStreaks,
  type Policy,
  type ProbeResult as Result,
  resolveAgentDir,
  resolveSnapshotPath,
  resolveStatePath,
  resolveStreakPath,
  restorableEmails,
  type StreakState,
} from "@omp-toolkit/core";
import { short, writeFileAtomic } from "./fs-util";
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

export function recordHealth(
  results: Result[],
  options: { merge?: boolean; source?: "warmup" | "check" } = {},
): void {
  const at = Date.now();
  const streaks = nextStreaks(readStreaksForWrite(), results, at, RESTORE_GAP_MS);
  writeStreaks(streaks);

  const snapshotResults = options.merge
    ? mergeHealthResults(readSnapshot()?.results ?? [], results, at)
    : results.map((result) => ({ ...result, checkedAt: at }));

  writeFileAtomic(
    snapshotPath(),
    `${JSON.stringify({ checkedAt: at, results: snapshotResults }, null, 2)}\n`,
  );

  const prefix = options.source ? `${options.source} ` : "";
  recordHistory(
    results.map((result) => ({
      at,
      kind: "route_check" as const,
      provider: PROVIDER,
      account: result.email,
      status: result.status,
      detail: `${prefix}${result.ms}ms${result.detail ? ` ${result.detail}` : ""}`,
    })),
  );
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

export async function applyHeal(
  results: Result[],
  source: "heal" | "auto-heal" | "tool" = "heal",
): Promise<HealAction> {
  if (results.length === 0) {
    return { changed: [], skipped: [], reason: "no accounts to check" };
  }
  const bad = results.filter((result) => result.status === "hang" || result.status === "error");
  if (bad.length === 0) {
    return { changed: [], skipped: [], reason: "all accounts healthy" };
  }
  if (bad.length >= results.length) {
    return {
      changed: [],
      skipped: [],
      reason: "all accounts failing; provider-wide issue, no exclusion applied",
    };
  }

  const policies = await readPoliciesForWrite();
  const state = readStateForWrite();
  const managed = new Set(state.excluded);
  const alreadyExcluded = excludedEmails(policies);
  const changed: string[] = [];
  const skipped: string[] = [];

  for (const result of bad) {
    if (alreadyExcluded.has(result.email)) {
      if (managed.has(result.email)) continue;
      skipped.push(result.email);
      continue;
    }
    const existing = policies.find(
      (policy) => policy?.provider === PROVIDER && policy?.account?.email === result.email,
    );
    if (existing) {
      skipped.push(result.email);
      continue;
    }
    policies.push({
      provider: PROVIDER,
      account: { email: result.email },
      reservePct: 100,
    });
    managed.add(result.email);
    changed.push(result.email);
  }

  if (changed.length > 0) {
    await writePolicies(policies);
    writeState({ excluded: [...managed], updatedAt: new Date().toISOString() });
    recordHistory(
      changed.map((email) => ({
        at: Date.now(),
        kind: "policy_change" as const,
        provider: PROVIDER,
        account: email,
        detail: source,
      })),
    );
  }

  return {
    changed,
    skipped,
    reason:
      changed.length > 0
        ? "temporary reservePct=100 applied"
        : skipped.length > 0
          ? "failing accounts already have exclusions/policies"
          : "no new exclusions",
  };
}

export async function restoreManaged(): Promise<string[]> {
  const state = readStateForWrite();
  if (state.excluded.length === 0) return [];
  const managed = new Set(state.excluded);
  const policies = await readPoliciesForWrite();
  const next = policies.filter(
    (policy) =>
      !(
        policy?.provider === PROVIDER &&
        typeof policy?.account?.email === "string" &&
        managed.has(policy.account.email)
      ),
  );
  if (next.length !== policies.length) await writePolicies(next);
  const streaks = readStreaksForWrite();
  for (const email of managed) delete streaks[email];
  writeStreaks(streaks);
  writeState({ excluded: [], updatedAt: new Date().toISOString() });
  recordHistory(
    [...managed].map((email) => ({
      at: Date.now(),
      kind: "restore" as const,
      provider: PROVIDER,
      account: email,
      detail: "manual",
    })),
  );
  return [...managed];
}

export async function maybeRestoreManaged(): Promise<string[]> {
  const state = readStateForWrite();
  if (state.excluded.length === 0) return [];
  const streaks = readStreaksForWrite();
  const eligible = restorableEmails(state, streaks, RESTORE_STREAK);
  if (eligible.length === 0) return [];

  const policies = await readPoliciesForWrite();
  const managed = new Set(state.excluded);
  const next = policies.filter(
    (policy) =>
      !(
        policy?.provider === PROVIDER &&
        typeof policy?.account?.email === "string" &&
        managed.has(policy.account.email) &&
        eligible.includes(policy.account.email)
      ),
  );
  if (next.length !== policies.length) await writePolicies(next);

  for (const email of eligible) {
    managed.delete(email);
    delete streaks[email];
  }
  writeState({ excluded: [...managed], updatedAt: new Date().toISOString() });
  writeStreaks(streaks);
  recordHistory(
    eligible.map((email) => ({
      at: Date.now(),
      kind: "restore" as const,
      provider: PROVIDER,
      account: email,
      detail: "auto",
    })),
  );
  return eligible;
}

export async function removeAccountExclusion(email: string, detail = "enable"): Promise<void> {
  const policies = await readPoliciesForWrite();
  const next = policies.filter(
    (policy) =>
      !(
        policy?.provider === PROVIDER &&
        typeof policy?.account?.email === "string" &&
        policy.account.email.toLowerCase() === email.toLowerCase()
      ),
  );
  if (next.length !== policies.length) {
    await writePolicies(next);
  }

  const state = readStateForWrite();
  state.excluded = state.excluded.filter((e) => e.toLowerCase() !== email.toLowerCase());
  writeState({ excluded: state.excluded, updatedAt: new Date().toISOString() });

  const streaks = readStreaksForWrite();
  delete streaks[email];
  writeStreaks(streaks);

  recordHistory([
    {
      at: Date.now(),
      kind: "restore" as const,
      provider: PROVIDER,
      account: email,
      detail,
    },
  ]);
}
