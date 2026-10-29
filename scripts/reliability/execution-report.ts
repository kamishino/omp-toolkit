import {
  getHistoryStore,
  type ReliabilityHistoryStore,
} from "../../apps/omp-extension/src/history-store";

export interface ExecutionReportOptions {
  args?: string[];
  store?: ReliabilityHistoryStore;
  out?: (msg: string) => void;
}

export function runExecutionReport(options: ExecutionReportOptions = {}): {
  exitCode: number;
  lines: string[];
} {
  const args = options.args ?? process.argv.slice(2);
  const out = options.out ?? console.log;

  if (args.includes("--help") || args.includes("-h")) {
    const helpMsg =
      "Usage: bun scripts/reliability/execution-report.ts [--days=<n>] [--machine=<id|all>]";
    out(helpMsg);
    return { exitCode: 0, lines: [helpMsg] };
  }

  const daysArg = args.find((arg) => arg.startsWith("--days="));
  const rawDays = Number(daysArg?.slice("--days=".length) ?? 14);
  const days = Math.min(366, Math.max(1, Number.isFinite(rawDays) ? rawDays : 14));

  const machineArg = args.find((arg) => arg.startsWith("--machine="));
  const machineFilter = machineArg?.slice("--machine=".length) ?? "all";

  const store = options.store ?? getHistoryStore();
  const res = store.buildExecutionReport({ days, machineFilter });
  if (res.status !== "success") {
    out(res.message);
    return { exitCode: 1, lines: [res.message] };
  }

  for (const line of res.data.lines) {
    out(line);
  }
  return { exitCode: 0, lines: res.data.lines };
}

export function generateExecutionReport(): void {
  const res = runExecutionReport();
  process.exit(res.exitCode);
}

if (import.meta.main) {
  generateExecutionReport();
}
