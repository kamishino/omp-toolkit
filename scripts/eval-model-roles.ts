/**
 * 2x2 Model Role Empirical Evaluation Harness.
 *
 * Compares candidate model pairings for planning and execution roles
 * across representative repository tasks.
 *
 * Usage:
 *   bun scripts/eval-model-roles.ts --list
 *   bun scripts/eval-model-roles.ts --dry-run
 *   bun scripts/eval-model-roles.ts --live --task=T1 --report
 *   bun scripts/eval-model-roles.ts --pair=B --report
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ModelPairConfig {
  id: "A" | "B" | "C" | "D";
  name: string;
  planModel: string;
  defaultModel: string;
  description: string;
}

export interface BenchmarkTask {
  id: "T1" | "T2" | "T3" | "T4" | "T5";
  domain: string;
  title: string;
  description: string;
  verificationCommand: string;
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

export interface BenchmarkTaskPrompt {
  id: string;
  planPrompt: string;
  planVerificationKeywords: string[];
  executionPrompt: (planText: string) => string;
  solutionVerificationKeywords: string[];
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

export const BENCHMARK_TASKS: BenchmarkTask[] = [
  {
    id: "T1",
    domain: "Core / TUI",
    title: "Diagnostic Null-Safety",
    description:
      "Add null-safety to table rendering when a provider balance report lacks currency metadata.",
    verificationCommand: "bun test packages/tui/src/table.test.ts",
  },
  {
    id: "T2",
    domain: "Provider Usage",
    title: "CLI Flag Addition",
    description:
      "Add a --compact CLI boolean flag to apps/provider-usage that renders one-line summary rows.",
    verificationCommand: "bun run check",
  },
  {
    id: "T3",
    domain: "Desktop / Core",
    title: "IPC Refactor",
    description:
      "Add an IPC channel in apps/desktop/src/ipc.ts to query active Gemini account cooldowns.",
    verificationCommand: "tsc -p apps/desktop/tsconfig.json --noEmit",
  },
  {
    id: "T4",
    domain: "Extension",
    title: "Route Health Timeout",
    description:
      "Add an optional timeout parameter to apps/omp-extension/src/index.ts probe calls.",
    verificationCommand: "bun test apps/omp-extension",
  },
  {
    id: "T5",
    domain: "Documentation",
    title: "Docs Sync",
    description: "Update docs/architecture.md with the new desktop widget IPC seams.",
    verificationCommand: "bun run check",
  },
];

export const TASK_PROMPTS: Record<string, BenchmarkTaskPrompt> = {
  T1: {
    id: "T1",
    planPrompt:
      "Task: In packages/tui/src/table.ts, add null-safety when a provider balance report lacks currency metadata.\n" +
      "Produce a step-by-step plan: identify the exact file, the function to change, the check command, and invariants.",
    planVerificationKeywords: ["table.ts", "packages/tui", "null", "currency"],
    executionPrompt: (planText) =>
      `Given this plan:\n${planText}\n\n` +
      "Write the TypeScript code snippet or diff to add null-safety for missing currency metadata in table rendering.",
    solutionVerificationKeywords: ["currency", "table", "null"],
  },
  T2: {
    id: "T2",
    planPrompt:
      "Task: In apps/provider-usage/src/index.ts, add a --compact CLI boolean flag that renders one-line summary rows.\n" +
      "Produce a step-by-step plan: identify the argument parsing logic, the render call, and verification.",
    planVerificationKeywords: ["provider-usage", "--compact", "index.ts"],
    executionPrompt: (planText) =>
      `Given this plan:\n${planText}\n\n` +
      "Write the TypeScript code snippet to parse and handle --compact in apps/provider-usage.",
    solutionVerificationKeywords: ["compact", "process.argv"],
  },
  T3: {
    id: "T3",
    planPrompt:
      "Task: In apps/desktop/src/ipc.ts, add an IPC channel 'omp:cooldowns' to query active Gemini account cooldowns.\n" +
      "Produce a step-by-step plan: identify IPC channel naming, payload types, and handler registration.",
    planVerificationKeywords: ["ipc.ts", "apps/desktop", "cooldown"],
    executionPrompt: (planText) =>
      `Given this plan:\n${planText}\n\n` +
      "Write the TypeScript interface and IPC channel definition in apps/desktop/src/ipc.ts.",
    solutionVerificationKeywords: ["IPC", "cooldown"],
  },
  T4: {
    id: "T4",
    planPrompt:
      "Task: In apps/omp-extension/src/index.ts, add an optional timeout parameter to account probe calls.\n" +
      "Produce a step-by-step plan: identify the probe function, default timeout, and error handling.",
    planVerificationKeywords: ["index.ts", "omp-extension", "timeout"],
    executionPrompt: (planText) =>
      `Given this plan:\n${planText}\n\n` +
      "Write the TypeScript code snippet for configurable timeoutMs in probe calls.",
    solutionVerificationKeywords: ["timeout", "probe"],
  },
  T5: {
    id: "T5",
    planPrompt:
      "Task: Update docs/architecture.md to document the desktop widget IPC seams.\n" +
      "Produce a step-by-step plan: identify the target markdown section and architectural layers.",
    planVerificationKeywords: ["architecture.md", "desktop", "IPC"],
    executionPrompt: (planText) =>
      `Given this plan:\n${planText}\n\n` +
      "Write the Markdown section documenting the desktop widget IPC communication seams.",
    solutionVerificationKeywords: ["desktop", "IPC", "core"],
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

export function executeOmpPrompt(
  model: string,
  prompt: string,
  timeoutMs = 60_000,
): Promise<{ text: string; seconds: number; ok: boolean }> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tempFile = path.join(
      os.tmpdir(),
      `omp-eval-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
    );
    fs.writeFileSync(tempFile, prompt, "utf8");

    const child = spawn(
      "omp",
      ["-p", "--no-session", "--no-tools", "--thinking", "low", "--model", model, `@${tempFile}`],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );

    let stdout = "";
    let stderr = "";
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      timer = null;
      child.kill();
      cleanup();
      resolve({
        text: `Execution timed out after ${timeoutMs}ms`,
        seconds: Number(((performance.now() - t0) / 1000).toFixed(2)),
        ok: false,
      });
    }, timeoutMs);

    function cleanup() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      try {
        fs.unlinkSync(tempFile);
      } catch {
        // ignore
      }
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("close", (code) => {
      cleanup();
      const seconds = Number(((performance.now() - t0) / 1000).toFixed(2));
      const cleaned = stdout
        .replace(/^Note:.*?\n/gm, "")
        .replace(/^Working\.\.\.\n*/gm, "")
        .trim();
      if (code === 0 && cleaned.length > 0) {
        resolve({ text: cleaned, seconds, ok: true });
      } else {
        resolve({
          text: cleaned || stderr || `Process exited with code ${code}`,
          seconds,
          ok: false,
        });
      }
    });

    child.on("error", (err) => {
      cleanup();
      resolve({
        text: err.message,
        seconds: Number(((performance.now() - t0) / 1000).toFixed(2)),
        ok: false,
      });
    });
  });
}

