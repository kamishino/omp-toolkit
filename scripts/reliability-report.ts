import { getHistoryStore } from "../apps/omp-extension/src/history-store";

export function generateReport(): void {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: bun scripts/reliability-report.ts [--days=<n>] [--machine=<id|all>]");
    process.exit(0);
  }

  const daysArg = args.find((arg) => arg.startsWith("--days="));
  const rawDays = Number(daysArg?.slice("--days=".length) ?? 30);
  const days = Math.min(366, Math.max(1, Number.isFinite(rawDays) ? rawDays : 30));

  const machineArg = args.find((arg) => arg.startsWith("--machine="));
  const machineFilter = machineArg?.slice("--machine=".length) ?? "all";

  const store = getHistoryStore();
  const res = store.buildReport({ days, machineFilter });
  if (res.status !== "success") {
    console.log(res.message);
    process.exit(1);
  }

  for (const line of res.data.lines) {
    console.log(line);
  }
  process.exit(res.data.allPass ? 0 : 1);
}

if (import.meta.main) {
  generateReport();
}
