import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ReliabilityHistoryStore } from "./history-store";

describe("ReliabilityHistoryStore", () => {
  test("persists, queries, and aggregates history events cleanly", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "history-store-test-"));
    const dbPath = path.join(tmpDir, "test-history.db");
    const store = new ReliabilityHistoryStore(dbPath, tmpDir);

    const now = Date.now();
    store.recordEvents(
      [
        {
          at: now - 5000,
          kind: "route_check",
          provider: "google-antigravity",
          account: "test@example.com",
          status: "ok",
        },
        {
          at: now - 4000,
          kind: "route_check",
          provider: "google-antigravity",
          account: "test@example.com",
          status: "hang",
        },
        {
          at: now - 3000,
          kind: "incident",
          incidentId: "inc-1",
          detail: "route hang detected",
        },
        {
          at: now - 2000,
          kind: "restore",
          provider: "google-antigravity",
          account: "test@example.com",
        },
        {
          at: now - 1000,
          kind: "manual_intervention",
          detail: "manual exclusion reset",
        },
      ],
      "mach-1",
    );

    const queried = store.queryEvents(now - 10000);
    expect(queried.length).toBe(5);
    expect(queried[0].kind).toBe("route_check");
    expect(queried[0].status).toBe("ok");

    const stats = store.aggregateMachineStats(queried, "all");
    const machStats = stats.get("mach-1");
    expect(machStats).toBeDefined();
    expect(machStats?.checks).toBe(2);
    expect(machStats?.ok).toBe(1);
    expect(machStats?.hang).toBe(1);
    expect(machStats?.restores).toBe(1);
    expect(machStats?.manual).toBe(1);
    expect(machStats?.incidents).toBe(1);
    expect(machStats?.late).toBe(1); // Unresolved incident is counted as late

    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("handles empty queries and missing files gracefully", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "history-store-empty-"));
    const dbPath = path.join(tmpDir, "nonexistent.db");
    const store = new ReliabilityHistoryStore(dbPath, tmpDir);

    expect(store.queryEvents(0)).toEqual([]);
    expect(store.readLocalMachine()).toBeNull();
    expect(store.readLocalHeartbeat()).toBeNull();

    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  test("buildExecutionReport returns error when no data exists", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "exec-rep-empty-"));
    const dbPath = path.join(tmpDir, "history.db");
    const store = new ReliabilityHistoryStore(dbPath, tmpDir);
    try {
      const res = store.buildExecutionReport();
      expect(res.status).toBe("no_history");
    } finally {
      store.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("buildExecutionReport aggregates multiple machines and computes pooled arithmetic correctly", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "exec-rep-multi-"));
    const dbPath = path.join(tmpDir, "history.db");
    const store = new ReliabilityHistoryStore(dbPath, tmpDir);
    const now = 1_700_000_000_000;

    try {
      // Machine 1: 4 runs (1 error), 2 sessions, 1 manual, carries tok=1200
      store.recordEvents(
        [
          { at: now - 5000, kind: "session_start" },
          { at: now - 4000, kind: "agent_run", status: "ok", detail: "deepseek tok=1000" },
          { at: now - 3500, kind: "agent_run", status: "ok", detail: "deepseek tok=1400" },
          { at: now - 3000, kind: "session_start" },
          { at: now - 2000, kind: "agent_run", status: "ok", detail: "deepseek tok=1200" },
          { at: now - 1500, kind: "agent_run", status: "error", detail: "deepseek" },
          { at: now - 1000, kind: "manual_intervention" },
        ],
        "mach-1",
      );

      // Machine 2: 2 runs (0 error), 1 session, carries tok=800
      store.recordEvents(
        [
          { at: now - 4500, kind: "session_start" },
          { at: now - 3000, kind: "agent_run", status: "ok", detail: "gemini tok=800" },
          { at: now - 2000, kind: "agent_run", status: "ok", detail: "gemini tok=800" },
        ],
        "mach-2",
      );

      const rep = store.buildExecutionReport({ days: 7, now });
      expect(rep.status).toBe("success");
      if (rep.status === "success") {
        expect(rep.data.totalRuns).toBe(6);
        // 1 error out of 6 runs = 16.666%
        expect(rep.data.pooledErrorRate).toBeCloseTo(16.67, 1);

        // Header must contain meanTok (since >=50% have tokens)
        expect(rep.data.lines[0]).toContain("meanTok");

        // Check POOLED line
        const pooledLine = rep.data.lines.find((l) => l.startsWith("POOLED"));
        expect(pooledLine).toBeDefined();
        expect(pooledLine).toContain("6"); // total runs
        expect(pooledLine).toContain("1"); // total errors
        expect(pooledLine).toContain("16.7%"); // pooled error rate
        expect(pooledLine).toContain("3"); // total sessions
      }
    } finally {
      store.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
