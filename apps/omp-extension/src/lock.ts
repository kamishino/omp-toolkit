import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveLockPath } from "@omp-toolkit/core";

export interface LockPayload {
  token: string;
  pid: number;
  machineId: string;
  operation: string;
  acquiredAt: number;
}

export interface LockOptions {
  timeoutMs?: number;
  lockPath?: string;
  staleMs?: number;
  sleepMs?: number;
}

export const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
export const DEFAULT_STALE_LOCK_MS = 30_000;
export const DEFAULT_POLL_INTERVAL_MS = 50;

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function resolveMachineId(lockFilePath: string): string {
  try {
    const dir = path.dirname(lockFilePath);
    const machineFile = path.join(dir, "omp-toolkit-machine.json");
    if (fs.existsSync(machineFile)) {
      const parsed = JSON.parse(fs.readFileSync(machineFile, "utf8")) as { id?: string };
      if (typeof parsed?.id === "string" && parsed.id.length > 0) {
        return parsed.id;
      }
    }
  } catch {
    // ignore
  }
  return "unknown";
}

/**
 * Acquires an exclusive file-based lock with retry and stale-lock recovery.
 */
export async function acquireLock(operation: string, options: LockOptions = {}): Promise<string> {
  const lockFilePath = options.lockPath ?? resolveLockPath();
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_LOCK_MS;
  const pollIntervalMs = options.sleepMs ?? DEFAULT_POLL_INTERVAL_MS;

  const token = crypto.randomUUID();
  const machineId = resolveMachineId(lockFilePath);
  const deadline = Date.now() + timeoutMs;
  fs.mkdirSync(path.dirname(lockFilePath), { recursive: true });

  while (true) {
    try {
      const fd = fs.openSync(lockFilePath, "wx");
      const payload: LockPayload = {
        token,
        pid: process.pid,
        machineId,
        operation,
        acquiredAt: Date.now(),
      };
      fs.writeSync(fd, `${JSON.stringify(payload, null, 2)}\n`);
      fs.closeSync(fd);
      return token;
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code === "EEXIST") {
        // Inspect lock to see if stale
        let isStale = false;
        try {
          let basis: number | undefined;
          let lockPid: number | undefined;
          let lockMachineId: string | undefined;

          try {
            const content = fs.readFileSync(lockFilePath, "utf8");
            const parsed = JSON.parse(content) as Partial<LockPayload>;
            if (typeof parsed?.acquiredAt === "number" && Number.isFinite(parsed.acquiredAt)) {
              basis = parsed.acquiredAt;
            }
            if (typeof parsed?.pid === "number") {
              lockPid = parsed.pid;
            }
            if (typeof parsed?.machineId === "string") {
              lockMachineId = parsed.machineId;
            }
          } catch {
            // Empty or malformed JSON falls through to file mtime basis
          }

          if (basis === undefined) {
            basis = fs.statSync(lockFilePath).mtimeMs;
          }

          // Do not steal a valid expired lock if its local recorded process is still alive
          let isAlive = false;
          if (
            typeof lockPid === "number" &&
            (lockMachineId === undefined || lockMachineId === machineId)
          ) {
            try {
              process.kill(lockPid, 0);
              isAlive = true;
            } catch (err: unknown) {
              const code = (err as { code?: string })?.code;
              isAlive = code === "EPERM";
            }
          }

          if (!isAlive && Date.now() - basis > staleMs) {
            isStale = true;
          }
        } catch {
          // File vanished between openSync and statSync: retry openSync
          isStale = true;
        }

        if (isStale) {
          try {
            fs.unlinkSync(lockFilePath);
            continue;
          } catch {
            // Unlink race, continue loop
          }
        }
        if (Date.now() >= deadline) {
          throw new Error(
            `lock_timeout: operation "${operation}" failed to acquire ${lockFilePath}`,
          );
        }

        await sleep(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
        continue;
      }

      throw error;
    }
  }
}

/**
 * Releases an acquired lock if the caller's token matches.
 */
export function releaseLock(token: string, options: { lockPath?: string } = {}): boolean {
  const lockFilePath = options.lockPath ?? resolveLockPath();
  try {
    const content = fs.readFileSync(lockFilePath, "utf8");
    const parsed = JSON.parse(content) as Partial<LockPayload>;
    if (parsed.token === token) {
      fs.unlinkSync(lockFilePath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Wraps an asynchronous operation with an exclusive lock.
 */
export async function withLock<T>(
  operation: string,
  fn: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  const token = await acquireLock(operation, options);
  try {
    return await fn();
  } finally {
    releaseLock(token, options);
  }
}
