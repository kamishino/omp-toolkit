import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireLock, releaseLock, withLock } from "./lock";

function nextTick(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  queueMicrotask(resolve);
  return promise;
}

describe("exclusive lock (lock.ts)", () => {
  test("acquires and releases lock cleanly", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-test-"));
    const lockPath = path.join(tempDir, "test.lock");
    try {
      const token = await acquireLock("unit_test", { lockPath, timeoutMs: 1_000 });
      expect(typeof token).toBe("string");
      expect(fs.existsSync(lockPath)).toBe(true);

      const released = releaseLock(token, { lockPath });
      expect(released).toBe(true);
      expect(fs.existsSync(lockPath)).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("two concurrent writers serialize and cannot lose updates", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-conc-"));
    const lockPath = path.join(tempDir, "test.lock");
    const dataFile = path.join(tempDir, "counter.txt");
    fs.writeFileSync(dataFile, "0", "utf8");

    try {
      const incrementTask = async (id: number) => {
        return withLock(
          `writer_${id}`,
          async () => {
            const current = Number(fs.readFileSync(dataFile, "utf8")) || 0;
            await nextTick();
            fs.writeFileSync(dataFile, String(current + 1), "utf8");
          },
          { lockPath, timeoutMs: 5_000, sleepMs: 10 },
        );
      };

      // Launch 5 concurrent writers
      await Promise.all([
        incrementTask(1),
        incrementTask(2),
        incrementTask(3),
        incrementTask(4),
        incrementTask(5),
      ]);

      const finalCount = Number(fs.readFileSync(dataFile, "utf8"));
      expect(finalCount).toBe(5);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("reclaims stale locks older than threshold", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-stale-"));
    const lockPath = path.join(tempDir, "stale.lock");

    try {
      // Seed a stale lock written 45 seconds ago
      const stalePayload = {
        token: "stale-token-123",
        pid: 99999,
        machineId: "mock-machine",
        operation: "crashed_worker",
        acquiredAt: Date.now() - 45_000,
      };
      fs.writeFileSync(lockPath, JSON.stringify(stalePayload), "utf8");

      // acquireLock should recognize stale lock, unlink it, and acquire successfully
      const token = await acquireLock("fresh_worker", {
        lockPath,
        staleMs: 30_000,
        timeoutMs: 1_000,
      });

      expect(typeof token).toBe("string");
      expect(token).not.toBe("stale-token-123");

      releaseLock(token, { lockPath });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("throws lock_timeout when lock is held beyond timeout", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-to-"));
    const lockPath = path.join(tempDir, "timeout.lock");

    try {
      const token = await acquireLock("holder", { lockPath });
      try {
        await expect(
          acquireLock("contender", {
            lockPath,
            timeoutMs: 100,
            sleepMs: 20,
            staleMs: 60_000,
          }),
        ).rejects.toThrow("lock_timeout");
      } finally {
        releaseLock(token, { lockPath });
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("does not steal a freshly created empty lock file", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-empty-"));
    const lockPath = path.join(tempDir, "empty.lock");
    fs.writeFileSync(lockPath, "", "utf8");

    try {
      await expect(
        acquireLock("contender", {
          lockPath,
          timeoutMs: 150,
          sleepMs: 20,
          staleMs: 30_000,
        }),
      ).rejects.toThrow("lock_timeout");
      expect(fs.existsSync(lockPath)).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("reclaims unparseable lock file if mtime exceeds stale threshold", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-corrupt-"));
    const lockPath = path.join(tempDir, "corrupt.lock");
    fs.writeFileSync(lockPath, "{ not valid json", "utf8");
    const oldTime = (Date.now() - 40_000) / 1000;
    fs.utimesSync(lockPath, oldTime, oldTime);

    try {
      const token = await acquireLock("reclaimer", {
        lockPath,
        timeoutMs: 300,
        staleMs: 30_000,
      });
      expect(typeof token).toBe("string");
      releaseLock(token, { lockPath });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("creates parent directories recursively if lockPath is nested", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-mkdir-"));
    const lockPath = path.join(tempDir, "nested", "deep", "nested.lock");

    try {
      const token = await acquireLock("nested", { lockPath });
      expect(fs.existsSync(lockPath)).toBe(true);
      releaseLock(token, { lockPath });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
