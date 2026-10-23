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
});
