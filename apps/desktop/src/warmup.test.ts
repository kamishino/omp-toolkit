import { describe, expect, test } from "bun:test";
import type { WarmUpReport } from "@omp-toolkit/core";
import { parseWarmUpReport, summarizeWarmUp } from "./warmup";

describe("warmup desktop helpers", () => {
  const validReport: WarmUpReport = {
    action: "warm",
    provider: "google-antigravity",
    checkedAt: 123456,
    results: [
      {
        account: "alpha@example.com",
        status: "ok",
        ms: 150,
        checkedAt: 123456,
      },
    ],
    skipped: [{ account: "bravo@example.com", status: "hang", reason: "non-ok" }],
  };

  test("parseWarmUpReport parses valid JSON report", () => {
    const raw = JSON.stringify(validReport);
    expect(parseWarmUpReport(raw)).toEqual(validReport);
  });

  test("parseWarmUpReport throws on invalid JSON or schema", () => {
    expect(() => parseWarmUpReport("not json")).toThrow("warmup returned invalid JSON");
    expect(() => parseWarmUpReport(JSON.stringify({ action: "invalid" }))).toThrow(
      "warmup returned an invalid report",
    );
  });

  test("summarizeWarmUp formats bulk and check summaries", () => {
    expect(summarizeWarmUp(validReport)).toBe("Warmed 1 account(s) · skipped 1 non-OK");

    const checkReport: WarmUpReport = {
      action: "check",
      provider: "google-antigravity",
      checkedAt: 123456,
      results: [
        {
          account: "chinmotdesign@gmail.com",
          status: "hang",
          ms: 15000,
          checkedAt: 123456,
        },
      ],
      skipped: [],
    };
    expect(summarizeWarmUp(checkReport)).toBe("Checked chinmotdesign: HANG (15000ms)");
  });
});