export async function executeLiveTask(
  task: BenchmarkTask,
  pair: ModelPairConfig,
): Promise<TaskMetrics> {
  const promptDef = TASK_PROMPTS[task.id];
  const t0 = performance.now();

  // Phase 1: Planning Call
  console.log(`  [Live] Running planning on ${pair.planModel}...`);
  const planResult = await executeOmpPrompt(pair.planModel, promptDef.planPrompt);
  console.log(`    Planning completed in ${planResult.seconds}s (ok: ${planResult.ok})`);

  const planInputTokens = estimateTokenCount(promptDef.planPrompt);
  const planOutputTokens = estimateTokenCount(planResult.text);

  const planAccepted =
    planResult.ok &&
    promptDef.planVerificationKeywords.some((kw) =>
      planResult.text.toLowerCase().includes(kw.toLowerCase()),
    );

  // Phase 2: Execution Call
  console.log(`  [Live] Running execution on ${pair.defaultModel}...`);
  const execPrompt = promptDef.executionPrompt(planResult.text);
  const execResult = await executeOmpPrompt(pair.defaultModel, execPrompt);
  console.log(`    Execution completed in ${execResult.seconds}s (ok: ${execResult.ok})`);

  const execInputTokens = estimateTokenCount(execPrompt);
  const execOutputTokens = estimateTokenCount(execResult.text);

  const execSuccess =
    execResult.ok &&
    promptDef.solutionVerificationKeywords.some((kw) =>
      execResult.text.toLowerCase().includes(kw.toLowerCase()),
    );

  const totalDurationSeconds = Number(((performance.now() - t0) / 1000).toFixed(1));
  const planCost = calculateModelCost(pair.planModel, planInputTokens, planOutputTokens);
  const execCost = calculateModelCost(pair.defaultModel, execInputTokens, execOutputTokens);
  return {
    taskId: task.id,
    planAcceptedFirstPass: planAccepted,
    firstPassSuccess: execSuccess,
    toolTurns: 2,
    preToolChatterRetries: 0,
    inputTokens: planInputTokens + execInputTokens,
    outputTokens: planOutputTokens + execOutputTokens,
    reasoningTokens: 0,
    durationSeconds: totalDurationSeconds,
    costUsd: Number((planCost + execCost).toFixed(5)),
  };
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

export interface CliOptions {
  list: boolean;
  dryRun: boolean;
  live: boolean;
  json: boolean;
  report: boolean;
  pair?: "A" | "B" | "C" | "D";
  pairs?: Array<"A" | "B" | "C" | "D">;
  task?: "T1" | "T2" | "T3" | "T4" | "T5";
}

export function parseCliArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    list: args.includes("--list"),
    dryRun: args.includes("--dry-run"),
    live: args.includes("--live"),
    json: args.includes("--json"),
    report: args.includes("--report"),
  };

  const pairArg = args.find((a) => a.startsWith("--pair="));
  if (pairArg) {
    const val = pairArg.slice("--pair=".length).toUpperCase();
    if (val === "A" || val === "B" || val === "C" || val === "D") {
      options.pair = val;
    }
  }

  const pairsArg = args.find((a) => a.startsWith("--pairs="));
  if (pairsArg) {
    const rawList = pairsArg.slice("--pairs=".length).toUpperCase().split(",");
    const valid = rawList.filter(
      (v): v is "A" | "B" | "C" | "D" => v === "A" || v === "B" || v === "C" || v === "D",
    );
    if (valid.length > 0) {
      options.pairs = valid;
    }
  }

  const taskArg = args.find((a) => a.startsWith("--task="));
  if (taskArg) {
    const val = taskArg.slice("--task=".length).toUpperCase();
    if (val === "T1" || val === "T2" || val === "T3" || val === "T4" || val === "T5") {
      options.task = val;
    }
  }

  return options;
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

