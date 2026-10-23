import fs from "node:fs";
import { type EventRow, ReliabilityHistoryStore } from "../apps/omp-extension/src/history-store";

function pad(text: string, width: number): string {
  return text.padEnd(width);
}

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

  const store = new ReliabilityHistoryStore();
  if (!fs.existsSync(store.dbPath)) {
    console.log("no history");
    process.exit(1);
  }

  const now = Date.now();
  const nowDate = new Date(now);
  const windowStartUtc =
    Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate()) -
    (days - 1) * 86_400_000;

  let rows: EventRow[] = [];
  try {
    rows = store.queryEvents(windowStartUtc);
  } catch (error) {
    console.error(`history read failed: ${String(error)}`);
    process.exit(1);
  }

  if (rows.length === 0) {
    console.log("no history");
    process.exit(1);
  }

  const localMachine = store.readLocalMachine();
  const localHeartbeat = store.readLocalHeartbeat();
  const statsByMachine = store.aggregateMachineStats(rows, machineFilter);
  if (statsByMachine.size === 0) {
    console.log("no history");
    process.exit(1);
  }

  const columns = [
    { label: "machine", width: 22 },
    { label: "days", width: 9 },
    { label: "checks", width: 8 },
    { label: "ok", width: 7 },
    { label: "hang", width: 6 },
    { label: "error", width: 7 },
    { label: "auth", width: 6 },
    { label: "restores", width: 10 },
    { label: "manual", width: 8 },
    { label: "incidents", width: 11 },
    { label: "late", width: 6 },
    { label: "monitor-age", width: 11 },
  ];

  const headerLine = columns.map((col) => pad(col.label, col.width)).join(" ");
  console.log(headerLine);

  let allPass = true;

  for (const stats of statsByMachine.values()) {
    const isLocal = localMachine?.id === stats.machineId;
    let label = stats.machineId.slice(0, 8);
    if (isLocal && localMachine?.hostname) {
      label = `${label} (${localMachine.hostname.slice(0, 10)})`;
    }

    let monitorAge = "unknown";
    if (isLocal && localHeartbeat?.at) {
      const delta = Date.now() - localHeartbeat.at;
      monitorAge = delta <= 10 * 60_000 ? "fresh" : "stale";
    } else if (isLocal) {
      monitorAge = "stale";
    }

    const coveredDays = stats.checksByDay.size;
    const daysFraction = `${coveredDays}/${days}`;

    const values = [
      pad(label, 22),
      pad(daysFraction, 9),
      pad(String(stats.checks), 8),
      pad(String(stats.ok), 7),
      pad(String(stats.hang), 6),
      pad(String(stats.error), 7),
      pad(String(stats.auth), 6),
      pad(String(stats.restores), 10),
      pad(String(stats.manual), 8),
      pad(String(stats.incidents), 11),
      pad(String(stats.late), 6),
      pad(monitorAge, 11),
    ];
    console.log(values.join(" "));

    if (coveredDays < days || stats.manual > 0 || stats.late > 0) {
      allPass = false;
    }
  }

  process.exit(allPass ? 0 : 1);
}

if (import.meta.main) {
  generateReport();
}
