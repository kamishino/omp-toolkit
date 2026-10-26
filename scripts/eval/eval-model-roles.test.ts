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
      expect(task.description.length).toBeGreaterThan(0);
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
    expect(estimateTokenCount("abcd")).toBe(1);
    expect(estimateTokenCount("abcdefgh")).toBe(2);
    expect(estimateTokenCount("")).toBe(1); // min 1
  });

  test("calculateModelCost uses published rates for DeepSeek and Gemini", () => {
    // DeepSeek: in 0.3 / 1M, out 1.2 / 1M
    const dsCost = calculateModelCost("deepseek/deepseek-flash", 1_000_000, 1_000_000);
    expect(dsCost).toBeCloseTo(1.5, 2);

    // Gemini: in 0.75 / 1M, out 3.75 / 1M
    const geminiCost = calculateModelCost(
      "google-antigravity/gemini-3.8-flash",
      1_000_000,
      1_000_000,
    );
    expect(geminiCost).toBeCloseTo(4.5, 2);
  });

  test("calculateSummary accurately computes summary statistics", () => {
    const metrics = [
      {
        taskId: "T1",
        planAcceptedFirstPass: true,
        firstPassSuccess: true,
        toolTurns: 3,
        preToolChatterRetries: 0,
        inputTokens: 1000,
        outputTokens: 200,
        reasoningTokens: 0,
        durationSeconds: 10,
        costUsd: 0.01,
      },
      {
        taskId: "T2",
        planAcceptedFirstPass: false,
        firstPassSuccess: true,
        toolTurns: 5,
        preToolChatterRetries: 1,
        inputTokens: 2000,
        outputTokens: 400,
        reasoningTokens: 0,
        durationSeconds: 20,
        costUsd: 0.02,
      },
    ];

    const result = calculateSummary(PAIR_CONFIGS.A, metrics);
    expect(result.summary.planAcceptanceRate).toBe(50);
    expect(result.summary.firstPassSolveRate).toBe(100);
    expect(result.summary.avgToolTurns).toBe(4.0);
    expect(result.summary.totalTokens).toBe(3600);
    expect(result.summary.totalCostUsd).toBe(0.03);
    expect(result.summary.totalDurationMinutes).toBe(0.5);
  });

  test("formatScorecard generates a Markdown comparison table", () => {
    const results = [
      calculateSummary(PAIR_CONFIGS.A, [mockMetricsForDryRun("T1", "A")]),
      calculateSummary(PAIR_CONFIGS.B, [mockMetricsForDryRun("T1", "B")]),
    ];

    const markdown = formatScorecard(results);
    expect(markdown).toContain("| Metric | Pair A");
    expect(markdown).toContain("| **Plan Acceptance Rate** |");
    expect(markdown).toContain("| **First-Pass Solve Rate** |");
    expect(markdown).toContain("| **Total Cost (USD)** |");
  });
});
