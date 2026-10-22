import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Account, HealthSnapshot, ProbeResult } from "@omp-toolkit/core";
import { runWarmUp, type WarmUpAdapter, type WarmUpDependencies, withWarmUpLock } from "./warmup";

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
      loadAccounts: async () => accounts,
      probe:
        probeImpl ??
        (async (account: Account) => ({
          ...account,
          status: "ok",
          ms: 100,
        })),
    };
  }

  test("warm all probes only ok/unknown accounts, skips non-OK, and records results", async () => {
    const probed: string[] = [];
    const adapter = makeAdapter(async (account) => {
      probed.push(account.email);
      return { ...account, status: "ok", ms: 50 };
    });

    const recorded: ProbeResult[][] = [];
    const snapshot: HealthSnapshot = {
      checkedAt: 1000,
      results: [
        { email: "alpha@example.com", status: "ok", ms: 50 },
        { email: "bravo@example.com", status: "hang", ms: 15000 },
        // charlie is absent -> unknown -> eligible
      ],
    };

    const deps: WarmUpDependencies = {
      agentDir: tmpDir,
      adapters: new Map([[adapter.provider, adapter]]),
      readSnapshot: () => snapshot,
      recordHealth: (results) => recorded.push(results),
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
      readSnapshot: () => ({ checkedAt: 1000, results: [] }),
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
      return { ...account, status: "ok", ms: 80 };
    });

    const snapshot: HealthSnapshot = {
      checkedAt: 1000,
      results: [{ email: "bravo@example.com", status: "hang", ms: 15000 }],
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
      return { ...account, status: "ok", ms: 50 };
    });

    const deps: WarmUpDependencies = {
      agentDir: tmpDir,
      adapters: new Map([[adapter.provider, adapter]]),
      readSnapshot: () => ({ checkedAt: 1000, results: [] }),
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

  test("withWarmUpLock rejects concurrent acquisition and allows sequential", async () => {
    const { promise: lockAcquired, resolve: markAcquired } = Promise.withResolvers<void>();
    const { promise: blockPromise, resolve: unblock } = Promise.withResolvers<void>();

    const run1 = withWarmUpLock(tmpDir, async () => {
      markAcquired();
      await blockPromise;
      return "done1";
    });

    await lockAcquired;

    await expect(withWarmUpLock(tmpDir, async () => "done2")).rejects.toThrow(
      "another warm-up is already running",
    );

    unblock();
    expect(await run1).toBe("done1");

    const run3 = await withWarmUpLock(tmpDir, async () => "done3");
    expect(run3).toBe("done3");
  });
});
