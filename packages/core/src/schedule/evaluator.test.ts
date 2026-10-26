import { describe, expect, test } from "bun:test";
import {
  buildScheduleTable,
  DEEPSEEK_POLICY,
  evaluateWindow,
  formatDuration,
  getTimeWindowPolicy,
  registerTimeWindowPolicy,
  ScheduleEvaluator,
  ScheduleRegistry,
  scheduleRegistry,
  type TimeWindowPolicy,
} from "./index";

describe("DeepSeek Time Window Policy & Evaluator", () => {
  // Helper to create exact UTC timestamp: year, month (1-12), day, hour, minute, second
  function utc(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute = 0,
    second = 0,
    ms = 0,
  ): number {
    return Date.UTC(year, month - 1, day, hour, minute, second, ms);
  }

  // 2026-10-19 was a Monday
  // Mon 00:59:59 UTC -> Off-Peak
  test("identifies off-peak before window 1 on a weekday", () => {
    const ts = utc(2026, 10, 19, 0, 59, 59);
    const evalResult = evaluateWindow(DEEPSEEK_POLICY, ts, "UTC");

    expect(evalResult.isPeak).toBe(false);
    expect(evalResult.discountPercent).toBe(50);
    expect(evalResult.rateMultiplier).toBe(0.5);
    expect(evalResult.label).toBe("OFF-PEAK: 50% OFF");
    // Next transition is 01:00 UTC (1 second away)
    expect(evalResult.nextTransitionAt).toBe(utc(2026, 10, 19, 1, 0, 0));
    expect(evalResult.formattedTimeUntilNext).toBe("1s");
  });

  // Mon 01:00:00 UTC -> Peak Window 1 begins (01:00 - 04:00 UTC)
  test("identifies peak window 1 start on a weekday", () => {
    const ts = utc(2026, 10, 19, 1, 0, 0);
    const evalResult = evaluateWindow(DEEPSEEK_POLICY, ts, "UTC");

    expect(evalResult.isPeak).toBe(true);
    expect(evalResult.discountPercent).toBe(0);
    expect(evalResult.rateMultiplier).toBe(1.0);
    expect(evalResult.label).toBe("PEAK: 2× Rate");
    // Next transition is 04:00 UTC (3 hours away)
    expect(evalResult.nextTransitionAt).toBe(utc(2026, 10, 19, 4, 0, 0));
    expect(evalResult.formattedTimeUntilNext).toBe("3h 0m");
    expect(evalResult.badgeText).toContain("PEAK: 2× Rate");
  });

  // Mon 03:59:59 UTC -> Still in Peak Window 1
  test("identifies peak window 1 end boundary", () => {
    const ts = utc(2026, 10, 19, 3, 59, 0);
    const evalResult = evaluateWindow(DEEPSEEK_POLICY, ts, "UTC");

    expect(evalResult.isPeak).toBe(true);
    expect(evalResult.formattedTimeUntilNext).toBe("1m");
  });

  // Mon 04:00:00 UTC -> Off-Peak Gap (04:00 - 06:00 UTC)
  test("identifies off-peak midday gap between peak windows", () => {
    const ts = utc(2026, 10, 19, 4, 0, 0);
    const evalResult = evaluateWindow(DEEPSEEK_POLICY, ts, "UTC");

    expect(evalResult.isPeak).toBe(false);
    expect(evalResult.discountPercent).toBe(50);
    expect(evalResult.rateMultiplier).toBe(0.5);
    // Next transition is Window 2 at 06:00 UTC (2 hours away)
    expect(evalResult.nextTransitionAt).toBe(utc(2026, 10, 19, 6, 0, 0));
    expect(evalResult.formattedTimeUntilNext).toBe("2h 0m");
  });

  // Mon 06:00:00 UTC -> Peak Window 2 begins (06:00 - 10:00 UTC)
  test("identifies peak window 2 on a weekday", () => {
    const ts = utc(2026, 10, 19, 6, 0, 0);
    const evalResult = evaluateWindow(DEEPSEEK_POLICY, ts, "UTC");

    expect(evalResult.isPeak).toBe(true);
    expect(evalResult.rateMultiplier).toBe(1.0);
    // Next transition is 10:00 UTC (4 hours away)
    expect(evalResult.nextTransitionAt).toBe(utc(2026, 10, 19, 10, 0, 0));
    expect(evalResult.formattedTimeUntilNext).toBe("4h 0m");
  });

  // Mon 10:00:00 UTC -> Evening Off-Peak until Tuesday 01:00 UTC
  test("identifies off-peak after window 2 until next morning", () => {
    const ts = utc(2026, 10, 19, 10, 0, 0);
    const evalResult = evaluateWindow(DEEPSEEK_POLICY, ts, "UTC");

    expect(evalResult.isPeak).toBe(false);
    expect(evalResult.discountPercent).toBe(50);
    // Next transition is Tuesday 01:00 UTC (15 hours away)
    expect(evalResult.nextTransitionAt).toBe(utc(2026, 10, 20, 1, 0, 0));
    expect(evalResult.formattedTimeUntilNext).toBe("15h 0m");
  });

  // Friday 10:00:00 UTC -> Off-Peak spanning entire weekend until Monday 01:00 UTC!
  test("spans off-peak across entire weekend starting Friday close", () => {
    // 2026-10-23 is Friday
    const ts = utc(2026, 10, 23, 10, 0, 0);
    const evalResult = evaluateWindow(DEEPSEEK_POLICY, ts, "UTC");

    expect(evalResult.isPeak).toBe(false);
    // Next peak is Monday 2026-10-26 01:00 UTC (63 hours away: 14h Fri + 24h Sat + 24h Sun + 1h Mon)
    expect(evalResult.nextTransitionAt).toBe(utc(2026, 10, 26, 1, 0, 0));
    expect(evalResult.formattedTimeUntilNext).toBe("63h 0m");
  });

  // Saturday 02:00:00 UTC -> Off-Peak even during hours that are peak on weekdays
  test("treats Saturday as 100% off-peak", () => {
    // 2026-10-24 is Saturday
    const ts = utc(2026, 10, 24, 2, 0, 0);
    const evalResult = evaluateWindow(DEEPSEEK_POLICY, ts, "UTC");

    expect(evalResult.isPeak).toBe(false);
    expect(evalResult.discountPercent).toBe(50);
    expect(evalResult.nextTransitionAt).toBe(utc(2026, 10, 26, 1, 0, 0));
  });

  // Sunday 08:00:00 UTC -> Off-Peak
  test("treats Sunday as 100% off-peak", () => {
    // 2026-10-25 is Sunday
    const ts = utc(2026, 10, 25, 8, 0, 0);
    const evalResult = evaluateWindow(DEEPSEEK_POLICY, ts, "UTC");

    expect(evalResult.isPeak).toBe(false);
    expect(evalResult.discountPercent).toBe(50);
    expect(evalResult.nextTransitionAt).toBe(utc(2026, 10, 26, 1, 0, 0));
  });

  test("converts reference hours to user local timezone correctly", () => {
    const ts = utc(2026, 10, 19, 1, 30, 0);
    // Shanghai is UTC+8: 01:30 UTC -> 09:30 CST
    const shanghaiEval = evaluateWindow(DEEPSEEK_POLICY, ts, "Asia/Shanghai");
    expect(shanghaiEval.isPeak).toBe(true);
    expect(shanghaiEval.userTimeZone).toBe("Asia/Shanghai");

    // New York is UTC-4 in October: 01:30 UTC -> 21:30 EDT (previous night)
    const nyEval = evaluateWindow(DEEPSEEK_POLICY, ts, "America/New_York");
    expect(nyEval.isPeak).toBe(true);
    expect(nyEval.userTimeZone).toBe("America/New_York");
  });

  test("formatDuration formats seconds, minutes, and hours accurately", () => {
    expect(formatDuration(45 * 1000)).toBe("45s");
    expect(formatDuration(90 * 1000)).toBe("1m");
    expect(formatDuration((2 * 3600 + 15 * 60) * 1000)).toBe("2h 15m");
    expect(formatDuration(63 * 3600 * 1000)).toBe("63h 0m");
  });
});

