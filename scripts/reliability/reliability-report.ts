import {
  getHistoryStore,
  type ReliabilityHistoryStore,
} from "../../apps/omp-extension/src/history-store";

export interface ReliabilityReportOptions {
  args?: string[];
  store?: ReliabilityHistoryStore;
  out?: (msg: string) => void;
}

export function runReliabilityReport(options: ReliabilityReportOptions = {}): {
  exitCode: number;
  lines: string[];
} {
  const args = options.args ?? process.argv.slice(2);
  const out = options.out ?? console.log;

  if (args.includes("--help") || args.includes("-h")) {
    const helpMsg =
      "Usage: bun scripts/reliability/reliability-report.ts [--days=<n>] [--machine=<id|all>]";
    out(helpMsg);
    return { exitCode: 0, lines: [helpMsg] };
  }

  const daysArg = args.find((arg) => arg.startsWith("--days="));
  const rawDays = Number(daysArg?.slice("--days=".length) ?? 30);
  const days = Math.min(366, Math.max(1, Number.isFinite(rawDays) ? rawDays : 30));

  const machineArg = args.find((arg) => arg.startsWith("--machine="));
  const machineFilter = machineArg?.slice("--machine=".length) ?? "all";

  const store = options.store ?? getHistoryStore();
  const res = store.buildReport({ days, machineFilter });
  if (res.status !== "success") {
    out(res.message);
    return { exitCode: 1, lines: [res.message] };
  }

  for (const line of res.data.lines) {
    out(line);
  }
  return { exitCode: res.data.allPass ? 0 : 1, lines: res.data.lines };
}

export function generateReport(): void {
  const res = runReliabilityReport();
  process.exit(res.exitCode);
}

if (import.meta.main) {
  generateReport();
}
