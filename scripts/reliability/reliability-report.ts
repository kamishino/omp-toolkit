import type { ReliabilityHistoryStore } from "../../apps/omp-extension/src/history-store";
import { runReportCli } from "./report-cli";

export interface ReliabilityReportOptions {
  args?: string[];
  store?: ReliabilityHistoryStore;
  out?: (msg: string) => void;
}

export function runReliabilityReport(options: ReliabilityReportOptions = {}): {
  exitCode: number;
  lines: string[];
} {
  return runReportCli({
    ...options,
    defaultDays: 30,
    helpText:
      "Usage: bun scripts/reliability/reliability-report.ts [--days=<n>] [--machine=<id|all>]",
    build: (store, opts) => store.buildReport(opts),
    exitCode: (data) => (data.allPass ? 0 : 1),
  });
}

export function generateReport(): void {
  const res = runReliabilityReport();
  process.exit(res.exitCode);
}

if (import.meta.main) {
  generateReport();
}
