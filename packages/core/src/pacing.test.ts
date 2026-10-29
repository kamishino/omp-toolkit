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
  updatePacingSamples,
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
  test("updatePacingSamples prunes and appends samples returning modified flag", () => {
    const now = 1_000_000_000_000;
    const reports: UsageReport[] = [
      {
        provider: "muse-code",
        metadata: { email: "muse@example.com" },
        limits: [
          {
            label: "Weekly",
            window: { label: "Weekly", resetsAt: now + 500_000 },
            amount: { usedFraction: 0.2 },
          },
        ],
      },
    ];

    // Initial update from empty
    const initial = updatePacingSamples({}, reports, now);
    expect(initial.modified).toBe(true);
    expect(initial.accounts["muse@example.com"]).toHaveLength(1);
    expect(initial.accounts["muse@example.com"][0].usedFraction).toBe(0.2);

    // Second update with same report shortly after -> not modified
    const second = updatePacingSamples(initial.accounts, reports, now + 60_000);
    expect(second.modified).toBe(false);
    expect(second.accounts["muse@example.com"]).toHaveLength(1);

    // Third update with changed fraction -> modified
    const changedReports: UsageReport[] = [
      {
        provider: "muse-code",
        metadata: { email: "muse@example.com" },
        limits: [
          {
            label: "Weekly",
            window: { label: "Weekly", resetsAt: now + 500_000 },
            amount: { usedFraction: 0.35 },
          },
        ],
      },
    ];
    const third = updatePacingSamples(second.accounts, changedReports, now + 120_000);
    expect(third.modified).toBe(true);
    expect(third.accounts["muse@example.com"]).toHaveLength(2);
    expect(third.accounts["muse@example.com"][1].usedFraction).toBe(0.35);
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

  test("computes ceiling and headroom on on-track pacing", () => {
    const windowStart = 1_000_000_000_000;
    const resetsAt = windowStart + PACING_WINDOW_MS;
    // now is 2.5 days into the window -> Day 3/7 (index 2)
    const now = windowStart + 2.5 * PACING_DAY_MS;
    const usedFraction = 0.3;

    const result = computeWeeklyPacing({
      usedFraction,
      resetsAt,
      now,
    });

    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.dayIndex).toBe(2);
    expect(result.todayCeilingFraction).toBeCloseTo(3 / 7, 4);
    expect(result.headroomFraction).toBeCloseTo(3 / 7 - 0.3, 4);
  });

  test("calculates over-ceiling headroom on early high burn", () => {
    const windowStart = 1_000_000_000_000;
    const resetsAt = windowStart + PACING_WINDOW_MS;
    // Day 1 (index 0): ceiling is 1/7 ≈ 0.142857
    const now = windowStart + 0.5 * PACING_DAY_MS;
    const usedFraction = 0.3;

    const result = computeWeeklyPacing({
      usedFraction,
      resetsAt,
      now,
    });
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.dayIndex).toBe(0);
    expect(result.todayCeilingFraction).toBeCloseTo(1 / 7, 4);
    expect(result.headroomFraction).toBeCloseTo(1 / 7 - 0.3, 4);
  });

  test("calculates Day 7 ceiling as 1.0 and headroom", () => {
    const windowStart = 1_000_000_000_000;
    const resetsAt = windowStart + PACING_WINDOW_MS;
    // Day 7 (index 6): ceiling is 7/7 = 1.0
    const now = windowStart + 6.5 * PACING_DAY_MS;
    const usedFraction = 0.92;

    const result = computeWeeklyPacing({
      usedFraction,
      resetsAt,
      now,
    });
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.dayIndex).toBe(6);
    expect(result.todayCeilingFraction).toBeCloseTo(1.0, 4);
    expect(result.headroomFraction).toBeCloseTo(0.08, 4);
  });
});
