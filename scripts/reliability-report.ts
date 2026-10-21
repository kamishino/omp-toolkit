import { Database } from "bun:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface EventRow {
  at: number;
  machine_id: string;
  kind: string;
  provider: string | null;
  account: string | null;
  status: string | null;
  incident_id: string | null;
  detail: string | null;
}

interface LocalMachine {
  id?: string;
  hostname?: string;
}

interface LocalHeartbeat {
  at?: number;
  hostname?: string;
  pid?: number;
}

interface MachineStats {
  machineId: string;
  checks: number;
  ok: number;
  hang: number;
  error: number;
  auth: number;
  restores: number;
  manual: number;
  incidents: number;
  late: number;
  checksByDay: Map<string, number>;
}

function resolveAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".omp", "agent");
}

function resolveDbPath(): string {
  return (
    process.env.OMP_TOOLKIT_HISTORY_DB ?? path.join(resolveAgentDir(), "omp-toolkit-history.db")
  );
}

function readLocalMachine(agentDir: string): LocalMachine | null {
  try {
    const file = path.join(agentDir, "omp-toolkit-machine.json");
    return JSON.parse(fs.readFileSync(file, "utf8")) as LocalMachine;
  } catch {
    return null;
  }
}

function readLocalHeartbeat(agentDir: string): LocalHeartbeat | null {
  try {
    const file = path.join(agentDir, "omp-toolkit-monitor.json");
    return JSON.parse(fs.readFileSync(file, "utf8")) as LocalHeartbeat;
  } catch {
    return null;
  }
}

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

  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    console.log("no history");
    process.exit(1);
  }

  const now = Date.now();
  const nowDate = new Date(now);
  const windowStartUtc =
    Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate()) -
    (days - 1) * 86_400_000;

  let db: Database;
  let rows: EventRow[] = [];
  try {
    db = new Database(dbPath, { readonly: true });
    rows = db
      .query(
        `SELECT at, machine_id, kind, provider, account, status, incident_id, detail
         FROM events
         WHERE at >= ?
         ORDER BY at ASC`,
      )
      .all(windowStartUtc) as EventRow[];
    db.close();
  } catch (error) {
    console.error(`history read failed: ${String(error)}`);
    process.exit(1);
  }

  if (rows.length === 0) {
    console.log("no history");
    process.exit(1);
  }

  const agentDir = resolveAgentDir();
  const localMachine = readLocalMachine(agentDir);
  const localHeartbeat = readLocalHeartbeat(agentDir);

  const statsByMachine = new Map<string, MachineStats>();
  const incidentAt = new Map<string, number>();
  const resolvedAt = new Map<string, number>();

  for (const row of rows) {
    if (machineFilter !== "all" && !row.machine_id.startsWith(machineFilter)) {
      continue;
    }

    let stats = statsByMachine.get(row.machine_id);
    if (!stats) {
      stats = {
        machineId: row.machine_id,
        checks: 0,
        ok: 0,
        hang: 0,
        error: 0,
        auth: 0,
        restores: 0,
        manual: 0,
        incidents: 0,
        late: 0,
        checksByDay: new Map(),
      };
      statsByMachine.set(row.machine_id, stats);
    }

    if (row.kind === "route_check") {
      stats.checks++;
      const status = row.status?.toLowerCase();
      if (status === "ok") {
        stats.ok++;
      } else if (status === "hang") {
        stats.hang++;
      } else if (status === "auth") {
        stats.auth++;
      } else {
        stats.error++; // model-error or any unknown failure counts as error
      }
      const dayKey = new Date(row.at).toISOString().slice(0, 10);
      stats.checksByDay.set(dayKey, (stats.checksByDay.get(dayKey) ?? 0) + 1);
    } else if (row.kind === "restore") {
      stats.restores++;
    } else if (row.kind === "manual_intervention") {
      stats.manual++;
    } else if (row.kind === "incident") {
      stats.incidents++;
      if (row.incident_id) {
        incidentAt.set(row.incident_id, row.at);
      }
    } else if (row.kind === "incident_resolved") {
      if (row.incident_id) {
        resolvedAt.set(row.incident_id, row.at);
      }
    }
  }

  // Calculate late incidents (> 15 minutes = 900,000 ms to resolve)
  for (const [id, startAt] of incidentAt.entries()) {
    const endAt = resolvedAt.get(id);
    if (endAt === undefined || endAt - startAt > 900_000) {
      // Find which machine owned this incident
      const ownerRow = rows.find((r) => r.incident_id === id && r.kind === "incident");
      if (ownerRow) {
        const stats = statsByMachine.get(ownerRow.machine_id);
        if (stats) stats.late++;
      }
    }
  }

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
