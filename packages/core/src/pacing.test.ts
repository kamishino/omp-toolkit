import { describe, expect, test } from "bun:test";
import {
  appendPacingSample,
  computeWeeklyPacing,
  extractPacingSamples,
  PACING_DAY_MS,
  PACING_MIN_SAMPLE_GAP_MS,
  PACING_RETENTION_MS,
  PACING_WINDOW_MS,
  parsePacingSamplesFile,
  prunePacingSamples,
  serializePacingSamplesFile,
} from "./pacing";
import type { UsageReport } from "./types";

describe("core pacing domain", () => {
  test("extractPacingSamples extracts only muse-code with valid weekly resetsAt > now", () => {
    const now = 1_000_000_000_000;
    const reports: UsageReport[] = [
      {
        provider: "google-antigravity",
        metadata: { email: "gemini@example.com" },
        limits: [
          {
            label: "Gemini",
            window: { label: "Weekly", resetsAt: now + 500_000 },
            amount: { usedFraction: 0.5 },
          },
        ],
      },
      {
        provider: "muse-code",
        metadata: { email: "muse-ok@example.com" },
        limits: [
          {
            label: "5 Hours",
            window: { label: "5 Hours" },
            amount: { usedFraction: 0.1 },
          },
          {
            label: "Weekly",
            window: { label: "Weekly", resetsAt: now + 200_000_000 },
            amount: { usedFraction: 0.45 },
          },
        ],
      },
      {
        provider: "muse-code",
        metadata: { accountId: "muse-expired" },
        limits: [
          {
            label: "Weekly",
            window: { label: "Weekly", resetsAt: now - 100 }, // Expired
            amount: { usedFraction: 0.9 },
          },
        ],
      },
      {
        provider: "muse-code",
        metadata: { accountId: "muse-no-resets" },
        limits: [
          {
            label: "Weekly",
            window: { label: "Weekly" }, // No resetsAt
            amount: { usedFraction: 0.3 },
          },
        ],
      },
    ];

    const extracted = extractPacingSamples(reports, now);
    expect(extracted.length).toBe(1);
    expect(extracted[0].account).toBe("muse-ok@example.com");
    expect(extracted[0].sample).toEqual({
      at: now,
      resetsAt: now + 200_000_000,
      usedFraction: 0.45,
    });
  });

  test("prunePacingSamples and appendPacingSample thinning and retention", () => {
    const now = 100_000_000;
    const oldSample = {
      at: now - PACING_RETENTION_MS - 1000,
      resetsAt: now + 100_000,
      usedFraction: 0.1,
    };
    const validSample = {
      at: now - 3600_000,
      resetsAt: now + 100_000,
      usedFraction: 0.2,
    };

    // 1. Prune removes entries older than 30 days
    const pruned = prunePacingSamples([oldSample, validSample], now);
    expect(pruned).toEqual([validSample]);

    // 2. Append duplicate or clock-skewed timestamp is ignored
    const skew = { at: validSample.at - 10, resetsAt: now + 100_000, usedFraction: 0.25 };
    expect(appendPacingSample([validSample], skew, now)).toEqual([validSample]);

    // 3. Append same value within 15 min is thinned out
    const sameValSoon = {
      at: validSample.at + PACING_MIN_SAMPLE_GAP_MS - 1000,
      resetsAt: now + 100_000,
      usedFraction: 0.2,
    };
    expect(appendPacingSample([validSample], sameValSoon, now)).toEqual([validSample]);

    // 4. Append changed fraction within 15 min is kept
    const changedVal = {
      at: validSample.at + 10_000,
      resetsAt: now + 100_000,
      usedFraction: 0.25,
    };
    expect(appendPacingSample([validSample], changedVal, now)).toEqual([validSample, changedVal]);

    // 5. Append changed resetsAt within 15 min is kept
    const changedResets = {
      at: validSample.at + 10_000,
      resetsAt: now + 200_000,
      usedFraction: 0.2,
    };
    expect(appendPacingSample([validSample], changedResets, now)).toEqual([
      validSample,
      changedResets,
    ]);

    // 6. Append same value after >= 15 min is kept
    const sameValLater = {
      at: validSample.at + PACING_MIN_SAMPLE_GAP_MS + 100,
      resetsAt: now + 100_000,
      usedFraction: 0.2,
    };
    expect(appendPacingSample([validSample], sameValLater, now)).toEqual([
      validSample,
      sameValLater,
    ]);
  });

  test("parsePacingSamplesFile and serializePacingSamplesFile handle roundtrip and malformed input", () => {
    // Tolerant parsing of garbage
    expect(parsePacingSamplesFile("")).toEqual({});
    expect(parsePacingSamplesFile("{ not json")).toEqual({});
    expect(parsePacingSamplesFile('{"version": 2}')).toEqual({});
    expect(parsePacingSamplesFile('{"version": 1, "accounts": "bad"}')).toEqual({});

    // Filtering out bad items & clamping
    const raw = JSON.stringify({
      version: 1,
      accounts: {
        "muse@example.com": [
          { at: 200, resetsAt: 1000, usedFraction: 1.5 },
          { at: 100, resetsAt: 1000, usedFraction: -0.2 },
          { at: "bad", resetsAt: 1000 },
          null,
        ],
        empty: [],
      },
    });

    const parsed = parsePacingSamplesFile(raw);
    expect(parsed["muse@example.com"]).toEqual([
      { at: 100, resetsAt: 1000, usedFraction: 0 },
      { at: 200, resetsAt: 1000, usedFraction: 1 },
    ]);
    expect(parsed.empty).toEqual([]);

    // Serialization omits empty arrays
    const serialized = serializePacingSamplesFile(parsed);
    expect(serialized).toContain('"muse@example.com"');
    expect(serialized).not.toContain('"empty"');
  });

  test("computeWeeklyPacing returns null on expired or out-of-range window", () => {
    const now = 100_000_000;
    // Expired
    expect(computeWeeklyPacing({ usedFraction: 0.5, resetsAt: now, now })).toBeNull();
    expect(computeWeeklyPacing({ usedFraction: 0.5, resetsAt: now - 10, now })).toBeNull();

    // Window > 7 days away
    expect(
      computeWeeklyPacing({
        usedFraction: 0.5,
        resetsAt: now + PACING_WINDOW_MS + 10_000,
        now,
      }),
    ).toBeNull();
  });

  test("Scenario A: boundary-aligned samples with on-track pacing", () => {
    const windowStart = 1_000_000_000_000;
    const resetsAt = windowStart + PACING_WINDOW_MS;
    // now is 2.5 days into the window
    const now = windowStart + 2.5 * PACING_DAY_MS;
    const usedFraction = 0.3;

    const samples = [
      { at: windowStart, resetsAt, usedFraction: 0 },
      { at: windowStart + 1.0 * PACING_DAY_MS, resetsAt, usedFraction: 0.12 },
      { at: windowStart + 2.0 * PACING_DAY_MS, resetsAt, usedFraction: 0.25 },
    ];

    const result = computeWeeklyPacing({
      usedFraction,
      resetsAt,
      now,
      samples,
    });

    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.dayIndex).toBe(2);
    expect(result.windowStartAt).toBe(windowStart);
    expect(result.resetsAt).toBe(resetsAt);

    // ideal = 2.5 / 7 ≈ 0.35714
    expect(result.idealUsedFraction).toBeCloseTo(2.5 / 7, 4);
    // actual used = 0.30 < 0.35714 -> under pace
    expect(result.status).toBe("under");
    expect(result.level).toBe("ok");

    // remaining = 0.70; remainingDays = 4.5 -> adaptiveDaily = 0.70 / 4.5 ≈ 0.1555
    expect(result.adaptiveDailyFraction).toBeCloseTo(0.7 / 4.5, 4);

    // safe left today: 0.5 days remaining in dayIndex 2 -> adaptive * 0.5
    expect(result.safeLeftTodayFraction).toBeCloseTo((0.7 / 4.5) * 0.5, 4);

    // Slices
    expect(result.slices.length).toBe(7);
    // D1 (dayIndex 0): 0 -> 0.12 = 0.12
    expect(result.slices[0].state).toBe("past");
    expect(result.slices[0].usedFraction).toBeCloseTo(0.12, 4);
    expect(result.slices[0].lowerBound).toBe(false);

    // D2 (dayIndex 1): 0.12 -> 0.25 = 0.13
    expect(result.slices[1].state).toBe("past");
    expect(result.slices[1].usedFraction).toBeCloseTo(0.13, 4);
    expect(result.slices[1].lowerBound).toBe(false);

    // D3 (dayIndex 2, current): 0.25 -> 0.30 = 0.05
    expect(result.slices[2].state).toBe("current");
    expect(result.slices[2].usedFraction).toBeCloseTo(0.05, 4);
    expect(result.slices[2].lowerBound).toBe(false);

    // D4..D7 (future): null usedFraction, budgetFraction = adaptiveDaily
    for (let i = 3; i < 7; i++) {
      expect(result.slices[i].state).toBe("future");
      expect(result.slices[i].usedFraction).toBeNull();
      expect(result.slices[i].budgetFraction).toBeCloseTo(result.adaptiveDailyFraction, 4);
    }

    expect(result.todayUsedFraction).toBeCloseTo(0.05, 4);
    expect(result.todayLowerBound).toBe(false);
    expect(result.unobservedFraction).toBe(0);
    expect(result.projectedExhaustionAt).toBeNull(); // Lasts past reset
  });

  test("Scenario B: late first sample introduces unobserved and lower bound", () => {
    const windowStart = 1_000_000_000_000;
    const resetsAt = windowStart + PACING_WINDOW_MS;
    // First sample arrives at start + 1.5d with used = 0.20
    const now = windowStart + 1.8 * PACING_DAY_MS;
    const usedFraction = 0.22;

    const samples = [{ at: windowStart + 1.5 * PACING_DAY_MS, resetsAt, usedFraction: 0.2 }];

    const result = computeWeeklyPacing({
      usedFraction,
      resetsAt,
      now,
      samples,
    });

    expect(result).not.toBeNull();
    if (!result) return;

    // Unobserved fraction should capture the pre-first-sample burn: 0.20
    expect(result.unobservedFraction).toBeCloseTo(0.2, 4);

    // Day 1 (index 0) was unobserved
    expect(result.slices[0].usedFraction).toBeNull();

    // Day 2 (index 1, current): first observation arrived mid-slice -> lowerBound is true
    expect(result.slices[1].state).toBe("current");
    expect(result.slices[1].usedFraction).toBeCloseTo(0.02, 4);
    expect(result.slices[1].lowerBound).toBe(true);
    expect(result.todayLowerBound).toBe(true);
  });

  test("Scenario C: over-pace projection calculates exhaustion date", () => {
    const windowStart = 1_000_000_000_000;
    const resetsAt = windowStart + PACING_WINDOW_MS;
    // 3.5 days in, used 0.70 (ideal is 0.50 -> +0.20 over pace)
    const now = windowStart + 3.5 * PACING_DAY_MS;
    const usedFraction = 0.7;

    const result = computeWeeklyPacing({
      usedFraction,
      resetsAt,
      now,
    });

    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.status).toBe("over");
    expect(result.level).toBe("critical"); // delta 0.20 >= 0.15

    // avg burn per day = 0.70 / 3.5 = 0.20/day
    // remaining = 0.30 -> exhaustion in 0.30 / 0.20 = 1.5 days
    const expectedExhaustion = now + 1.5 * PACING_DAY_MS;
    expect(result.projectedExhaustionAt).toBeCloseTo(expectedExhaustion, -2);
  });

  test("Scenario D: multi-day gap interval (>2h crossing boundary) goes to unobserved", () => {
    const windowStart = 1_000_000_000_000;
    const resetsAt = windowStart + PACING_WINDOW_MS;

    // Sample 1 at start + 0.5d (Day 1)
    // Sample 2 at start + 2.5d (Day 3, 2 full days later > 2h gap)
    const s1 = { at: windowStart + 0.5 * PACING_DAY_MS, resetsAt, usedFraction: 0.1 };
    const s2 = { at: windowStart + 2.5 * PACING_DAY_MS, resetsAt, usedFraction: 0.5 };
    const now = windowStart + 2.5 * PACING_DAY_MS;

    const result = computeWeeklyPacing({
      usedFraction: 0.5,
      resetsAt,
      now,
      samples: [s1, s2],
    });

    expect(result).not.toBeNull();
    if (!result) return;

    // Delta between s1 and s2 is 0.40, crossing 2 boundaries (>2h gap) -> added to unobserved
    // plus initial pre-sample burn of 0.10 -> unobserved should be 0.50
    expect(result.unobservedFraction).toBeCloseTo(0.5, 4);
    // Slices 0, 1, 2 should have no attributed intervals from that gap
    expect(result.slices[0].usedFraction).toBeNull();
    expect(result.slices[1].usedFraction).toBeNull();
  });
});
