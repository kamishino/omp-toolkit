import process from "node:process";
import {
  getHistoryStore,
  type ReliabilityHistoryStore,
} from "../../apps/omp-extension/src/history-store";

export interface ReportData {
  lines: string[];
  allPass?: boolean;
}

export type ReportResult =
  | { status: "no_history" | "no_matching_records"; message: string }
  | { status: "success"; data: ReportData };

export interface ReportCliOptions {
  args?: string[];
  store?: ReliabilityHistoryStore;
  out?: (msg: string) => void;
  defaultDays: number;
  helpText: string;
  build: (
    store: ReliabilityHistoryStore,
    options: { days: number; machineFilter: string },
  ) => ReportResult;
  exitCode: (data: ReportData) => number;
}

export function runReportCli(options: ReportCliOptions): {
  exitCode: number;
  lines: string[];
} {
  const args = options.args ?? process.argv.slice(2);
  const out = options.out ?? console.log;

  if (args.includes("--help") || args.includes("-h")) {
    out(options.helpText);
    return { exitCode: 0, lines: [options.helpText] };
  }

  const daysArg = args.find((arg: string) => arg.startsWith("--days="));
  const rawDays = Number(daysArg?.slice("--days=".length) ?? options.defaultDays);
  const days = Math.min(366, Math.max(1, Number.isFinite(rawDays) ? rawDays : options.defaultDays));

  const machineArg = args.find((arg: string) => arg.startsWith("--machine="));
  const machineFilter = machineArg?.slice("--machine=".length) ?? "all";

  const store = options.store ?? getHistoryStore();
  const res = options.build(store, { days, machineFilter });
  if (res.status !== "success") {
    out(res.message);
    return { exitCode: 1, lines: [res.message] };
  }

  for (const line of res.data.lines) {
    out(line);
  }
  return { exitCode: options.exitCode(res.data), lines: res.data.lines };
}
