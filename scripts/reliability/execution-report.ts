import type { ReliabilityHistoryStore } from "../../apps/omp-extension/src/history-store";
import { runReportCli } from "./report-cli";

export interface ExecutionReportOptions {
  args?: string[];
  store?: ReliabilityHistoryStore;
  out?: (msg: string) => void;
}

export function runExecutionReport(options: ExecutionReportOptions = {}): {
  exitCode: number;
  lines: string[];
} {
  return runReportCli({
    ...options,
    defaultDays: 14,
    helpText:
      "Usage: bun scripts/reliability/execution-report.ts [--days=<n>] [--machine=<id|all>]",
    build: (store, opts) => store.buildExecutionReport(opts),
    exitCode: () => 0,
  });
}

export function generateExecutionReport(): void {
  const res = runExecutionReport();
  process.exit(res.exitCode);
}

if (import.meta.main) {
  generateExecutionReport();
}
