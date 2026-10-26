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
});
