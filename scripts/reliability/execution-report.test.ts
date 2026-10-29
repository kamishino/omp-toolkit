import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ReliabilityHistoryStore } from "../../apps/omp-extension/src/history-store";
import { runExecutionReport } from "./execution-report";

describe("runExecutionReport CLI runner", () => {
  test("handles --help flag and returns exit code 0", () => {
    const output: string[] = [];
    const res = runExecutionReport({
      args: ["--help"],
      out: (msg) => output.push(msg),
    });

    expect(res.exitCode).toBe(0);
    expect(res.lines[0]).toContain("Usage: bun scripts/reliability/execution-report.ts");
    expect(output[0]).toContain("Usage: bun scripts/reliability/execution-report.ts");
  });

  test("returns exit code 1 with 'no execution data' when store has no agent_run records", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "exec-test-empty-"));
    const dbPath = path.join(tmpDir, "test-history.db");
    const store = new ReliabilityHistoryStore(dbPath, tmpDir);

    const output: string[] = [];
    const res = runExecutionReport({
      args: ["--days=14"],
      store,
      out: (msg) => output.push(msg),
    });

    expect(res.exitCode).toBe(1);
    expect(res.lines[0]).toBe("no execution data");
    expect(output[0]).toBe("no execution data");

    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("runs report successfully on populated store and formats pooled table", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "exec-test-pop-"));
    const dbPath = path.join(tmpDir, "test-history.db");
    const store = new ReliabilityHistoryStore(dbPath, tmpDir);

    const now = Date.now();
    store.recordEvents(
      [
        { at: now - 5000, kind: "session_start" },
        { at: now - 4000, kind: "agent_run", status: "ok", detail: "deepseek tok=1200" },
        { at: now - 3000, kind: "agent_run", status: "ok", detail: "deepseek tok=1800" },
        { at: now - 2000, kind: "agent_run", status: "error", detail: "deepseek" },
      ],
      "mach-alpha-1234",
    );

    const output: string[] = [];
    const res = runExecutionReport({
      args: ["--days=14", "--machine=all"],
      store,
      out: (msg) => output.push(msg),
    });

    expect(res.exitCode).toBe(0);
    expect(res.lines.length).toBeGreaterThanOrEqual(3);

    // Verify header columns present
    const header = res.lines[0];
    expect(header).toContain("machine");
    expect(header).toContain("runs");
    expect(header).toContain("error");
    expect(header).toContain("meanTok");

    // Verify machine row and pooled row
    const fullText = res.lines.join("\n");
    expect(fullText).toContain("mach-alp");
    expect(fullText).toContain("POOLED");

    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("filters records by machine ID argument", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "exec-test-filter-"));
    const dbPath = path.join(tmpDir, "test-history.db");
    const store = new ReliabilityHistoryStore(dbPath, tmpDir);

    const now = Date.now();
    store.recordEvents(
      [{ at: now - 3000, kind: "agent_run", status: "ok", detail: "tok=1000" }],
      "target-machine",
    );
    store.recordEvents(
      [{ at: now - 2000, kind: "agent_run", status: "ok", detail: "tok=2000" }],
      "other-machine",
    );

    const output: string[] = [];
    const res = runExecutionReport({
      args: ["--days=14", "--machine=target-machine"],
      store,
      out: (msg) => output.push(msg),
    });

    expect(res.exitCode).toBe(0);
    const fullText = res.lines.join("\n");
    expect(fullText).toContain("target-m");
    expect(fullText).not.toContain("other-m");

    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("clamps days argument correctly between 1 and 366", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "exec-test-clamp-"));
    const dbPath = path.join(tmpDir, "test-history.db");
    const store = new ReliabilityHistoryStore(dbPath, tmpDir);

    const now = Date.now();
    store.recordEvents(
      [{ at: now - 1000, kind: "agent_run", status: "ok", detail: "tok=1000" }],
      "mach-clamp",
    );

    // --days=0 clamps to 1
    const resZero = runExecutionReport({
      args: ["--days=0"],
      store,
      out: () => {},
    });
    expect(resZero.exitCode).toBe(0);
    expect(resZero.lines.join("\n")).toContain("1");

    // --days=999 clamps to 366
    const resHuge = runExecutionReport({
      args: ["--days=999"],
      store,
      out: () => {},
    });
    expect(resHuge.exitCode).toBe(0);
    expect(resHuge.lines.join("\n")).toContain("366");

    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
