import { describe, expect, test } from "bun:test";
import { mergeHealthResults } from "./health";
import type { HealthResult, ProbeResult } from "./types";
import { isWarmUpReport, supportsWarmUp, warmUpEligibility } from "./warmup";

describe("warm-up domain logic", () => {
  test("supportsWarmUp only returns true for google-antigravity", () => {
    expect(supportsWarmUp("google-antigravity")).toBe(true);
    expect(supportsWarmUp("openai-codex")).toBe(false);
    expect(supportsWarmUp("muse-code")).toBe(false);
    expect(supportsWarmUp("deepseek")).toBe(false);
  });

  test("warmUpEligibility categorizes statuses for google-antigravity", () => {
    expect(warmUpEligibility("google-antigravity", "ok")).toBe("warm");
    expect(warmUpEligibility("google-antigravity", null)).toBe("warm");
    expect(warmUpEligibility("google-antigravity", "hang")).toBe("check");
    expect(warmUpEligibility("google-antigravity", "error")).toBe("check");
    expect(warmUpEligibility("google-antigravity", "auth")).toBe("check");
    expect(warmUpEligibility("google-antigravity", "model-error")).toBe("check");
  });

  test("warmUpEligibility returns unsupported for other providers regardless of status", () => {
    expect(warmUpEligibility("openai-codex", "ok")).toBe("unsupported");
    expect(warmUpEligibility("openai-codex", null)).toBe("unsupported");
    expect(warmUpEligibility("deepseek", "hang")).toBe("unsupported");
  });

  test("mergeHealthResults preserves untouched rows and updates probed rows with checkedAt", () => {
    const previous: HealthResult[] = [
      { email: "alpha@example.com", status: "ok", ms: 120, checkedAt: 1000 },
      { email: "bravo@example.com", status: "hang", ms: 15000, checkedAt: 1000 },
    ];
    const results: ProbeResult[] = [
      {
        index: 2,
        email: "bravo@example.com",
        project: "proj-b",
        status: "ok",
        ms: 250,
      },
      {
        index: 3,
        email: "charlie@example.com",
        project: "proj-c",
        status: "ok",
        ms: 300,
      },
    ];

    const merged = mergeHealthResults(previous, results, 2000);
    expect(merged).toHaveLength(3);

    const alpha = merged.find((r) => r.email === "alpha@example.com");
    expect(alpha).toEqual({
      email: "alpha@example.com",
      status: "ok",
      ms: 120,
      checkedAt: 1000,
    });

    const bravo = merged.find((r) => r.email === "bravo@example.com");
    expect(bravo).toMatchObject({
      email: "bravo@example.com",
      status: "ok",
      ms: 250,
      checkedAt: 2000,
    });

    const charlie = merged.find((r) => r.email === "charlie@example.com");
    expect(charlie).toMatchObject({
      email: "charlie@example.com",
      status: "ok",
      ms: 300,
      checkedAt: 2000,
    });
  });

  test("isWarmUpReport validates correct reports and rejects malformed fields", () => {
    const validReport = {
      action: "warm",
      provider: "google-antigravity",
      checkedAt: 123456,
      results: [
        {
          account: "alpha@example.com",
          status: "ok",
          ms: 200,
          checkedAt: 123456,
        },
      ],
      skipped: [{ account: "bravo@example.com", status: "hang", reason: "non-ok" }],
    };

    expect(isWarmUpReport(validReport)).toBe(true);
    expect(isWarmUpReport(null)).toBe(false);
    expect(isWarmUpReport({ ...validReport, action: "invalid-action" })).toBe(false);
    expect(isWarmUpReport({ ...validReport, checkedAt: "not-a-number" })).toBe(false);
    expect(
      isWarmUpReport({
        ...validReport,
        results: [{ ...validReport.results[0], status: "invalid-status" }],
      }),
    ).toBe(false);
    expect(
      isWarmUpReport({
        ...validReport,
        skipped: [{ account: "bravo@example.com", status: null, reason: "unknown-reason" }],
      }),
    ).toBe(false);
  });
});
