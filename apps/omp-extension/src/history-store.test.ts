import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  closeHistory,
  getHistoryStore,
  ReliabilityHistoryStore,
  recordEvents,
  resetHistoryCachesForTest,
} from "./history-store";

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

    const stats = store.aggregateMachineStats(queried, "all", now);
    const machStats = stats.get("mach-1");
    expect(machStats).toBeDefined();
    expect(machStats?.checks).toBe(2);
    expect(machStats?.ok).toBe(1);
    expect(machStats?.hang).toBe(1);
    expect(machStats?.restores).toBe(1);
    expect(machStats?.manual).toBe(1);
    expect(machStats?.incidents).toBe(1);
    expect(machStats?.late).toBe(0); // Unresolved incident 3s ago is within 15min SLA

    const lateStats = store.aggregateMachineStats(queried, "all", now + 1_000_000);
    expect(lateStats.get("mach-1")?.late).toBe(1); // Exceeding 15min without resolution is late
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

  test("getDatabase smoothly transitions from readonly to writable without SQLITE_READONLY error", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-ro-trans-"));
    const dbPath = path.join(tmpDir, "history.db");
    const store = new ReliabilityHistoryStore(dbPath, tmpDir);

    try {
      const now = Date.now();
      // First open writable to initialize DB schema
      store.recordEvents([{ at: now - 1000, kind: "session_start" }]);
      store.close();

      // Now reopen in readonly mode via queryEvents
      const initialRows = store.queryEvents(0);
      expect(initialRows.length).toBe(1);

      // Subsequent write must upgrade or reopen writable connection rather than crashing
      expect(() => {
        store.recordEvents([{ at: now, kind: "session_start" }]);
      }).not.toThrow();

      const updatedRows = store.queryEvents(0);
      expect(updatedRows.length).toBe(2);
    } finally {
      store.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("aggregateMachineStats accurately flags active incidents as late only after 15 minutes", () => {
    const store = new ReliabilityHistoryStore();
    const now = 1_000_000;
    const rows = [
      {
        at: now - 60_000, // 1 minute old
        machine_id: "m-1",
        kind: "incident",
        incident_id: "inc-fresh",
        provider: null,
        account: null,
        status: null,
        detail: null,
      },
      {
        at: now - 901_000, // 15m 1s old
        machine_id: "m-1",
        kind: "incident",
        incident_id: "inc-stale",
        provider: null,
        account: null,
        status: null,
        detail: null,
      },
    ];

    const stats = store.aggregateMachineStats(rows, "all", now);
    const mStats = stats.get("m-1");
    expect(mStats?.incidents).toBe(2);
    expect(mStats?.late).toBe(1); // Only the 15m1s incident is late
  });
});

describe("ReliabilityHistoryStore singleton and persistence", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-history-test-"));
    process.env.PI_CODING_AGENT_DIR = tempDir;
    delete process.env.OMP_TOOLKIT_HISTORY_DB;
    resetHistoryCachesForTest();
    closeHistory();
  });

  afterEach(() => {
    closeHistory();
    resetHistoryCachesForTest();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup.
    }
  });

  test("creates database and inserts a single event with machine id", () => {
    recordEvents([
      {
        at: 1_700_000_000_000,
        kind: "session_start",
        detail: "test",
      },
    ]);

    const file = getHistoryStore().dbPath;
    expect(fs.existsSync(file)).toBe(true);

    const db = new Database(file, { readonly: true });
    const rows = db.query("SELECT * FROM events").all() as Array<{
      id: number;
      at: number;
      machine_id: string;
      kind: string;
      detail: string;
    }>;
    db.close();

    expect(rows.length).toBe(1);
    expect(rows[0].at).toBe(1_700_000_000_000);
    expect(rows[0].kind).toBe("session_start");
    expect(rows[0].detail).toBe("test");
    expect(rows[0].machine_id).toBe(getHistoryStore().machineId());
    expect(rows[0].machine_id.length).toBeGreaterThan(10);
  });

  test("machineId returns the same id on repeated calls and writes machine file", () => {
    const id1 = getHistoryStore().machineId();
    const id2 = getHistoryStore().machineId();
    expect(id1).toBe(id2);

    const machineFile = path.join(tempDir, "omp-toolkit-machine.json");
    expect(fs.existsSync(machineFile)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(machineFile, "utf8"));
    expect(parsed.id).toBe(id1);
    expect(parsed.hostname).toBe(os.hostname());
    expect(typeof parsed.createdAt).toBe("number");
  });

  test("recordEvents inserts multiple rows in a single call", () => {
    recordEvents([
      { at: 1_700_000_000_001, kind: "route_check", status: "ok" },
      { at: 1_700_000_000_002, kind: "policy_change", detail: "heal" },
    ]);

    const db = new Database(getHistoryStore().dbPath, { readonly: true });
    const count = db.query("SELECT count(*) as count FROM events").get() as { count: number };
    db.close();

    expect(count.count).toBe(2);
  });

  test("deletes events older than 30 days upon database reopen", () => {
    const staleTime = Date.now() - 31 * 24 * 60 * 60 * 1_000;
    recordEvents([
      {
        at: staleTime,
        kind: "route_check",
        status: "ok",
      },
    ]);

    closeHistory();

    // Reopen and trigger retention by recording a fresh event
    recordEvents([
      {
        at: Date.now(),
        kind: "session_start",
      },
    ]);

    const db = new Database(getHistoryStore().dbPath, { readonly: true });
    const staleRows = db.query("SELECT * FROM events WHERE at = ?").all(staleTime);
    const allRows = db.query("SELECT count(*) as count FROM events").get() as { count: number };
    db.close();

    expect(staleRows.length).toBe(0);
    expect(allRows.count).toBe(1);
  });

  test("throws when machine identity file is corrupt and error contains file path", () => {
    const machineFile = path.join(tempDir, "omp-toolkit-machine.json");
    fs.writeFileSync(machineFile, "{ corrupt json ...", "utf8");

    expect(() => {
      recordEvents([{ at: Date.now(), kind: "session_start" }]);
    }).toThrow(machineFile);
  });

  test("recordEvents([]) does not create a database file", () => {
    recordEvents([]);
    expect(fs.existsSync(getHistoryStore().dbPath)).toBe(false);
  });
});