describe("Multi-Provider Registry", () => {
  test("contains deepseek policy by default", () => {
    const policy = getTimeWindowPolicy("deepseek");
    expect(policy).toBeDefined();
    expect(policy?.provider).toBe("deepseek");
    expect(policy?.windows.length).toBe(2);
  });

  test("allows registering custom provider policies", () => {
    const customPolicy: TimeWindowPolicy = {
      provider: "mock-provider",
      name: "Mock Provider Schedule",
      referenceTimeZone: "UTC",
      windows: [
        {
          type: "peak",
          days: [1, 2, 3, 4, 5],
          startHour: 12,
          startMinute: 0,
          endHour: 16,
          endMinute: 0,
          rateMultiplier: 1.5,
          discountPercent: 0,
        },
      ],
      defaultWindow: {
        type: "off-peak",
        days: [1, 2, 3, 4, 5, 6, 7],
        startHour: 0,
        startMinute: 0,
        endHour: 24,
        endMinute: 0,
        rateMultiplier: 1.0,
        discountPercent: 33,
      },
    };

    registerTimeWindowPolicy(customPolicy);
    const retrieved = getTimeWindowPolicy("mock-provider");
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe("Mock Provider Schedule");
  });
});

describe("buildScheduleTable", () => {
  test("generates timetable rows for all 7 days with local conversion", () => {
    const now = Date.UTC(2026, 9, 19, 2, 0, 0); // Monday 02:00 UTC (Peak)
    const table = buildScheduleTable(DEEPSEEK_POLICY, now, "Asia/Shanghai");

    expect(table.length).toBeGreaterThan(0);
    // At least one active row
    const activeRows = table.filter((r) => r.isCurrent);
    expect(activeRows.length).toBe(1);
    expect(activeRows[0].windowType).toBe("peak");
    expect(activeRows[0].referenceTime).toContain("UTC");
    expect(activeRows[0].localTime).toContain("09:00");
  });
});
describe("ScheduleEvaluator deep domain module", () => {
  test("evaluates policy and builds timetable via domain class", () => {
    const evaluator = new ScheduleEvaluator(DEEPSEEK_POLICY);
    const now = Date.UTC(2026, 9, 19, 2, 0, 0); // Monday 02:00 UTC (Peak)

    const evaluation = evaluator.evaluate(now, "UTC");
    expect(evaluation.isPeak).toBe(true);
    expect(evaluation.label).toBe("PEAK: 2× Rate");

    const transition = evaluator.getNextTransition(now);
    expect(transition.isPeak).toBe(true);
    expect(transition.nextTransitionAt).toBe(Date.UTC(2026, 9, 19, 4, 0, 0));
    expect(transition.formattedTimeUntilNext).toBe("2h 0m");

    const table = evaluator.buildTable(now, "UTC");
    expect(table.length).toBeGreaterThan(0);
    const active = table.find((r) => r.isCurrent);
    expect(active?.windowType).toBe("peak");
  });
});

