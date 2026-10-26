import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  closeHistory,
  historyPath,
  machineId,
  recordEvent,
  recordEvents,
  resetHistoryCachesForTest,
} from "./history-store";

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

describe("extension history adapter", () => {
  test("creates database and inserts a single event with machine id", () => {
    recordEvent({
      at: 1_700_000_000_000,
      kind: "session_start",
      detail: "test",
    });

    const file = historyPath();
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
    expect(rows[0].machine_id).toBe(machineId());
    expect(rows[0].machine_id.length).toBeGreaterThan(10);
  });

  test("machineId returns the same id on repeated calls and writes machine file", () => {
    const id1 = machineId();
    const id2 = machineId();
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

    const db = new Database(historyPath(), { readonly: true });
    const count = db.query("SELECT count(*) as count FROM events").get() as { count: number };
    db.close();

    expect(count.count).toBe(2);
  });

  test("deletes events older than 30 days upon database reopen", () => {
    const staleTime = Date.now() - 31 * 24 * 60 * 60 * 1_000;
    recordEvent({
      at: staleTime,
      kind: "route_check",
      status: "ok",
    });

    closeHistory();

    // Reopen and trigger retention by recording a fresh event
    recordEvent({
      at: Date.now(),
      kind: "session_start",
    });

    const db = new Database(historyPath(), { readonly: true });
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
      recordEvent({ at: Date.now(), kind: "session_start" });
    }).toThrow(machineFile);
  });

  test("recordEvents([]) does not create a database file", () => {
    recordEvents([]);
    expect(fs.existsSync(historyPath())).toBe(false);
  });
});
