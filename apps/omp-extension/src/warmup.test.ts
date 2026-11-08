import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Account, HealthSnapshot, ProbeResult } from "@omp-toolkit/core";
import {
  runWarmUp,
  WARMUP_LOCK_STALE_MS,
  type WarmUpAdapter,
  type WarmUpDependencies,
} from "./warmup";

describe("warm-up orchestrator", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-warmup-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  const accounts: Account[] = [
    { index: 1, email: "alpha@example.com", project: "p1" },
    { index: 2, email: "bravo@example.com", project: "p2" },
    { index: 3, email: "charlie@example.com", project: "p3" },
  ];

  function makeAdapter(probeImpl?: (account: Account) => Promise<ProbeResult>): WarmUpAdapter {
    return {
      provider: "google-antigravity",
      model: "gemini-3.8-flash-high",
      loadAccounts: async () => accounts,
      probe:
        probeImpl ??
        (async (account: Account) => ({
          ...account,
          provider: "google-antigravity",
          model: "gemini-3.8-flash-high",
          status: "ok",
          ms: 100,
          startedAt: 1000,
          checkedAt: 1100,
          failureKind: null,
          confirmed: false,
        })),
    };
  }

  test("warm all probes only ok/unknown accounts, skips non-OK, and records results", async () => {
    const probed: string[] = [];
    const adapter = makeAdapter(async (account) => {
      probed.push(account.email);
      return {
        ...account,
        provider: "google-antigravity",
        model: "gemini-3.8-flash-high",
        status: "ok",
        ms: 50,
        startedAt: 1000,
        checkedAt: 1050,
        failureKind: null,
        confirmed: false,
      };
    });

    const recorded: ProbeResult[][] = [];
    const snapshot: HealthSnapshot = {
      schemaVersion: 2,
      probeModel: "gemini-3.8-flash-high",
      sweepStartedAt: 1000,
      checkedAt: 1050,
      results: [
        {
          provider: "google-antigravity",
          email: "alpha@example.com",
          project: "p1",
          model: "gemini-3.8-flash-high",
          status: "ok",
          ms: 50,
          startedAt: 1000,
          checkedAt: 1050,
          failureKind: null,
          confirmed: false,
        },
        {
          provider: "google-antigravity",
          email: "bravo@example.com",
          project: "p2",
          model: "gemini-3.8-flash-high",
          status: "hang",
          ms: 15000,
          startedAt: 1000,
          checkedAt: 16000,
          failureKind: "timeout",
          confirmed: true,
        },
        // charlie is absent -> unknown -> eligible
      ],
      streaks: {},
    };
    const deps: WarmUpDependencies = {
      agentDir: tmpDir,
      adapters: new Map([[adapter.provider, adapter]]),
      readSnapshot: () => snapshot,
      recordHealth: (results) => {
        recorded.push(results);
      },
      sleep: async () => {},
    };

    const run = await runWarmUp(deps, {
      provider: "google-antigravity",
      action: "warm",
      all: true,
    });

    expect(probed).toEqual(["alpha@example.com", "charlie@example.com"]);
    expect(run.report.results).toHaveLength(2);
    expect(run.report.skipped).toEqual([
      { account: "bravo@example.com", status: "hang", reason: "non-ok" },
    ]);
    expect(recorded).toHaveLength(2);
  });

  test("a second immediate warm-up returns a cooldown skip", async () => {
    const adapter = makeAdapter();
    const deps: WarmUpDependencies = {
      agentDir: tmpDir,
      adapters: new Map([[adapter.provider, adapter]]),
      readSnapshot: () => ({
        schemaVersion: 2,
        probeModel: "gemini-3.8-flash-high",
        sweepStartedAt: null,
        checkedAt: 1000,
        results: [],
        streaks: {},
      }),
      recordHealth: () => {},
      sleep: async () => {},
    };

    const run1 = await runWarmUp(deps, {
      provider: "google-antigravity",
      action: "warm",
      account: "alpha@example.com",
    });
    expect(run1.report.results).toHaveLength(1);
    expect(run1.report.skipped).toHaveLength(0);

    const run2 = await runWarmUp(deps, {
      provider: "google-antigravity",
      action: "warm",
      account: "alpha@example.com",
    });
    expect(run2.report.results).toHaveLength(0);
    expect(run2.report.skipped).toEqual([
      { account: "alpha@example.com", status: null, reason: "cooldown" },
    ]);
  });

  test("check action bypasses cooldown and probes non-OK accounts", async () => {
    let probes = 0;
    const adapter = makeAdapter(async (account) => {
      probes++;
      return {
        ...account,
        provider: "google-antigravity",
        model: "gemini-3.8-flash-high",
        status: "ok",
        ms: 80,
        startedAt: 1000,
        checkedAt: 1080,
        failureKind: null,
        confirmed: false,
      };
    });

    const snapshot: HealthSnapshot = {
      schemaVersion: 2,
      probeModel: "gemini-3.8-flash-high",
      sweepStartedAt: 1000,
      checkedAt: 16000,
      results: [
        {
          provider: "google-antigravity",
          email: "bravo@example.com",
          project: "p2",
          model: "gemini-3.8-flash-high",
          status: "hang",
          ms: 15000,
          startedAt: 1000,
          checkedAt: 16000,
          failureKind: "timeout",
          confirmed: true,
        },
      ],
      streaks: {},
    };
    const deps: WarmUpDependencies = {
      agentDir: tmpDir,
      adapters: new Map([[adapter.provider, adapter]]),
      readSnapshot: () => snapshot,
      recordHealth: () => {},
      sleep: async () => {},
    };

    const run = await runWarmUp(deps, {
      provider: "google-antigravity",
      action: "check",
      account: "bravo@example.com",
    });

    expect(probes).toBe(1);
    expect(run.report.results).toHaveLength(1);
    expect(run.report.results[0].status).toBe("ok");
    expect(run.report.skipped).toHaveLength(0);
  });

  test("a failing probe converts to error, continues to next target without retrying", async () => {
    const probed: string[] = [];
    const adapter = makeAdapter(async (account) => {
      probed.push(account.email);
      if (account.email === "alpha@example.com") {
        throw new Error("simulated probe network failure");
      }
      return {
        ...account,
        provider: "google-antigravity",
        model: "gemini-3.8-flash-high",
        status: "ok",
        ms: 50,
        startedAt: 1000,
        checkedAt: 1050,
        failureKind: null,
        confirmed: false,
      };
    });

    const deps: WarmUpDependencies = {
      agentDir: tmpDir,
      adapters: new Map([[adapter.provider, adapter]]),
      readSnapshot: () => ({
        schemaVersion: 2,
        probeModel: "gemini-3.8-flash-high",
        sweepStartedAt: null,
        checkedAt: 1000,
        results: [],
        streaks: {},
      }),
      recordHealth: () => {},
      sleep: async () => {},
    };

    const run = await runWarmUp(deps, {
      provider: "google-antigravity",
      action: "warm",
      all: true,
    });

    expect(probed).toEqual(["alpha@example.com", "bravo@example.com", "charlie@example.com"]);
    expect(run.report.results).toHaveLength(3);
    expect(run.report.results[0].status).toBe("error");
    expect(run.report.results[0].detail).toContain("simulated probe network failure");
    expect(run.report.results[1].status).toBe("ok");
  });

  test("runWarmUp rejects if lock is held and recovers stale lock", async () => {
    const adapter = makeAdapter();
    const deps: WarmUpDependencies = {
      agentDir: tmpDir,
      adapters: new Map([[adapter.provider, adapter]]),
      readSnapshot: () => ({
        schemaVersion: 2,
        probeModel: "gemini-3.8-flash-high",
        sweepStartedAt: null,
        checkedAt: 1000,
        results: [],
        streaks: {},
      }),
      recordHealth: () => {},
      sleep: async () => {},
    };

    const lockPath = path.join(tmpDir, "gemini-warmup.lock");
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        token: "holder",
        pid: process.pid,
        machineId: "mach-1",
        operation: "gemini-warmup",
        acquiredAt: Date.now(),
      }),
      "utf8",
    );

    // Fresh lock -> rejects with "another warm-up is already running"
    await expect(
      runWarmUp(deps, {
        provider: "google-antigravity",
        action: "check",
        account: "alpha@example.com",
      }),
    ).rejects.toThrow("another warm-up is already running");

    // Backdate lock past WARMUP_LOCK_STALE_MS
    const staleTime = (Date.now() - (WARMUP_LOCK_STALE_MS + 10_000)) / 1000;
    fs.utimesSync(lockPath, staleTime, staleTime);
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        token: "holder",
        pid: process.pid,
        machineId: "mach-1",
        operation: "gemini-warmup",
        acquiredAt: Date.now() - (WARMUP_LOCK_STALE_MS + 10_000),
      }),
      "utf8",
    );
    fs.utimesSync(lockPath, staleTime, staleTime);

    // Stale lock recovered -> proceeds
    const res = await runWarmUp(deps, {
      provider: "google-antigravity",
      action: "check",
      account: "alpha@example.com",
    });
    expect(res.report.results).toHaveLength(1);
    expect(res.report.results[0].status).toBe("ok");
  });
});
