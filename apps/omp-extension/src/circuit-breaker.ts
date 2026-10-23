/**
 * Circuit Breaker Module for Google Antigravity Gemini Routes.
 *
 * Encapsulates route health probing, streak tracking, temporary account
 * exclusions (reservePct: 100), and policy restoration.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
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
  type Status,
  type StreakState,
} from "@omp-toolkit/core";
import { type HistoryEventInput, recordEvents } from "./history";
import { RoutingPolicyStore } from "./policy-store";

const execFileAsync = promisify(execFile);

export const PROVIDER = "google-antigravity";
export const MODEL_WIRE = "gemini-3.8-flash-high";
export const PROBE_TIMEOUT_MS = 15_000;
export const PROBE_PROMPT = "Reply with exactly: OK";
export const CONFIRM_DELAY_MS = 1_000;
export const AUTO_HEAL_COOLDOWN_MS = 120_000;
export const ENDPOINT =
  "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";
export const UA_VERSION = process.env.PI_AI_ANTIGRAVITY_VERSION ?? "2.24.0";
export const USER_AGENT = `antigravity/hub/${UA_VERSION} (aidev_client; os_type=darwin; arch=arm64; cl=963137146)`;

export const RESTORE_STREAK = Math.max(
  1,
  Number(process.env.GEMINI_HEALTH_RESTORE_STREAK ?? 3) || 3,
);
export const RESTORE_GAP_MS = Math.max(
  30_000,
  (Number(process.env.GEMINI_HEALTH_RESTORE_GAP_SECONDS ?? 60) || 60) * 1000,
);

const EXEC_OPTS = {
  encoding: "utf8" as const,
  timeout: 25_000,
  windowsHide: true,
  maxBuffer: 2 * 1024 * 1024,
};

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

export function short(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 180);
}

export function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export function writeFileAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, content);
  try {
    fs.renameSync(temp, file);
  } catch {
    fs.writeFileSync(file, content);
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // Temp cleanup is best-effort.
    }
  }
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

const sharedPolicyStore = new RoutingPolicyStore({ configKey: "models.routing.policy" });

export async function readPolicies(): Promise<Policy[]> {
  return sharedPolicyStore.readPolicies();
}

export async function readPoliciesForWrite(): Promise<Policy[]> {
  return sharedPolicyStore.readPolicies();
}

export async function writePolicies(policies: Policy[]): Promise<void> {
  return sharedPolicyStore.writePolicies(policies);
}

export async function tokenList(): Promise<Map<string, number>> {
  const { stdout } = await execFileAsync(ompBin(), ["token", PROVIDER, "--list"], EXEC_OPTS);
  const map = new Map<string, number>();
  for (const line of String(stdout).split(/\r?\n/)) {
    const match = /^(\d+)\.\s+(\S+@\S+)\s*$/.exec(line.trim());
    if (match) map.set(match[2].toLowerCase(), Number(match[1]));
  }
  return map;
}

export async function getToken(index: number): Promise<string> {
  const cached = tokenCache.get(index);
  if (cached && Date.now() - cached.at < 30 * 60_000) return cached.token;
  const { stdout } = await execFileAsync(
    ompBin(),
    ["token", PROVIDER, "-a", String(index), "--raw"],
    EXEC_OPTS,
  );
  const token = String(stdout).trim();
  if (!token) throw new Error(`empty token for account ${index}`);
  tokenCache.set(index, { token, at: Date.now() });
  return token;
}

export async function probe(account: Account): Promise<Result> {
  const started = performance.now();
  let token: string;
  try {
    token = await getToken(account.index);
  } catch (error) {
    return { ...account, status: "auth", ms: 0, detail: short(error) };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({
        project: account.project,
        requestId: `agent/${crypto.randomUUID()}/${Date.now()}/${crypto.randomUUID()}/0`,
        userAgent: "antigravity",
        model: MODEL_WIRE,
        request: {
          contents: [{ role: "user", parts: [{ text: PROBE_PROMPT }] }],
          generationConfig: { maxOutputTokens: 8 },
          sessionId: crypto.randomUUID(),
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) {
        tokenCache.delete(account.index);
      }
      const status: Status =
        response.status === 401 || response.status === 403
          ? "auth"
          : response.status === 404
            ? "model-error"
            : "error";
      return {
        ...account,
        status,
        ms: Math.round(performance.now() - started),
        detail: `${response.status} ${body.replace(/\s+/g, " ").slice(0, 150)}`.trim(),
      };
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return {
        ...account,
        status: "error",
        ms: Math.round(performance.now() - started),
        detail: "empty response body",
      };
    }

    try {
      const decoder = new TextDecoder();
      for (let i = 0; i < 4; i += 1) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        if (text.includes("data:")) {
          return {
            ...account,
            status: "ok",
            ms: Math.round(performance.now() - started),
          };
        }
      }
      return {
        ...account,
        status: "hang",
        ms: Math.round(performance.now() - started),
        detail: "no data event in stream head",
      };
    } finally {
      reader.cancel().catch(() => {});
    }
  } catch (error) {
    const isTimeout =
      (error as { name?: string })?.name === "AbortError" || controller.signal.aborted;
    return {
      ...account,
      status: isTimeout ? "hang" : "error",
      ms: Math.round(performance.now() - started),
      detail: isTimeout ? `timeout after ${PROBE_TIMEOUT_MS / 1000}s` : short(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function loadAccounts(): Promise<Account[]> {
  const [stdout, tokenMap] = await Promise.all([
    execFileAsync(ompBin(), ["usage", "--provider", PROVIDER, "--json"], EXEC_OPTS).then(
      (r) => r.stdout,
    ),
    tokenList(),
  ]);
  const parsed = JSON.parse(String(stdout));
  const reports = Array.isArray(parsed?.reports) ? parsed.reports : [];
  const accounts: Account[] = [];
  for (const report of reports) {
    const email = report?.metadata?.email;
    const project = report?.metadata?.projectId;
    if (typeof email !== "string" || typeof project !== "string") continue;
    const index = tokenMap.get(email.toLowerCase());
    if (index === undefined) continue;
    accounts.push({ index, email, project });
  }
  return accounts.sort((a, b) => a.index - b.index);
}

export async function checkAll(confirm = false): Promise<Result[]> {
  const accounts = await loadAccounts();
  if (accounts.length === 0) return [];
  const results = await Promise.all(accounts.map(probe));
  if (!confirm) return results;

  const suspects = results.filter(
    (result) => result.status === "hang" || result.status === "error",
  );
  await Promise.all(
    suspects.map(async (result) => {
      await sleep(CONFIRM_DELAY_MS);
      const again = await probe(result);
      if (again.status === "ok") {
        result.status = "ok";
        result.ms = again.ms;
        result.detail = "recovered on retry";
      } else {
        result.detail = `${result.detail ?? ""}${result.detail ? " · " : ""}confirmed`;
      }
    }),
  );
  return results;
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
