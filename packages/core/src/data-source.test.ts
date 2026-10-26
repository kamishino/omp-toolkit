import { describe, expect, test } from "bun:test";
import { parseHealthSnapshot, parseRawUsage, UsageDataSource } from "./data-source";

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
});
