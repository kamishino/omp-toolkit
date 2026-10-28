import { describe, expect, test } from "bun:test";
import type { Account, Policy, ProbeResult } from "@omp-toolkit/core";
import { AntigravityHealthManager, incidentKindForError } from "./health-manager";
import type { HistoryEventInput, ReliabilityHistoryStore } from "./history-store";
import type { RoutingPolicyStore } from "./policy-store";
import type { AntigravityProbeClient } from "./probe-client";

describe("AntigravityHealthManager deep recovery coordinator", () => {
  test("initializes with default policy store and probe client", () => {
    const manager = new AntigravityHealthManager();
    expect(manager.probeClient).toBeDefined();
    expect(manager.policyStore).toBeDefined();
    expect(manager.historyStore).toBeDefined();
  });

  test("accepts injected mock client for headless verification", async () => {
    const mockResults: ProbeResult[] = [
      { index: 1, email: "alpha@example.com", project: "p1", status: "ok", ms: 40 },
      { index: 2, email: "beta@example.com", project: "p2", status: "hang", ms: 12000 },
    ];

    const mockProbeClient = {
      checkAll: async () => mockResults,
      probe: async (acc: Account) => ({ ...acc, status: "ok" as const, ms: 50 }),
      loadAccounts: async () => [
        { index: 1, email: "alpha@example.com", project: "p1" },
        { index: 2, email: "beta@example.com", project: "p2" },
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

  test("applies healing logic across check results", async () => {
    const manager = new AntigravityHealthManager();
    const action = await manager.applyHeal([]);
    expect(action.reason).toBe("no accounts to check");

    const healthyAction = await manager.applyHeal([
      { index: 1, email: "ok@example.com", project: "p1", status: "ok", ms: 30 },
    ]);
    expect(healthyAction.reason).toBe("all accounts healthy");
  });
  test("applyHeal applies reservePct=100 for minority failure and skips already excluded", async () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hm-heal-"));

    try {
      let policies: Policy[] = [];
      const recordedHistory: HistoryEventInput[] = [];
      const mockPolicyStore = {
        readPolicies: async () => policies,
        writePolicies: async (p: Policy[]) => {
          policies = p;
        },
      };
      const mockHistoryStore = {
        recordEvents: (events: HistoryEventInput[]) => {
          recordedHistory.push(...events);
        },
      };

      const manager = new AntigravityHealthManager({
        agentDir: tempDir,
        policyStore: mockPolicyStore as unknown as RoutingPolicyStore,
        historyStore: mockHistoryStore as unknown as ReliabilityHistoryStore,
      });

      // Minority failure: alpha is OK, beta hangs
      const results: ProbeResult[] = [
        { index: 1, email: "alpha@example.com", project: "p1", status: "ok", ms: 40 },
        { index: 2, email: "beta@example.com", project: "p2", status: "hang", ms: 15000 },
      ];

      const action = await manager.applyHeal(results, "heal");
      expect(action.changed).toEqual(["beta@example.com"]);
      expect(action.skipped).toEqual([]);
      expect(action.reason).toContain("temporary reservePct=100 applied");

      // Verified policy written
      expect(policies.length).toBe(1);
      expect(policies[0]?.account?.email).toBe("beta@example.com");
      expect(policies[0]?.reservePct).toBe(100);

      // Verified state written
      expect(manager.readState().excluded).toEqual(["beta@example.com"]);

      // Verified policy_change history event
      expect(
        recordedHistory.some((e) => e.kind === "policy_change" && e.account === "beta@example.com"),
      ).toBe(true);

      // Repeat heal when beta is already managed -> no new change
      const repeatAction = await manager.applyHeal(results, "heal");
      expect(repeatAction.changed).toEqual([]);
      expect(policies.length).toBe(1);

      // Unmanaged manual exclusion -> skipped
      policies.push({
        provider: "google-antigravity",
        account: { email: "manual@example.com" },
        reservePct: 100,
      });
      const resultsWithManual: ProbeResult[] = [
        { index: 1, email: "alpha@example.com", project: "p1", status: "ok", ms: 40 },
        { index: 3, email: "manual@example.com", project: "p3", status: "hang", ms: 15000 },
      ];
      const manualAction = await manager.applyHeal(resultsWithManual, "heal");
      expect(manualAction.changed).toEqual([]);
      expect(manualAction.skipped).toEqual(["manual@example.com"]);
      expect(manualAction.reason).toContain("failing accounts already have exclusions/policies");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("resolveAccount prioritizes exact match and resolves unique prefix", async () => {
    const accounts = [
      { index: 1, email: "alpha@example.com", project: "p1" },
      { index: 2, email: "beta@example.com", project: "p2" },
      { index: 3, email: "alpha.work@example.com", project: "p3" },
    ];

    const manager = new AntigravityHealthManager({
      probeClient: {
        loadAccounts: async () => accounts,
      } as unknown as AntigravityProbeClient,
    });

    // Exact email
    const exact = await manager.resolveAccount("beta@example.com");
    expect(exact.status).toBe("found");
    if (exact.status === "found") expect(exact.account.index).toBe(2);

    // Unique prefix
    const prefix = await manager.resolveAccount("beta");
    expect(prefix.status).toBe("found");
    if (prefix.status === "found") expect(prefix.account.index).toBe(2);

    // Not found
    const notFound = await manager.resolveAccount("gamma");
    expect(notFound.status).toBe("not_found");

    // Empty
    const empty = await manager.resolveAccount("   ");
    expect(empty.status).toBe("not_found");
  });

  test("resolveAccount reports ambiguous for duplicate local parts", async () => {
    const accounts = [
      { index: 1, email: "dev@work.com", project: "p1" },
      { index: 2, email: "dev@personal.com", project: "p2" },
    ];

    const manager = new AntigravityHealthManager({
      probeClient: {
        loadAccounts: async () => accounts,
      } as unknown as AntigravityProbeClient,
    });

    const res = await manager.resolveAccount("dev");
    expect(res.status).toBe("ambiguous");
    if (res.status === "ambiguous") {
      expect(res.matches.length).toBe(2);
    }
  });
  test("auto-restore sidecar read and write with corrupt detection", () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hm-test-"));
    try {
      const manager = new AntigravityHealthManager({ agentDir: tempDir });
      // File absent
      expect(manager.readAutoRestore()).toEqual({ enabled: [] });

      // Write sidecar
      manager.writeAutoRestore({ enabled: ["test@example.com", "other@example.com"] });
      expect(manager.readAutoRestore()).toEqual({
        enabled: ["test@example.com", "other@example.com"],
      });

      // Corrupt content throws
      const file = path.join(tempDir, "gemini-health-auto-restore.json");
      fs.writeFileSync(file, "{ invalid json", "utf8");
      expect(() => manager.readAutoRestore()).toThrow("corrupt auto-restore sidecar");

      fs.writeFileSync(file, JSON.stringify({ enabled: "not-an-array" }), "utf8");
      expect(() => manager.readAutoRestore()).toThrow("corrupt auto-restore sidecar");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("hasExclusionsToRecover checks managed and opted-in manual exclusions", async () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hm-rec-"));
    try {
      let policies: Policy[] = [];
      const mockPolicyStore = {
        readPolicies: async () => policies,
        writePolicies: async (p: Policy[]) => {
          policies = p;
        },
      };
      const manager = new AntigravityHealthManager({
        agentDir: tempDir,
        policyStore: mockPolicyStore as unknown as RoutingPolicyStore,
      });

      // Initially false
      expect(await manager.hasExclusionsToRecover()).toBe(false);

      // Managed exclusion -> true
      manager.writeState({ excluded: ["managed@example.com"] });
      expect(await manager.hasExclusionsToRecover()).toBe(true);

      // Clear managed, add manual without opt-in -> false
      manager.writeState({ excluded: [] });
      policies = [
        {
          provider: "google-antigravity",
          account: { email: "manual@example.com" },
          reservePct: 100,
        },
      ];
      expect(await manager.hasExclusionsToRecover()).toBe(false);

      // Opt-in manual -> true
      manager.writeAutoRestore({ enabled: ["manual@example.com"] });
      expect(await manager.hasExclusionsToRecover()).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("maybeRestoreManaged restores opted-in manual and managed exclusions and preserves sidecar", async () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hm-rest-"));
    try {
      let policies: Policy[] = [
        {
          provider: "google-antigravity",
          account: { email: "managed@example.com" },
          reservePct: 100,
        },
        {
          provider: "google-antigravity",
          account: { email: "manual-opted@example.com" },
          reservePct: 100,
        },
        {
          provider: "google-antigravity",
          account: { email: "manual-not-opted@example.com" },
          reservePct: 100,
        },
      ];
      const mockPolicyStore = {
        readPolicies: async () => policies,
        writePolicies: async (p: Policy[]) => {
          policies = p;
        },
      };
      const manager = new AntigravityHealthManager({
        agentDir: tempDir,
        policyStore: mockPolicyStore as unknown as RoutingPolicyStore,
      });

      manager.writeState({ excluded: ["managed@example.com"] });
      manager.writeAutoRestore({ enabled: ["manual-opted@example.com"] });
      manager.writeStreaks({
        "managed@example.com": { ok: 3, lastAt: Date.now() },
        "manual-opted@example.com": { ok: 3, lastAt: Date.now() },
        "manual-not-opted@example.com": { ok: 3, lastAt: Date.now() },
      });

      const restored = await manager.maybeRestoreManaged();
      expect(restored.sort()).toEqual(["managed@example.com", "manual-opted@example.com"]);

      // Managed removed from state
      expect(manager.readState().excluded).toEqual([]);

      // Sidecar still has manual-opted
      expect(manager.readAutoRestore().enabled).toEqual(["manual-opted@example.com"]);

      // Policies removed for restored accounts only
      expect(policies.length).toBe(1);
      expect(policies[0]?.account?.email).toBe("manual-not-opted@example.com");
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

  test("recordHealth manages all-failed incident lifecycle in gemini-health-latest.json and history", () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hm-inc-"));
    try {
      const recordedEvents: HistoryEventInput[] = [];
      const mockHistoryStore = {
        recordEvents: (events: HistoryEventInput[]) => {
          recordedEvents.push(...events);
        },
      };
      const manager = new AntigravityHealthManager({
        agentDir: tempDir,
        historyStore: mockHistoryStore as unknown as ReliabilityHistoryStore,
      });
      // All accounts fail
      const failedResults = [
        { index: 1, email: "alpha@example.com", project: "p1", status: "hang" as const, ms: 15000 },
        { index: 2, email: "beta@example.com", project: "p2", status: "error" as const, ms: 500 },
      ];
      manager.recordHealth(failedResults);

      // File on disk must be gemini-health-latest.json
      const latestPath = path.join(tempDir, "gemini-health-latest.json");
      expect(fs.existsSync(latestPath)).toBe(true);

      const snapshot = manager.readSnapshot();
      expect(snapshot?.incident).toBeDefined();
      expect(snapshot?.incident?.kind).toBe("all-failed");

      // History event recorded
      const incidentEvent = recordedEvents.find((e) => e.kind === "incident");
      expect(incidentEvent).toBeDefined();
      expect(incidentEvent?.incidentId).toBe(snapshot?.incident?.id);

      // Subsequent check with an ok result clears incident
      const recoveredResults = [
        { index: 1, email: "alpha@example.com", project: "p1", status: "ok" as const, ms: 50 },
      ];
      manager.recordHealth(recoveredResults);

      const updatedSnapshot = manager.readSnapshot();
      expect(updatedSnapshot?.incident).toBeUndefined();

      const resolvedEvent = recordedEvents.find((e) => e.kind === "incident_resolved");
      expect(resolvedEvent).toBeDefined();
      expect(resolvedEvent?.incidentId).toBe(incidentEvent?.incidentId);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
