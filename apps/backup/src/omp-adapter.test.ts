import { describe, expect, it } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createBackupRuntime } from "./omp-adapter";

describe("apps/backup/omp-adapter", () => {
  const tmpDir = path.join(
    os.tmpdir(),
    `omp-adapter-test-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
  );

  it("handles lock acquisition and release", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const lockPath = path.join(tmpDir, "test.lock");
    const runtime = createBackupRuntime();

    const lock1 = await runtime.acquireLock(lockPath);
    expect(fs.existsSync(lockPath)).toBe(true);

    // Second acquisition must fail
    expect(runtime.acquireLock(lockPath)).rejects.toThrow("already held");

    await lock1.release();
    expect(fs.existsSync(lockPath)).toBe(false);

    // After release, can acquire again
    const lock2 = await runtime.acquireLock(lockPath);
    await lock2.release();

    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("exposes platform and process list method", async () => {
    const runtime = createBackupRuntime();
    expect(typeof runtime.platform).toBe("string");
    const procs = await runtime.listProcesses();
    expect(Array.isArray(procs)).toBe(true);
  });
});
