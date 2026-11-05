import { describe, expect, test } from "bun:test";
import { parseHealthSnapshot, parseRawUsage, UsageDataSource } from "./data-source";
import type { UsageReport } from "./types";

describe("UsageDataSource ports & adapters", () => {
  test("parseRawUsage extracts reports array from valid JSON", () => {
    const json = JSON.stringify({
      reports: [
        {
          provider: "google-antigravity",
          metadata: { email: "user@example.com" },
          limits: [],
        },
      ],
    });
    const reports = parseRawUsage(json);
    expect(reports.length).toBe(1);
    expect(reports[0].provider).toBe("google-antigravity");
  });

  test("parseRawUsage rejects invalid or malformed payload", () => {
    expect(() => parseRawUsage("not json")).toThrow("invalid JSON");
    expect(() => parseRawUsage(JSON.stringify({ notReports: [] }))).toThrow("unexpected payload");
  });

  test("parseHealthSnapshot parses snapshot JSON cleanly", () => {
    const json = JSON.stringify({
      checkedAt: 1_700_000_000_000,
      results: [{ email: "user@example.com", status: "ok", ms: 80 }],
    });
    const snapshot = parseHealthSnapshot(json);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.checkedAt).toBe(1_700_000_000_000);
    expect(snapshot?.results[0].status).toBe("ok");
  });

  test("parseHealthSnapshot returns null on invalid JSON or non-array results", () => {
    expect(parseHealthSnapshot("{ invalid")).toBeNull();
    expect(parseHealthSnapshot(JSON.stringify({ results: "not-array" }))).toBeNull();
  });
  test("parseHealthSnapshot preserves valid incident and drops malformed incident without dropping snapshot", () => {
    const validJson = JSON.stringify({
      checkedAt: 1_700_000_000_000,
      results: [{ email: "user@example.com", status: "ok", ms: 80 }],
      incident: {
        id: "inc-123",
        at: 1_700_000_000_100,
        kind: "all-failed",
        detail: "3/3 accounts failing",
      },
    });
    const withIncident = parseHealthSnapshot(validJson);
    expect(withIncident?.incident).toEqual({
      id: "inc-123",
      at: 1_700_000_000_100,
      kind: "all-failed",
      detail: "3/3 accounts failing",
    });

    const malformedJson = JSON.stringify({
      checkedAt: 1_700_000_000_000,
      results: [{ email: "user@example.com", status: "ok", ms: 80 }],
      incident: {
        id: 123, // invalid type
        at: "not-a-number",
      },
    });
    const withoutIncident = parseHealthSnapshot(malformedJson);
    expect(withoutIncident).not.toBeNull();
    expect(withoutIncident?.checkedAt).toBe(1_700_000_000_000);
    expect(withoutIncident?.incident).toBeUndefined();
  });

  test("UsageDataSource coordinates fetching and compiling dashboard via injected adapter", async () => {
    const mockReports = [
      {
        provider: "google-antigravity",
        metadata: { email: "user@example.com" },
        limits: [{ id: "l1", label: "Gemini", amount: { usedFraction: 0.1 } }],
      },
    ];
    const mockSnapshot = {
      checkedAt: 1_700_000_000_000,
      results: [{ email: "user@example.com", status: "ok", ms: 40 }],
    };

    const mockAdapter = {
      execFile: async () => ({ stdout: JSON.stringify({ reports: mockReports }) }),
      readFile: () => JSON.stringify(mockSnapshot),
    };

    const source = new UsageDataSource(mockAdapter);
    const reports = await source.fetchReports();
    expect(reports.length).toBe(1);

    const snapshot = source.readSnapshot();
    expect(snapshot?.results.length).toBe(1);

    const dashboard = await source.fetchDashboard({ showHealth: true });
    expect(dashboard.providers.length).toBe(1);
    expect(dashboard.providers[0].name).toBe("GOOGLE ANTIGRAVITY");
    expect(dashboard.health?.checkedAt).toBe(1_700_000_000_000);
  });

  test("fetchAuthenticatedProviders parses provider ids and degrades to undefined", async () => {
    const source = new UsageDataSource({
      execFile: async () => ({
        stdout: JSON.stringify({
          accounts: [{ provider: "muse-code" }, { provider: "google-antigravity" }],
        }),
      }),
      readFile: () => "",
    });
    const providers = await source.fetchAuthenticatedProviders();
    expect([...(providers ?? [])].sort()).toEqual(["google-antigravity", "muse-code"]);

    const failing = new UsageDataSource({
      execFile: async () => {
        throw new Error("omp usage accounts failed");
      },
      readFile: () => "",
    });
    expect(await failing.fetchAuthenticatedProviders()).toBeUndefined();
  });

  test("fetchDashboard hides ghost OAuth providers but keeps API-key providers", async () => {
    const ghostMuse: UsageReport = {
      provider: "muse-code",
      metadata: { email: "muse@example.com" },
      limits: [
        {
          id: "1w",
          label: "Weekly",
          window: { label: "Weekly", resetsAt: 1_800_000_000_000 },
          amount: { usedFraction: 0.99 },
          notes: ["Carried from the last reported usage; later usage not visible"],
        },
      ],
    };
    const antigravity: UsageReport = {
      provider: "google-antigravity",
      metadata: { email: "agy@example.com" },
      limits: [{ id: "gemini-weekly", label: "Gemini", amount: { usedFraction: 0.2 } }],
    };
    const deepseek: UsageReport = {
      provider: "deepseek",
      metadata: {
        accountId: "api_key",
        balance: { currency: "CNY", total: 24.1, available: true },
      },
      limits: [
        {
          id: "deepseek:balance",
          label: "Balance",
          amount: { remaining: 24.1, unit: "cny" },
        },
      ],
    };

    const source = new UsageDataSource({
      execFile: async (_file, args) =>
        args.includes("accounts")
          ? { stdout: JSON.stringify({ accounts: [{ provider: "google-antigravity" }] }) }
          : { stdout: JSON.stringify({ reports: [antigravity, deepseek, ghostMuse] }) },
      readFile: () => "",
    });

    const dashboard = await source.fetchDashboard();
    expect(dashboard.providers.map((provider) => provider.id)).toEqual([
      "google-antigravity",
      "deepseek",
    ]);
  });
});
