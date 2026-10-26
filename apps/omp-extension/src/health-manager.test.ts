import { describe, expect, test } from "bun:test";
import type { Account, ProbeResult } from "@omp-toolkit/core";
import { AntigravityHealthManager } from "./health-manager";
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
});
