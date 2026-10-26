export interface BenchmarkTask {
  id: "T1" | "T2" | "T3" | "T4" | "T5";
  domain: string;
  title: string;
  description: string;
  verificationCommand: string;
}

export interface BenchmarkTaskPrompt {
  id: string;
  planPrompt: string;
  planVerificationKeywords: string[];
  executionPrompt: (planText: string) => string;
  solutionVerificationKeywords: string[];
}

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
