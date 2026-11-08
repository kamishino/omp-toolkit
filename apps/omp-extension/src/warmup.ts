import path from "node:path";
import {
  type Account,
  type HealthSnapshot,
  type ProbeResult,
  type Status,
  type WarmUpReport,
  type WarmUpRequest,
  type WarmUpResult,
  type WarmUpSkip,
  warmUpEligibility,
} from "@omp-toolkit/core";
import { readJsonFile, short, writeFileAtomic } from "./fs-util";
import { withLock } from "./lock";
export interface WarmUpAdapter {
  readonly provider: string;
  readonly model: string;
  loadAccounts(): Promise<Account[]>;
  probe(account: Account): Promise<ProbeResult>;
}
export interface WarmUpDependencies {
  agentDir: string;
  adapters: ReadonlyMap<string, WarmUpAdapter>;
  readSnapshot(): HealthSnapshot | null;
  recordHealth(
    results: ProbeResult[],
    options?: { scope?: "full" | "partial"; source?: "warmup" | "check" },
  ): Promise<void> | void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface WarmUpRun {
  report: WarmUpReport;
  results: ProbeResult[];
}

export const WARMUP_COOLDOWN_MS = 60_000;
export const WARMUP_LOCK_STALE_MS = 5 * 60_000;

export function readWarmUpCooldowns(agentDir: string): {
  lastWarmupAt: Record<string, number>;
} {
  const filePath = path.join(agentDir, "gemini-warmup-state.json");
  const parsed = readJsonFile<{ lastWarmupAt?: Record<string, number> }>(filePath, {
    lastWarmupAt: {},
  });
  if (parsed && typeof parsed.lastWarmupAt === "object" && !Array.isArray(parsed.lastWarmupAt)) {
    const valid: Record<string, number> = {};
    for (const [email, ts] of Object.entries(parsed.lastWarmupAt)) {
      if (typeof ts === "number" && Number.isFinite(ts) && ts >= 0) {
        valid[email.toLowerCase()] = ts;
      }
    }
    return { lastWarmupAt: valid };
  }
  return { lastWarmupAt: {} };
}

export function writeWarmUpCooldowns(
  agentDir: string,
  state: { lastWarmupAt: Record<string, number> },
): void {
  const filePath = path.join(agentDir, "gemini-warmup-state.json");
  writeFileAtomic(filePath, `${JSON.stringify(state, null, 2)}\n`);
}

export async function runWarmUp(
  deps: WarmUpDependencies,
  request: WarmUpRequest,
): Promise<WarmUpRun> {
  const adapter = deps.adapters.get(request.provider);
  if (!adapter) {
    throw new Error(`warm-up unsupported: ${request.provider}`);
  }

  const getTime = deps.now ?? (() => Date.now());
  const wait =
    deps.sleep ??
    ((ms: number) => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, ms);
      return promise;
    });
  const perform = async () => {
    const accounts = await adapter.loadAccounts();
    if (accounts.length === 0) {
      throw new Error(`no accounts found for ${request.provider}`);
    }

    const snapshot = deps.readSnapshot();
    const statusByEmail = new Map<string, Status | null>(
      (snapshot?.results ?? []).map((r) => [r.email.toLowerCase(), r.status]),
    );

    const cooldownState = readWarmUpCooldowns(deps.agentDir);
    const lastWarmupAt = { ...cooldownState.lastWarmupAt };

    const skipped: WarmUpSkip[] = [];
    const targets: Account[] = [];

    if ("all" in request) {
      for (const account of accounts) {
        const status = statusByEmail.get(account.email.toLowerCase()) ?? null;
        if (warmUpEligibility(request.provider, status) !== "warm") {
          skipped.push({ account: account.email, status, reason: "non-ok" });
          continue;
        }
        const lastAt = lastWarmupAt[account.email.toLowerCase()] ?? 0;
        if (getTime() - lastAt < WARMUP_COOLDOWN_MS) {
          skipped.push({ account: account.email, status, reason: "cooldown" });
          continue;
        }
        targets.push(account);
      }
    } else {
      const requestedAccount = request.account;
      const targetAccount = accounts.find(
        (a) => a.email.toLowerCase() === requestedAccount.toLowerCase(),
      );
      if (!targetAccount) {
        throw new Error(`account not found: ${requestedAccount}`);
      }
      const status = statusByEmail.get(targetAccount.email.toLowerCase()) ?? null;

      if (request.action === "warm") {
        if (warmUpEligibility(request.provider, status) !== "warm") {
          skipped.push({ account: targetAccount.email, status, reason: "non-ok" });
        } else {
          const lastAt = lastWarmupAt[targetAccount.email.toLowerCase()] ?? 0;
          if (getTime() - lastAt < WARMUP_COOLDOWN_MS) {
            skipped.push({ account: targetAccount.email, status, reason: "cooldown" });
          } else {
            targets.push(targetAccount);
          }
        }
      } else {
        // action === "check" bypasses eligibility and cooldown
        targets.push(targetAccount);
      }
    }

    const results: ProbeResult[] = [];
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      let probeResult: ProbeResult;
      try {
        probeResult = await adapter.probe(target);
      } catch (error) {
        const errNow = getTime();
        probeResult = {
          ...target,
          provider: "google-antigravity",
          model: adapter.model,
          status: "error",
          ms: 0,
          startedAt: errNow,
          checkedAt: errNow,
          failureKind: "protocol",
          confirmed: false,
          detail: short(error),
        };
      }

      const source = request.action === "warm" ? "warmup" : "check";
      await deps.recordHealth([probeResult], { scope: "partial", source });
      results.push(probeResult);
      if (request.action === "warm") {
        lastWarmupAt[target.email.toLowerCase()] = getTime();
        writeWarmUpCooldowns(deps.agentDir, { lastWarmupAt });
      }

      if (i < targets.length - 1) {
        await wait(1000);
      }
    }

    const finalNow = getTime();
    const warmUpResults: WarmUpResult[] = results.map((r) => ({
      account: r.email,
      model: r.model,
      status: r.status,
      ms: r.ms,
      checkedAt: r.checkedAt,
      ...(r.detail !== undefined ? { detail: r.detail } : {}),
    }));

    return {
      report: {
        action: request.action,
        provider: request.provider,
        checkedAt: finalNow,
        results: warmUpResults,
        skipped,
      },
      results,
    };
  };

  try {
    return await withLock("gemini-warmup", perform, {
      lockPath: path.join(deps.agentDir, "gemini-warmup.lock"),
      timeoutMs: 0,
      staleMs: WARMUP_LOCK_STALE_MS,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("lock_timeout")) {
      throw new Error("another warm-up is already running");
    }
    throw error;
  }
}