async function main(): Promise<void> {
  const opts = parseCliArgs(process.argv.slice(2));

  if (opts.list) {
    console.log("=== 2x2 Model Candidate Pairings ===");
    for (const [id, config] of Object.entries(PAIR_CONFIGS)) {
      console.log(`[Pair ${id}] ${config.name}`);
      console.log(`  Plan:    ${config.planModel}`);
      console.log(`  Default: ${config.defaultModel}`);
      console.log(`  Note:    ${config.description}\n`);
    }

    console.log("=== Benchmark Tasks (5 Workflows) ===");
    for (const task of BENCHMARK_TASKS) {
      console.log(`[${task.id}] ${task.title} (${task.domain})`);
      console.log(`  Description:  ${task.description}`);
      console.log(`  Verification: ${task.verificationCommand}\n`);
    }
    return;
  }

  const activePairs = opts.pairs
    ? opts.pairs.map((p) => PAIR_CONFIGS[p])
    : opts.pair
      ? [PAIR_CONFIGS[opts.pair]]
      : Object.values(PAIR_CONFIGS);
  const activeTasks = opts.task
    ? BENCHMARK_TASKS.filter((t) => t.id === opts.task)
    : BENCHMARK_TASKS;

  const results: PairEvaluationResult[] = [];

  for (const pair of activePairs) {
    console.log(`\nEvaluating [Pair ${pair.id}] ${pair.name}...`);
    const metrics: TaskMetrics[] = [];
    for (const task of activeTasks) {
      if (opts.live) {
        console.log(`  Task ${task.id} (${task.title}):`);
        const liveMetric = await executeLiveTask(task, pair);
        metrics.push(liveMetric);
      } else {
        metrics.push(mockMetricsForDryRun(task.id, pair.id));
      }
    }
    results.push(calculateSummary(pair, metrics));
  }

  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log("\n## 2x2 Model Role Evaluation Scorecard\n");
  console.log(formatScorecard(results));
  console.log("\n### Decision Rule:");
  console.log(
    "- Adopt Pair B ONLY IF solve rate matches Pair A and multimodal features are required.",
  );
  console.log(
    "- Otherwise, adopt Pair A (DeepSeek/DeepSeek) for lower cost and higher throughput.\n",
  );
}

if (import.meta.main) {
  void main();
}
