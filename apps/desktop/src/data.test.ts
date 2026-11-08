import { describe, expect, test } from "bun:test";
import type { Dashboard } from "@omp-toolkit/core";
import { fetchDashboard, parseMonitorPayload } from "./data";

describe("parseMonitorPayload", () => {
  const validDashboard: Dashboard = {
    fetchedAt: 1000,
    providers: [],
    summary: {
      providers: 0,
      accounts: 0,
      above80: 0,
      maxed: 0,
      aboveThreshold: 0.8,
      tightest: null,
    },
    health: null,
    balance: null,
    tooltip: "OMP: no usage data",
    iconLevel: "unknown",
  };
  test("parses valid schema 3 monitor payload", () => {
    const raw = JSON.stringify({
      schemaVersion: 3,
      fetchedAt: 1000,
      dashboard: validDashboard,
    });
    const parsed = parseMonitorPayload(raw);
    expect(parsed).toEqual(validDashboard);
  });

  test("throws on invalid JSON", () => {
    expect(() => parseMonitorPayload("not json")).toThrow(
      "omp-provider-usage returned invalid JSON",
    );
  });

  test("throws on schema mismatch (e.g. schema 1)", () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      fetchedAt: 1000,
      dashboard: validDashboard,
    });
    expect(() => parseMonitorPayload(raw)).toThrow("unsupported monitor schema: 1 (expected 3)");
  });

  test("single data seam: runs the monitor script and forwards thresholds as env", async () => {
    const payload = JSON.stringify({
      schemaVersion: 3,
      fetchedAt: 1000,
      dashboard: validDashboard,
    });
    const calls: Array<{ file: string; args: string[]; env?: Record<string, string> }> = [];
    const execFn = async (
      file: string,
      args: string[],
      opts?: { env?: Record<string, string> },
    ) => {
      calls.push({ file, args, env: opts?.env });
      return { stdout: payload };
    };

    const dashboard = await fetchDashboard(
      { bun: "bun", script: import.meta.path },
      { balanceAlert: { cny: 42, usd: 7 }, accountSort: "weekly-usage" },
      { execFn },
    );

    expect(dashboard).toEqual(validDashboard);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual([import.meta.path, "--json", "--health"]);
    expect(calls[0].env?.DEEPSEEK_BALANCE_ALERT_CNY).toBe("42");
    expect(calls[0].env?.DEEPSEEK_BALANCE_ALERT_USD).toBe("7");
    expect(calls[0].env?.OMP_ACCOUNT_SORT).toBe("weekly-usage");
  });

  test("single data seam: refuses without bun and monitor script", async () => {
    await expect(fetchDashboard(undefined)).rejects.toThrow("Monitor script not found");
    await expect(fetchDashboard({ bun: "bun", script: "/nonexistent/script.js" })).rejects.toThrow(
      "Monitor script not found",
    );
  });

  test("throws on missing or invalid dashboard object", () => {
    const raw = JSON.stringify({
      schemaVersion: 3,
      fetchedAt: 1000,
      dashboard: {
        fetchedAt: 1000,
        providers: [],
        summary: {},
        iconLevel: "invalid-level",
      },
    });
    expect(() => parseMonitorPayload(raw)).toThrow(
      "omp-provider-usage returned an invalid dashboard",
    );
  });
});
