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
});
