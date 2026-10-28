import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runDoctor } from "./doctor";

describe("runDoctor diagnostic suite", () => {
  function createValidEnv(tempDir: string) {
    fs.mkdirSync(path.join(tempDir, "extensions"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "extensions", "gemini-health.js"), "// dummy", "utf8");
    fs.writeFileSync(path.join(tempDir, "scripts", "omp-provider-usage.js"), "// dummy", "utf8");

    // Valid history db
    const dbPath = path.join(tempDir, "omp-toolkit-history.db");
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta (key, value) VALUES ('schema_version', '1');
    `);
    db.close();

    // Valid machine id
    const machinePath = path.join(tempDir, "omp-toolkit-machine.json");
    fs.writeFileSync(
      machinePath,
      JSON.stringify({
        id: "mock-machine-id-12345",
        hostname: "mock-host",
        createdAt: 1_700_000_000_000,
      }),
      "utf8",
    );
  }

  test("all checks pass in valid environment", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-pass-"));
    try {
      createValidEnv(tempDir);

      const fakeExec = async (_cmd: string, args: string[]) => {
        if (args.includes("--version")) {
          return { stdout: "omp/18.13.2\n" };
        }
        if (args.includes("--worktree")) {
          return { stdout: "[]" };
        }
        return { stdout: "" };
      };

      const result = await runDoctor({
        agentDir: tempDir,
        execFileFn: fakeExec,
      });

      expect(result.exitCode).toBe(0);
      expect(result.lines.some((l) => l.startsWith("PASS omp-version"))).toBe(true);
      expect(result.lines.some((l) => l.startsWith("PASS installed-files"))).toBe(true);
      expect(result.lines.some((l) => l.startsWith("PASS history-db"))).toBe(true);
      expect(result.lines.some((l) => l.startsWith("PASS machine-id"))).toBe(true);
      expect(result.lines.some((l) => l.startsWith("PASS lock-file (absent)"))).toBe(true);
      expect(result.lines.some((l) => l.startsWith("PASS orca-terminal"))).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("fails if installed files are missing", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-fail-files-"));
    try {
      createValidEnv(tempDir);
      fs.unlinkSync(path.join(tempDir, "extensions", "gemini-health.js"));

      const result = await runDoctor({
        agentDir: tempDir,
        execFileFn: async () => ({ stdout: "[]" }),
      });

      expect(result.exitCode).toBe(1);
      expect(result.lines.some((l) => l.startsWith("FAIL installed-files"))).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("fails if history DB is missing or has wrong schema version", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-fail-db-"));
    try {
      createValidEnv(tempDir);
      const dbPath = path.join(tempDir, "omp-toolkit-history.db");
      fs.unlinkSync(dbPath);

      // Missing DB
      const resMissing = await runDoctor({
        agentDir: tempDir,
        execFileFn: async () => ({ stdout: "[]" }),
      });
      expect(resMissing.exitCode).toBe(1);
      expect(
        resMissing.lines.some((l) => l.startsWith("FAIL history-db: history DB missing")),
      ).toBe(true);

      // Wrong schema version
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO meta (key, value) VALUES ('schema_version', '99');
      `);
      db.close();

      const resWrong = await runDoctor({
        agentDir: tempDir,
        execFileFn: async () => ({ stdout: "[]" }),
      });
      expect(resWrong.exitCode).toBe(1);
      expect(
        resWrong.lines.some((l) => l.startsWith("FAIL history-db: unexpected schema version: 99")),
      ).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("handles lock states: active PASS, stale PASS, orphaned FAIL, corrupt FAIL", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-lock-"));
    const lockPath = path.join(tempDir, "omp-toolkit.lock");
    try {
      createValidEnv(tempDir);

      // 1. Active lock with alive PID -> PASS
      fs.writeFileSync(
        lockPath,
        JSON.stringify({ token: "tok1", pid: 1234, acquiredAt: 1_000_000 }),
      );
      const resActive = await runDoctor({
        agentDir: tempDir,
        execFileFn: async () => ({ stdout: "[]" }),
        now: () => 1_010_000, // 10s old
        isPidAlive: (pid) => pid === 1234,
      });
      expect(resActive.lines.some((l) => l.startsWith("PASS lock-file (active"))).toBe(true);

      // 2. Stale lock (>30s) -> PASS
      const resStale = await runDoctor({
        agentDir: tempDir,
        execFileFn: async () => ({ stdout: "[]" }),
        now: () => 1_045_000, // 45s old
        isPidAlive: () => false,
      });
      expect(resStale.lines.some((l) => l.startsWith("PASS lock-file (stale"))).toBe(true);

      // 3. Orphaned lock (fresh, dead PID) -> FAIL
      const resOrphan = await runDoctor({
        agentDir: tempDir,
        execFileFn: async () => ({ stdout: "[]" }),
        now: () => 1_005_000, // 5s old
        isPidAlive: () => false,
      });
      expect(resOrphan.exitCode).toBe(1);
      expect(resOrphan.lines.some((l) => l.startsWith("FAIL lock-file: orphaned lock"))).toBe(true);

      // 4. Corrupt lock -> FAIL
      fs.writeFileSync(lockPath, "{ not valid json");
      const resCorrupt = await runDoctor({
        agentDir: tempDir,
        execFileFn: async () => ({ stdout: "[]" }),
      });
      expect(resCorrupt.exitCode).toBe(1);
      expect(resCorrupt.lines.some((l) => l.startsWith("FAIL lock-file: unparseable"))).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
