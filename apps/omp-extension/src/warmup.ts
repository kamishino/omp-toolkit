import fs from "node:fs";
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

export interface WarmUpAdapter {
  readonly provider: string;
  loadAccounts(): Promise<Account[]>;
  probe(account: Account): Promise<ProbeResult>;
}

export interface WarmUpDependencies {
  agentDir: string;
  adapters: ReadonlyMap<string, WarmUpAdapter>;
  readSnapshot(): HealthSnapshot | null;
  recordHealth(
    results: ProbeResult[],
    options?: { merge?: boolean; source?: "warmup" | "check" },
  ): void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface WarmUpRun {
  report: WarmUpReport;
  results: ProbeResult[];
}

export const WARMUP_COOLDOWN_MS = 60_000;
export const WARMUP_LOCK_STALE_MS = 5 * 60_000;

function short(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 180);
}

function writeFileAtomic(file: string, content: string): void {
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
      // Best effort temp cleanup
    }
  }
}

export function readWarmUpCooldowns(agentDir: string): {
  lastWarmupAt: Record<string, number>;
} {
  const filePath = path.join(agentDir, "gemini-warmup-state.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      lastWarmupAt?: Record<string, number>;
    };
    if (parsed && typeof parsed.lastWarmupAt === "object" && !Array.isArray(parsed.lastWarmupAt)) {
      const valid: Record<string, number> = {};
      for (const [email, ts] of Object.entries(parsed.lastWarmupAt)) {
        if (typeof ts === "number" && Number.isFinite(ts) && ts >= 0) {
          valid[email] = ts;
        }
      }
      return { lastWarmupAt: valid };
    }
    return { lastWarmupAt: {} };
  } catch {
    return { lastWarmupAt: {} };
  }
}

export function writeWarmUpCooldowns(
  agentDir: string,
  state: { lastWarmupAt: Record<string, number> },
): void {
  const filePath = path.join(agentDir, "gemini-warmup-state.json");
  writeFileAtomic(filePath, JSON.stringify(state, null, 2) + "\n");
}

export async function withWarmUpLock<T>(agentDir: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = path.join(agentDir, "gemini-warmup.lock");
  fs.mkdirSync(agentDir, { recursive: true });
  const token = `${process.pid}-${Date.now()}-${crypto.randomUUID()}`;

  let acquired = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      try {
        fs.writeFileSync(
          fd,
          JSON.stringify({ token, pid: process.pid, startedAt: Date.now() }),
          "utf8",
        );
      } finally {
        fs.closeSync(fd);
      }
      acquired = true;
      break;
    } catch (error) {
      if ((error as { code?: string })?.code !== "EEXIST" || attempt === 1) {
        throw error;
      }
      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs >= WARMUP_LOCK_STALE_MS) {
          fs.rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        // Lock vanished between attempt and stat, retry
        continue;
      }
      throw new Error("another warm-up is already running");
    }
  }

  if (!acquired) {
    throw new Error("another warm-up is already running");
  }

  try {
    return await fn();
  } finally {
    try {
      const raw = fs.readFileSync(lockPath, "utf8");
      const parsed = JSON.parse(raw) as { token?: string };
      if (parsed.token === token) {
        fs.rmSync(lockPath, { force: true });
      }
    } catch {
      // Ignored
    }
  }
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

  return await withWarmUpLock(deps.agentDir, async () => {
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
        const lastAt = lastWarmupAt[account.email] ?? 0;
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
          const lastAt = lastWarmupAt[targetAccount.email] ?? 0;
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
        probeResult = {
          ...target,
          status: "error",
          ms: 0,
          detail: short(error),
        };
      }

      const source = request.action === "warm" ? "warmup" : "check";
      deps.recordHealth([probeResult], { merge: true, source });
      results.push(probeResult);

      if (request.action === "warm") {
        lastWarmupAt[target.email] = getTime();
        writeWarmUpCooldowns(deps.agentDir, { lastWarmupAt });
      }

      if (i < targets.length - 1) {
        await wait(1000);
      }
    }

    const finalNow = getTime();
    const warmUpResults: WarmUpResult[] = results.map((r) => ({
      account: r.email,
      status: r.status,
      ms: r.ms,
      checkedAt: finalNow,
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
  });
}
