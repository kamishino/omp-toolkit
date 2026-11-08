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

  test("parseHealthSnapshot parses schema 2 snapshot JSON cleanly", () => {
    const json = JSON.stringify({
      schemaVersion: 2,
      probeModel: "gemini-3.8-flash-high",
      sweepStartedAt: 1_700_000_000_000,
      checkedAt: 1_700_000_000_100,
      results: [
        {
          provider: "google-antigravity",
          email: "user@example.com",
          project: "proj-1",
          model: "gemini-3.8-flash-high",
          status: "ok",
          ms: 80,
          startedAt: 1_700_000_000_000,
          checkedAt: 1_700_000_000_080,
          failureKind: null,
          confirmed: false,
        },
      ],
      streaks: {
        '["google-antigravity","user@example.com","proj-1","gemini-3.8-flash-high"]': {
          ok: 1,
          firstAt: 1_700_000_000_080,
          lastAt: 1_700_000_000_080,
        },
      },
    });
    const snapshot = parseHealthSnapshot(json);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.schemaVersion).toBe(2);
    expect(snapshot?.probeModel).toBe("gemini-3.8-flash-high");
    expect(snapshot?.checkedAt).toBe(1_700_000_000_080);
    expect(snapshot?.results[0].status).toBe("ok");
    expect(snapshot?.results[0].failureKind).toBeNull();
  });

  test("parseHealthSnapshot rejects legacy v1 snapshot without schemaVersion or with schemaVersion !== 2", () => {
    const v1 = JSON.stringify({
      checkedAt: 1_700_000_000_000,
      results: [{ email: "user@example.com", status: "ok", ms: 80 }],
    });
    expect(parseHealthSnapshot(v1)).toBeNull();
    expect(parseHealthSnapshot(JSON.stringify({ schemaVersion: 1 }))).toBeNull();
  });

  test("parseHealthSnapshot returns null on invalid JSON or non-array results", () => {
    expect(parseHealthSnapshot("{ invalid")).toBeNull();
    expect(
      parseHealthSnapshot(
        JSON.stringify({
          schemaVersion: 2,
          probeModel: "gemini-3.8-flash-high",
          checkedAt: 100,
          results: "not-array",
          streaks: {},
        }),
      ),
    ).toBeNull();
  });

  test("parseHealthSnapshot drops inconsistent failureKind combinations without dropping valid rows", () => {
    const json = JSON.stringify({
      schemaVersion: 2,
      probeModel: "gemini-3.8-flash-high",
      checkedAt: 1000,
      results: [
        // Inconsistent: status ok with failureKind timeout
        {
          provider: "google-antigravity",
          email: "bad1@example.com",
          project: "p1",
          model: "gemini-3.8-flash-high",
          status: "ok",
          ms: 10,
          startedAt: 100,
          checkedAt: 110,
          failureKind: "timeout",
          confirmed: false,
        },
        // Inconsistent: status hang with failureKind auth
        {
          provider: "google-antigravity",
          email: "bad2@example.com",
          project: "p1",
          model: "gemini-3.8-flash-high",
          status: "hang",
          ms: 15000,
          startedAt: 100,
          checkedAt: 15100,
          failureKind: "auth",
          confirmed: true,
        },
        // Valid hang
        {
          provider: "google-antigravity",
          email: "good@example.com",
          project: "p1",
          model: "gemini-3.8-flash-high",
          status: "hang",
          ms: 15000,
          startedAt: 100,
          checkedAt: 15100,
          failureKind: "timeout",
          confirmed: true,
        },
      ],
      streaks: {},
    });
    const snap = parseHealthSnapshot(json);
    expect(snap).not.toBeNull();
    expect(snap?.results.length).toBe(1);
    expect(snap?.results[0].email).toBe("good@example.com");
  });

  test("parseHealthSnapshot preserves valid incident and drops malformed incident without dropping snapshot", () => {
    const validJson = JSON.stringify({
      schemaVersion: 2,
      probeModel: "gemini-3.8-flash-high",
      checkedAt: 1_700_000_000_000,
      results: [
        {
          provider: "google-antigravity",
          email: "user@example.com",
          project: "p1",
          model: "gemini-3.8-flash-high",
          status: "ok",
          ms: 80,
          startedAt: 1_700_000_000_000,
          checkedAt: 1_700_000_000_080,
          failureKind: null,
          confirmed: false,
        },
      ],
      streaks: {},
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
      schemaVersion: 2,
      probeModel: "gemini-3.8-flash-high",
      checkedAt: 1_700_000_000_000,
      results: [
        {
          provider: "google-antigravity",
          email: "user@example.com",
          project: "p1",
          model: "gemini-3.8-flash-high",
          status: "ok",
          ms: 80,
          startedAt: 1_700_000_000_000,
          checkedAt: 1_700_000_000_080,
          failureKind: null,
          confirmed: false,
        },
      ],
      streaks: {},
      incident: {
        id: 123, // invalid type
        at: "not-a-number",
      },
    });
    const withoutIncident = parseHealthSnapshot(malformedJson);
    expect(withoutIncident).not.toBeNull();
    expect(withoutIncident?.checkedAt).toBe(1_700_000_000_080);
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
      schemaVersion: 2,
      probeModel: "gemini-3.8-flash-high",
      checkedAt: 1_700_000_000_040,
      results: [
        {
          provider: "google-antigravity",
          email: "user@example.com",
          project: "p1",
          model: "gemini-3.8-flash-high",
          status: "ok",
          ms: 40,
          startedAt: 1_700_000_000_000,
          checkedAt: 1_700_000_000_040,
          failureKind: null,
          confirmed: false,
        },
      ],
      streaks: {},
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
    expect(dashboard.health?.checkedAt).toBe(1_700_000_000_040);
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
