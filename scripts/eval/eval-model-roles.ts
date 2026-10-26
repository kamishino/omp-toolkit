/**
 * 2x2 Model Role Empirical Evaluation Harness.
 *
 * Compares candidate model pairings for planning and execution roles
 * across representative repository tasks.
 *
 * Usage:
 *   bun scripts/eval/eval-model-roles.ts --list
 *   bun scripts/eval/eval-model-roles.ts --dry-run
 *   bun scripts/eval/eval-model-roles.ts --live --task=T1 --report
 *   bun scripts/eval-model-roles.ts --pair=B --report
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  calculateModelCost,
  calculateSummary,
  estimateTokenCount,
  formatScorecard,
  type ModelPairConfig,
  mockMetricsForDryRun,
  PAIR_CONFIGS,
  type PairEvaluationResult,
  type TaskMetrics,
} from "./eval-metrics";
import { BENCHMARK_TASKS, type BenchmarkTask, TASK_PROMPTS } from "./eval-tasks";

export * from "./eval-metrics";
export * from "./eval-tasks";

export interface PromptExecutionResult {
  text: string;
  seconds: number;
  ok: boolean;
}

export function executeOmpPrompt(
  model: string,
  prompt: string,
  timeoutMs = 60_000,
): Promise<PromptExecutionResult> {
  const { promise, resolve } = Promise.withResolvers<PromptExecutionResult>();
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
  let timer: NodeJS.Timeout | null = setTimeout(() => {
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

  return promise;
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

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const opts = parseCliArgs(argv);

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
