import { describe, expect, test } from "bun:test";
import {
  BENCHMARK_TASKS,
  calculateModelCost,
  calculateSummary,
  estimateTokenCount,
  formatScorecard,
  mockMetricsForDryRun,
  PAIR_CONFIGS,
  parseCliArgs,
} from "./eval-model-roles";

describe("eval-model-roles harness", () => {
  test("PAIR_CONFIGS contains all 4 candidate configurations", () => {
    expect(Object.keys(PAIR_CONFIGS)).toEqual(["A", "B", "C", "D"]);
    expect(PAIR_CONFIGS.A.planModel).toContain("deepseek");
    expect(PAIR_CONFIGS.A.defaultModel).toContain("deepseek");
    expect(PAIR_CONFIGS.B.planModel).toContain("deepseek");
    expect(PAIR_CONFIGS.B.defaultModel).toContain("gemini");
    expect(PAIR_CONFIGS.C.planModel).toContain("gemini");
    expect(PAIR_CONFIGS.C.defaultModel).toContain("deepseek");
    expect(PAIR_CONFIGS.D.planModel).toContain("gemini");
    expect(PAIR_CONFIGS.D.defaultModel).toContain("gemini");
  });

  test("BENCHMARK_TASKS contains all 5 domain workflows", () => {
    expect(BENCHMARK_TASKS.length).toBe(5);
    const ids = BENCHMARK_TASKS.map((t) => t.id);
    expect(ids).toEqual(["T1", "T2", "T3", "T4", "T5"]);
    for (const task of BENCHMARK_TASKS) {
      expect(task.title.length).toBeGreaterThan(0);
      expect(task.verificationCommand.length).toBeGreaterThan(0);
    }
  });

  test("parseCliArgs parses flags and options correctly", () => {
    const empty = parseCliArgs([]);
    expect(empty.list).toBe(false);
    expect(empty.dryRun).toBe(false);
    expect(empty.live).toBe(false);
    expect(empty.pair).toBeUndefined();

    const custom = parseCliArgs([
      "--list",
      "--dry-run",
      "--live",
      "--json",
      "--report",
      "--pair=b",
      "--task=t3",
    ]);
    expect(custom.list).toBe(true);
    expect(custom.dryRun).toBe(true);
    expect(custom.live).toBe(true);
    expect(custom.json).toBe(true);
    expect(custom.report).toBe(true);
    expect(custom.pair).toBe("B");
    expect(custom.task).toBe("T3");
    const pairsCustom = parseCliArgs(["--pairs=a,b"]);
    expect(pairsCustom.pairs).toEqual(["A", "B"]);
  });

  test("estimateTokenCount returns expected character ratio", () => {
    expect(estimateTokenCount("1234")).toBe(1);
    expect(estimateTokenCount("12345678")).toBe(2);
    expect(estimateTokenCount("")).toBe(1);
  });

  test("calculateModelCost uses published rates for DeepSeek and Gemini", () => {
    // DeepSeek: $0.30 in / $1.20 out per 1M tokens
    const deepSeekCost = calculateModelCost("deepseek/deepseek-flash", 1_000_000, 1_000_000);
    expect(deepSeekCost).toBeCloseTo(1.5, 3);

    // Gemini: $0.75 in / $3.75 out per 1M tokens
    const geminiCost = calculateModelCost(
      "google-antigravity/gemini-3.8-flash:high",
      1_000_000,
      1_000_000,
    );
    expect(geminiCost).toBeCloseTo(4.5, 3);
  });

  test("calculateSummary accurately computes summary statistics", () => {
    const pair = PAIR_CONFIGS.A;
    const metrics = [
      {
        taskId: "T1",
        planAcceptedFirstPass: true,
        firstPassSuccess: true,
        toolTurns: 5,
        preToolChatterRetries: 0,
        inputTokens: 1000,
        outputTokens: 500,
        reasoningTokens: 2000,
        durationSeconds: 30,
        costUsd: 0.05,
      },
      {
        taskId: "T2",
        planAcceptedFirstPass: false,
        firstPassSuccess: true,
        toolTurns: 3,
        preToolChatterRetries: 1,
        inputTokens: 2000,
        outputTokens: 1000,
        reasoningTokens: 3000,
        durationSeconds: 90,
        costUsd: 0.15,
      },
    ];

    const res = calculateSummary(pair, metrics);
    expect(res.summary.planAcceptanceRate).toBe(50);
    expect(res.summary.firstPassSolveRate).toBe(100);
    expect(res.summary.avgToolTurns).toBe(4);
    expect(res.summary.totalTokens).toBe(9500);
    expect(res.summary.totalCostUsd).toBe(0.2);
    expect(res.summary.totalDurationMinutes).toBe(2);
  });

  test("formatScorecard generates a Markdown comparison table", () => {
    const results = [
      calculateSummary(PAIR_CONFIGS.A, [mockMetricsForDryRun("T1", "A")]),
      calculateSummary(PAIR_CONFIGS.B, [mockMetricsForDryRun("T1", "B")]),
    ];

    const table = formatScorecard(results);
    expect(table).toContain(
      "| Metric | Pair A (DeepSeek / DeepSeek) | Pair B (DeepSeek plan / Gemini exec) |",
    );
    expect(table).toContain("**Plan Acceptance Rate**");
    expect(table).toContain("**First-Pass Solve Rate**");
    expect(table).toContain("**Total Cost (USD)**");
  });
});
