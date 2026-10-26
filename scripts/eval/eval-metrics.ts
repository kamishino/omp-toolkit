export interface ModelPairConfig {
  id: "A" | "B" | "C" | "D";
  name: string;
  planModel: string;
  defaultModel: string;
  description: string;
}

export interface TaskMetrics {
  taskId: string;
  planAcceptedFirstPass: boolean;
  firstPassSuccess: boolean;
  toolTurns: number;
  preToolChatterRetries: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  durationSeconds: number;
  costUsd: number;
}

export interface PairEvaluationResult {
  pair: ModelPairConfig;
  tasks: TaskMetrics[];
  summary: {
    planAcceptanceRate: number;
    firstPassSolveRate: number;
    avgToolTurns: number;
    totalTokens: number;
    totalCostUsd: number;
    totalDurationMinutes: number;
  };
}

export const PAIR_CONFIGS: Record<"A" | "B" | "C" | "D", ModelPairConfig> = {
  A: {
    id: "A",
    name: "DeepSeek / DeepSeek",
    planModel: "deepseek/deepseek-flash",
    defaultModel: "deepseek/deepseek-flash",
    description: "Single-model baseline using DeepSeek V4.1 Flash 1017 for both roles",
  },
  B: {
    id: "B",
    name: "DeepSeek plan / Gemini exec",
    planModel: "deepseek/deepseek-flash",
    defaultModel: "google-antigravity/gemini-3.8-flash",
    description: "Proposed hybrid: DeepSeek reasoning for planning + Gemini for execution",
  },
  C: {
    id: "C",
    name: "Gemini plan / DeepSeek exec",
    planModel: "google-antigravity/gemini-3.8-flash",
    defaultModel: "deepseek/deepseek-flash",
    description: "Reverse hybrid: Gemini reasoning for planning + DeepSeek for execution",
  },
  D: {
    id: "D",
    name: "Gemini / Gemini",
    planModel: "google-antigravity/gemini-3.8-flash",
    defaultModel: "google-antigravity/gemini-3.8-flash",
    description: "Single-model baseline using Gemini 3.8 Flash for both roles",
  },
};

export function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function calculateModelCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const m = modelId.toLowerCase();
  const isDeepSeek = m.includes("deepseek");
  const inRate = isDeepSeek ? 0.3 : 0.75;
  const outRate = isDeepSeek ? 1.2 : 3.75;
  return Number(((inputTokens * inRate + outputTokens * outRate) / 1_000_000).toFixed(5));
}

export function calculateSummary(
  pair: ModelPairConfig,
  tasks: TaskMetrics[],
): PairEvaluationResult {
  const count = tasks.length || 1;
  const acceptedPlans = tasks.filter((t) => t.planAcceptedFirstPass).length;
  const firstPassWins = tasks.filter((t) => t.firstPassSuccess).length;
  const totalTurns = tasks.reduce((sum, t) => sum + t.toolTurns, 0);
  const totalTokens = tasks.reduce(
    (sum, t) => sum + t.inputTokens + t.outputTokens + t.reasoningTokens,
    0,
  );
  const totalCost = tasks.reduce((sum, t) => sum + t.costUsd, 0);
  const totalSeconds = tasks.reduce((sum, t) => sum + t.durationSeconds, 0);

  return {
    pair,
    tasks,
    summary: {
      planAcceptanceRate: Math.round((acceptedPlans / count) * 100),
      firstPassSolveRate: Math.round((firstPassWins / count) * 100),
      avgToolTurns: Number((totalTurns / count).toFixed(1)),
      totalTokens,
      totalCostUsd: Number(totalCost.toFixed(4)),
      totalDurationMinutes: Number((totalSeconds / 60).toFixed(1)),
    },
  };
}

export function mockMetricsForDryRun(taskId: string, pairId: "A" | "B" | "C" | "D"): TaskMetrics {
  const baseCost = pairId === "A" ? 0.05 : pairId === "B" ? 0.18 : pairId === "C" ? 0.12 : 0.25;
  return {
    taskId,
    planAcceptedFirstPass: true,
    firstPassSuccess: true,
    toolTurns: 4,
    preToolChatterRetries: pairId === "D" ? 1 : 0,
    inputTokens: 25000,
    outputTokens: 3500,
    reasoningTokens: 12000,
    durationSeconds: 45,
    costUsd: baseCost,
  };
}

export function formatScorecard(results: PairEvaluationResult[]): string {
  const headers = ["Metric", ...results.map((r) => `Pair ${r.pair.id} (${r.pair.name})`)];
  const separator = headers.map(() => "---");

  const rows: string[][] = [
    ["**Plan Acceptance Rate**", ...results.map((r) => `${r.summary.planAcceptanceRate}%`)],
    ["**First-Pass Solve Rate**", ...results.map((r) => `${r.summary.firstPassSolveRate}%`)],
    ["**Average Tool Turns**", ...results.map((r) => `${r.summary.avgToolTurns}`)],
    ["**Total Tokens**", ...results.map((r) => `${r.summary.totalTokens.toLocaleString()}`)],
    [
      "**Total Cost (USD)**",
      ...results.map((r) =>
        r.summary.totalCostUsd < 0.01
          ? `$${r.summary.totalCostUsd.toFixed(4)}`
          : `$${r.summary.totalCostUsd.toFixed(2)}`,
      ),
    ],
  ];

  const formatRow = (cols: string[]) => `| ${cols.join(" | ")} |`;
  return [formatRow(headers), formatRow(separator), ...rows.map(formatRow)].join("\n");
}
