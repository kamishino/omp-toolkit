import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Account, DEFAULT_MODEL_WIRE, type Policy, type ProbeResult } from "@omp-toolkit/core";
import { AntigravityHealthManager, incidentKindForError } from "./health-manager";
import type { ReliabilityHistoryStore } from "./history-store";
import type { RoutingPolicyStore } from "./policy-store";
import type { AntigravityProbeClient } from "./probe-client";

describe("AntigravityHealthManager deep recovery coordinator", () => {
  const model = DEFAULT_MODEL_WIRE;

  const makeProbeResult = (
    index: number,
    email: string,
    status: ProbeResult["status"],
    failureKind: ProbeResult["failureKind"],
    options: {
      ms?: number;
      startedAt?: number;
      checkedAt?: number;
      confirmed?: boolean;
      project?: string;
    } = {},
  ): ProbeResult => ({
    index,
    provider: "google-antigravity",
    email,
    project: options.project ?? "p1",
    model,
    status,
    ms: options.ms ?? (status === "hang" ? 15000 : 50),
    startedAt: options.startedAt ?? 1000,
    checkedAt: options.checkedAt ?? 1050,
    failureKind,
    confirmed: options.confirmed ?? status === "hang",
  });

  test("initializes with default policy store and probe client", () => {
    const manager = new AntigravityHealthManager();
    expect(manager.probeClient).toBeDefined();
    expect(manager.policyStore).toBeDefined();
    expect(manager.historyStore).toBeDefined();
  });

  test("accepts injected mock client for headless verification", async () => {
    const mockResults: ProbeResult[] = [
      makeProbeResult(1, "alpha@example.com", "ok", null),
      makeProbeResult(2, "beta@example.com", "hang", "timeout"),
    ];

    const mockProbeClient = {
      modelWire: model,
      checkAll: async () => ({ startedAt: 1000, results: mockResults }),
      probe: async (acc: Account) => makeProbeResult(acc.index, acc.email, "ok", null),
      loadAccounts: async () => [
        { index: 1, email: "alpha@example.com", project: "p1" },
        { index: 2, email: "beta@example.com", project: "p1" },
      ],
    } as unknown as AntigravityProbeClient;

    const manager = new AntigravityHealthManager({
      probeClient: mockProbeClient,
    });

    const checked = await manager.checkAll();
    expect(checked).toEqual(mockResults);

    const accounts = await manager.loadAccounts();
    expect(accounts.length).toBe(2);

    const probed = await manager.probe({ index: 1, email: "alpha@example.com", project: "p1" });
    expect(probed.status).toBe("ok");
  });

  test("recordHealth manages watermarking, pruning, and does not trigger all-failed on partial cold start", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hm-watermark-"));
    try {
      const manager = new AntigravityHealthManager({
        agentDir: tempDir,
        historyStore: { recordEvents: () => {} } as unknown as ReliabilityHistoryStore,
      });

      // 1. Partial check cold start: 1 failing account
      const failingPartial = [
        makeProbeResult(1, "failing@example.com", "hang", "timeout", {
          startedAt: 1000,
          checkedAt: 1050,
        }),
      ];
      await manager.recordHealth(failingPartial, { scope: "partial" });

      const snap1 = manager.readSnapshot();
      expect(snap1).not.toBeNull();
      // Partial check MUST NOT trigger all-failed incident!
      expect(snap1?.incident).toBeUndefined();
      expect(snap1?.results.length).toBe(1);

      // 2. Full sweep with 2 accounts (alpha OK, beta OK)
      const fullSweep = [
        makeProbeResult(1, "alpha@example.com", "ok", null, { startedAt: 2000, checkedAt: 2050 }),
        makeProbeResult(2, "beta@example.com", "ok", null, { startedAt: 2000, checkedAt: 2050 }),
      ];
      await manager.recordHealth(fullSweep, { scope: "full", startedAt: 2000 });

      const snap2 = manager.readSnapshot();
      expect(snap2?.sweepStartedAt).toBe(2000);
      // failing@example.com (startedAt 1000 <= 2000) was absent and must be pruned
      expect(snap2?.results.map((r) => r.email).sort()).toEqual([
        "alpha@example.com",
        "beta@example.com",
      ]);

      // 3. Complete sweep where all accounts fail triggers all-failed
      const allFailSweep = [
        makeProbeResult(1, "alpha@example.com", "hang", "timeout", {
          startedAt: 3000,
          checkedAt: 3050,
        }),
        makeProbeResult(2, "beta@example.com", "error", "transient", {
          startedAt: 3000,
          checkedAt: 3050,
        }),
      ];
      await manager.recordHealth(allFailSweep, { scope: "full", startedAt: 3000 });

      const snap3 = manager.readSnapshot();
      expect(snap3?.incident?.kind).toBe("all-failed");

      // 4. Fresh partial check recovery on alpha resolves all-failed
      const recoveredAlpha = [
        makeProbeResult(1, "alpha@example.com", "ok", null, { startedAt: 4000, checkedAt: 4050 }),
      ];
      await manager.recordHealth(recoveredAlpha, { scope: "partial" });

      const snap4 = manager.readSnapshot();
      expect(snap4?.incident).toBeUndefined();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("applyHeal applies exclusion only with confirmed retryable failure and fresh healthy alternative", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hm-heal-rules-"));
    try {
      let policies: Policy[] = [];
      const mockPolicyStore = {
        readPolicies: async () => policies,
        readPoliciesStrict: async () => policies,
        writePolicies: async (p: Policy[]) => {
          policies = p;
        },
      };

      const now = 1_000_000;
      const manager = new AntigravityHealthManager({
        agentDir: tempDir,
        policyStore: mockPolicyStore as unknown as RoutingPolicyStore,
        historyStore: { recordEvents: () => {} } as unknown as ReliabilityHistoryStore,
        now: () => now,
      });

      // Scenario A: beta hangs, but alpha has auth error (not OK) -> NO healthy alternative
      const resultsNoAlt: ProbeResult[] = [
        makeProbeResult(1, "alpha@example.com", "auth", "auth", {
          startedAt: now - 100,
          checkedAt: now,
        }),
        makeProbeResult(2, "beta@example.com", "hang", "timeout", {
          startedAt: now - 100,
          checkedAt: now,
          confirmed: true,
        }),
      ];
      await manager.recordHealth(resultsNoAlt, { scope: "full", startedAt: now - 100 });

      const actionA = await manager.applyHeal(resultsNoAlt, "heal");
      expect(actionA.changed).toEqual([]);
      expect(actionA.reason).toContain(
        "no fresh routable healthy alternative; no exclusion applied",
      );
      expect(policies.length).toBe(0);

      // Scenario B: alpha is OK, beta hangs with confirmed: true -> exclusion applied!
      const resultsWithAlt: ProbeResult[] = [
        makeProbeResult(1, "alpha@example.com", "ok", null, {
          startedAt: now - 100,
          checkedAt: now,
        }),
        makeProbeResult(2, "beta@example.com", "hang", "timeout", {
          startedAt: now - 100,
          checkedAt: now,
          confirmed: true,
        }),
      ];
      await manager.recordHealth(resultsWithAlt, { scope: "full", startedAt: now - 100 });

      const actionB = await manager.applyHeal(resultsWithAlt, "heal");
      expect(actionB.changed).toEqual(["beta@example.com"]);
      expect(policies.length).toBe(1);
      expect(policies[0]).toEqual({
        provider: "google-antigravity",
        account: { email: "beta@example.com" },
        reservePct: 100,
      });
      expect(manager.readState().excluded).toEqual(["beta@example.com"]);

      // Scenario C: matching user policy exists (reservePct: 20, priority: 2) -> NEVER overwritten
      policies = [
        {
          provider: "google-antigravity",
          account: { email: "user-policy@example.com" },
          reservePct: 20,
          priority: 2,
        },
      ];
      const resultsUserPolicy: ProbeResult[] = [
        makeProbeResult(1, "alpha@example.com", "ok", null, {
          startedAt: now - 100,
          checkedAt: now,
        }),
        makeProbeResult(3, "user-policy@example.com", "hang", "timeout", {
          startedAt: now - 100,
          checkedAt: now,
          confirmed: true,
        }),
      ];
      await manager.recordHealth(resultsUserPolicy, { scope: "full", startedAt: now - 100 });

      const actionC = await manager.applyHeal(resultsUserPolicy, "heal");
      expect(actionC.changed).toEqual([]);
      expect(actionC.skipped).toEqual(["user-policy@example.com"]);
      // User policy preserved exactly with priority: 2
      expect(policies[0].reservePct).toBe(20);
      expect(policies[0].priority).toBe(2);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("restoreManaged and maybeRestoreManaged atomic snapshot streaks persistence and policy preservation", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hm-restore-"));
    try {
      let policies: Policy[] = [
        {
          provider: "google-antigravity",
          account: { email: "managed@example.com" },
          reservePct: 100,
        },
        {
          provider: "google-antigravity",
          account: { email: "manual@example.com" },
          reservePct: 100,
          priority: 5,
        },
      ];

      const mockPolicyStore = {
        readPolicies: async () => policies,
        readPoliciesStrict: async () => policies,
        writePolicies: async (p: Policy[]) => {
          policies = p;
        },
      };

      const now = 2_000_000;
      const manager = new AntigravityHealthManager({
        agentDir: tempDir,
        policyStore: mockPolicyStore as unknown as RoutingPolicyStore,
        historyStore: { recordEvents: () => {} } as unknown as ReliabilityHistoryStore,
        now: () => now,
      });

      // Seed snapshot with streaks
      const results: ProbeResult[] = [
        makeProbeResult(1, "managed@example.com", "ok", null, {
          startedAt: now - 100,
          checkedAt: now,
        }),
        makeProbeResult(2, "manual@example.com", "ok", null, {
          startedAt: now - 100,
          checkedAt: now,
        }),
      ];
      await manager.recordHealth(results, { scope: "full", startedAt: now - 100 });

      // Seed streaks in snapshot
      const snap = manager.readSnapshot();
      if (!snap) throw new Error("expected snapshot");
      const keyManaged = JSON.stringify(["google-antigravity", "managed@example.com", "p1", model]);
      const keyManual = JSON.stringify(["google-antigravity", "manual@example.com", "p1", model]);
      snap.streaks[keyManaged] = { ok: 3, firstAt: now - 180_000, lastAt: now };
      snap.streaks[keyManual] = { ok: 3, firstAt: now - 180_000, lastAt: now };
      fs.writeFileSync(
        path.join(tempDir, "gemini-health-latest.json"),
        JSON.stringify(snap, null, 2),
      );

      manager.writeState({ schemaVersion: 2, excluded: ["managed@example.com"], pending: [] });
      manager.writeAutoRestore({ enabled: ["manual@example.com"] });

      // maybeRestoreManaged
      const restored = await manager.maybeRestoreManaged();
      expect(restored.sort()).toEqual(["managed@example.com", "manual@example.com"]);

      // Managed exclusion was deleted completely
      expect(policies.find((p) => p.account?.email === "managed@example.com")).toBeUndefined();

      // Manual exclusion had reservePct removed, but priority: 5 preserved!
      const preservedManual = policies.find((p) => p.account?.email === "manual@example.com");
      expect(preservedManual).toBeDefined();
      expect(preservedManual?.reservePct).toBeUndefined();
      expect(preservedManual?.priority).toBe(5);

      // Streaks in snapshot were atomically cleared on disk
      const snapAfter = manager.readSnapshot();
      expect(snapAfter?.streaks[keyManaged]).toBeUndefined();
      expect(snapAfter?.streaks[keyManual]).toBeUndefined();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("removeExclusion refuses without fresh OK unless force: true", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hm-remove-"));
    try {
      let policies: Policy[] = [
        {
          provider: "google-antigravity",
          account: { email: "user@example.com" },
          reservePct: 100,
        },
      ];

      const mockPolicyStore = {
        readPolicies: async () => policies,
        readPoliciesStrict: async () => policies,
        writePolicies: async (p: Policy[]) => {
          policies = p;
        },
      };

      const now = 3_000_000;
      const manager = new AntigravityHealthManager({
        agentDir: tempDir,
        policyStore: mockPolicyStore as unknown as RoutingPolicyStore,
        now: () => now,
      });

      const account: Account = { index: 1, email: "user@example.com", project: "p1" };

      // No evidence in snapshot -> refuses
      await expect(manager.removeExclusion(account)).rejects.toThrow(
        "fresh OK route evidence required",
      );

      // Seed stale evidence in snapshot (>15 min old)
      const staleResult = makeProbeResult(1, "user@example.com", "ok", null, {
        startedAt: now - 20 * 60_000,
        checkedAt: now - 20 * 60_000,
      });
      await manager.recordHealth([staleResult], { scope: "partial" });

      // Stale evidence -> refuses
      await expect(manager.removeExclusion(account)).rejects.toThrow(
        "fresh OK route evidence required",
      );

      // With force: true -> succeeds!
      await expect(manager.removeExclusion(account, { force: true })).resolves.toBeUndefined();
      expect(policies.length).toBe(0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("setAutoRestore updates sidecar atomically under lock", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hm-sidecar-"));
    try {
      const manager = new AntigravityHealthManager({ agentDir: tempDir });
      await manager.setAutoRestore("alpha@example.com", true);
      expect(manager.readAutoRestore().enabled).toEqual(["alpha@example.com"]);

      await manager.setAutoRestore("alpha@example.com", false);
      expect(manager.readAutoRestore().enabled).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("incidentKindForError identifies lock_timeout correctly", () => {
    expect(incidentKindForError(new Error("lock_timeout: operation timed out"))).toBe(
      "lock-timeout",
    );
    expect(incidentKindForError(new Error("database is locked"))).toBeNull();
    expect(incidentKindForError("string error")).toBeNull();
  });
});
