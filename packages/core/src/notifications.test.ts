import { describe, expect, test } from "bun:test";
import { evaluateQuotaAlerts, type QuotaAlertHistory } from "./notifications";
import type { UsageReport } from "./types";

describe("evaluateQuotaAlerts", () => {
  const now = 1_800_000_000_000;

  test("generates warn-90 alert when account hits >= 90% quota", () => {
    const reports: UsageReport[] = [
      {
        provider: "google-antigravity",
        metadata: { email: "dev@work.com" },
        limits: [
          {
            label: "Weekly",
            amount: { usedFraction: 0.92 },
            window: { label: "Weekly", resetsAt: now + 3600_000 },
          },
        ],
      },
    ];

    const history: QuotaAlertHistory = {};
    const result = evaluateQuotaAlerts(reports, history, now);

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0]?.kind).toBe("warn-90");
    expect(result.alerts[0]?.title).toContain("≥90%");
    expect(result.alerts[0]?.account).toBe("dev@work.com");
    expect(result.updatedHistory["dev@work.com"]?.lastWarnAt).toBe(now);

    // Second evaluation within debounce window suppresses alert
    const secondResult = evaluateQuotaAlerts(reports, result.updatedHistory, now + 60_000);
    expect(secondResult.alerts).toHaveLength(0);
  });

  test("generates rollover reset alert when depleted account resets", () => {
    const reports: UsageReport[] = [
      {
        provider: "google-antigravity",
        metadata: { email: "dev@work.com" },
        limits: [
          {
            label: "Weekly",
            amount: { usedFraction: 0.05 },
            window: { label: "Weekly", resetsAt: now + 604800_000 },
          },
        ],
      },
    ];

    // Previously at 85%
    const history: QuotaAlertHistory = {
      "dev@work.com": {
        previousUsedFraction: 0.85,
      },
    };

    const result = evaluateQuotaAlerts(reports, history, now);
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0]?.kind).toBe("reset");
    expect(result.alerts[0]?.title).toContain("Reset");
  });
});