describe("ScheduleRegistry deep domain registry", () => {
  test("evaluates registered policy in one step", () => {
    const now = Date.UTC(2026, 9, 19, 2, 0, 0); // Monday 02:00 UTC (Peak)
    const res = scheduleRegistry.evaluate("deepseek", now, "UTC");
    expect(res).not.toBeNull();
    expect(res?.isPeak).toBe(true);
    expect(res?.label).toBe("PEAK: 2× Rate");
  });

  test("returns null for unregistered provider", () => {
    expect(scheduleRegistry.evaluate("unknown-provider")).toBeNull();
    expect(scheduleRegistry.buildTable("unknown-provider")).toBeNull();
  });

  test("builds schedule timetable via registry", () => {
    const now = Date.UTC(2026, 9, 19, 2, 0, 0);
    const rows = scheduleRegistry.buildTable("deepseek", now, "UTC");
    expect(rows).not.toBeNull();
    expect(rows?.length).toBeGreaterThan(0);
  });

  test("supports isolated custom registry instances", () => {
    const customRegistry = new ScheduleRegistry([]);
    expect(customRegistry.all()).toEqual([]);
    expect(customRegistry.get("deepseek")).toBeUndefined();

    customRegistry.register(DEEPSEEK_POLICY);
    expect(customRegistry.get("deepseek")).toBeDefined();
  });
});
