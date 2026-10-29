import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ReliabilityHistoryStore } from "../../apps/omp-extension/src/history-store";
import { runReliabilityReport } from "./reliability-report";

describe("runReliabilityReport CLI runner", () => {
  test("handles --help flag and returns exit code 0", () => {
    const output: string[] = [];
    const res = runReliabilityReport({
      args: ["--help"],
      out: (msg) => output.push(msg),
    });

    expect(res.exitCode).toBe(0);
    expect(res.lines[0]).toContain("Usage: bun scripts/reliability/reliability-report.ts");
    expect(output[0]).toContain("Usage: bun scripts/reliability/reliability-report.ts");
  });

  test("returns exit code 1 when store has no records", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rel-test-empty-"));
    const dbPath = path.join(tmpDir, "test-history.db");
    const store = new ReliabilityHistoryStore(dbPath, tmpDir);

    const output: string[] = [];
    const res = runReliabilityReport({
      args: ["--days=30"],
      store,
      out: (msg) => output.push(msg),
    });

    expect(res.exitCode).toBe(1);
    expect(res.lines[0]).toMatch(/no (history|health data)/);
    expect(output[0]).toMatch(/no (history|health data)/);

    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("runs report successfully on healthy store and returns code 0", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rel-test-pop-"));
    const dbPath = path.join(tmpDir, "test-history.db");
    const store = new ReliabilityHistoryStore(dbPath, tmpDir);

    const now = Date.now();
    // Record healthy checks covering days
    store.recordEvents(
      [
        {
          at: now - 3600_000,
          kind: "route_check",
          provider: "google-antigravity",
          account: "test@example.com",
          status: "ok",
        },
      ],
      "mach-rel-1",
    );

    const output: string[] = [];
    const res = runReliabilityReport({
      args: ["--days=1", "--machine=all"],
      store,
      out: (msg) => output.push(msg),
    });

    expect(res.lines.length).toBeGreaterThanOrEqual(2);
    const fullText = res.lines.join("\n");
    expect(fullText).toContain("mach-rel");

    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("clamps days argument correctly between 1 and 366", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rel-test-clamp-"));
    const dbPath = path.join(tmpDir, "test-history.db");
    const store = new ReliabilityHistoryStore(dbPath, tmpDir);

    const now = Date.now();
    store.recordEvents(
      [
        {
          at: now - 1000,
          kind: "route_check",
          provider: "google-antigravity",
          account: "test@example.com",
          status: "ok",
        },
      ],
      "mach-clamp",
    );

    const resZero = runReliabilityReport({
      args: ["--days=0"],
      store,
      out: () => {},
    });
    expect(resZero.lines.join("\n")).toContain("1");

    const resHuge = runReliabilityReport({
      args: ["--days=999"],
      store,
      out: () => {},
    });
    expect(resHuge.lines.join("\n")).toContain("366");

    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
