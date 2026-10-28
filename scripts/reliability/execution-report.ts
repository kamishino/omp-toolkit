import { getHistoryStore } from "../../apps/omp-extension/src/history-store";

export function generateExecutionReport(): void {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: bun scripts/reliability/execution-report.ts [--days=<n>] [--machine=<id|all>]",
    );
    process.exit(0);
  }

  const daysArg = args.find((arg) => arg.startsWith("--days="));
  const rawDays = Number(daysArg?.slice("--days=".length) ?? 14);
  const days = Math.min(366, Math.max(1, Number.isFinite(rawDays) ? rawDays : 14));

  const machineArg = args.find((arg) => arg.startsWith("--machine="));
  const machineFilter = machineArg?.slice("--machine=".length) ?? "all";

  const store = getHistoryStore();
  const res = store.buildExecutionReport({ days, machineFilter });
  if (res.status !== "success") {
    console.log(res.message);
    process.exit(1);
  }

  for (const line of res.data.lines) {
    console.log(line);
  }
  process.exit(0);
}

if (import.meta.main) {
  generateExecutionReport();
}
