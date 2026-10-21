import { describe, expect, test } from "bun:test";
import type { Dashboard } from "@omp-toolkit/core";
import { parseMonitorPayload } from "./data";

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
  test("parses valid schema 2 monitor payload", () => {
    const raw = JSON.stringify({
      schemaVersion: 2,
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
    expect(() => parseMonitorPayload(raw)).toThrow("unsupported monitor schema: 1 (expected 2)");
  });

  test("throws on missing or invalid dashboard object", () => {
    const raw = JSON.stringify({
      schemaVersion: 2,
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
