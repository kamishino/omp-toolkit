import { describe, expect, test } from "bun:test";
import {
  type HealthResult,
  type HealthSnapshot,
  sectionsFor,
  type UsageReport,
} from "@omp-toolkit/core";
import { jsonPayload } from "./json";

describe("jsonPayload contract", () => {
  const reports: UsageReport[] = [
    {
      provider: "google-antigravity",
      metadata: { email: "dev@example.com" },
      limits: [
        {
          id: "gemini-weekly",
          label: "Gemini",
          window: { label: "Weekly", resetsAt: 5000 },
          amount: { usedFraction: 0.5 },
        },
      ],
    },
  ];

  const snapshot: HealthSnapshot = {
    checkedAt: 1_700_000_000_000,
    results: [
      {
        email: "dev@example.com",
        status: "ok",
        ms: 120,
      },
    ],
  };

  const health = new Map<string, HealthResult>([["dev@example.com", snapshot.results[0]]]);

  test("emits schemaVersion 2 with dashboard and snapshot when showHealth is true", () => {
    const sections = sectionsFor(reports, health);
    const fetchedAt = 1_700_000_100_000;
    const payload = jsonPayload(sections, {
      fetchedAt,
      showHealth: true,
      snapshot,
      balanceAlert: { cny: 10, usd: 10 },
    });

    expect(payload.schemaVersion).toBe(2);
    expect(payload.fetchedAt).toBe(fetchedAt);
    expect(payload.dashboard.providers[0].name).toBe("GOOGLE ANTIGRAVITY");
    expect(payload.dashboard.summary.accounts).toBe(1);
    expect(payload.dashboard.health?.checkedAt).toBe(snapshot.checkedAt);
    expect(payload.snapshot).toEqual(snapshot);
  });

  test("omits snapshot and sets dashboard.health to null when showHealth is false", () => {
    const sections = sectionsFor(reports, new Map());
    const fetchedAt = 1_700_000_200_000;
    const payload = jsonPayload(sections, {
      fetchedAt,
      showHealth: false,
      snapshot,
      balanceAlert: { cny: 10, usd: 10 },
    });

    expect(payload.schemaVersion).toBe(2);
    expect(payload.fetchedAt).toBe(fetchedAt);
    expect(payload.dashboard.health).toBeNull();
    expect(payload.snapshot).toBeUndefined();
  });

  test("includes timeWindow metadata for providers with registered policies in JSON payload", () => {
    const dsReport: UsageReport = {
      provider: "deepseek",
      metadata: { email: "ds@example.com" },
      limits: [
        {
          id: "deepseek:balance",
          label: "Balance",
          amount: { remaining: 50, unit: "cny" },
        },
      ],
    };
    const sections = sectionsFor([dsReport], new Map());
    const payload = jsonPayload(sections, {
      fetchedAt: Date.now(),
      showHealth: false,
      snapshot: null,
      balanceAlert: { cny: 10, usd: 10 },
    });

    const dsProvider = payload.dashboard.providers.find((p) => p.id === "deepseek");
    expect(dsProvider).toBeDefined();
    expect(dsProvider?.timeWindow).toBeDefined();
    expect(typeof dsProvider?.timeWindow?.isPeak).toBe("boolean");
    expect(typeof dsProvider?.timeWindow?.rateMultiplier).toBe("number");
    expect(dsProvider?.timeWindow?.provider).toBe("deepseek");
  });
});
