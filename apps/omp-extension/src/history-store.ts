import { Database } from "bun:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type MonitorHeartbeat,
  resolveAgentDir,
  resolveHeartbeatPath,
  resolveHistoryDbPath,
} from "@omp-toolkit/core";

export interface EventRow {
  at: number;
  machine_id: string;
  kind: string;
  provider: string | null;
  account: string | null;
  status: string | null;
  incident_id: string | null;
  detail: string | null;
}

export interface LocalMachine {
  id?: string;
  hostname?: string;
  createdAt?: number;
}

export type LocalHeartbeat = MonitorHeartbeat;

export interface MachineIdentity {
  id: string;
  hostname: string;
  createdAt: number;
}

export interface HistoryEventInput {
  at: number;
  kind: string;
  provider?: string | null;
  account?: string | null;
  status?: string | null;
  incidentId?: string | null;
  detail?: string | null;
}

export interface MachineStats {
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

export interface ReportColumn {
  label: string;
  width: number;
}

export interface ReliabilityReportData {
  columns: ReportColumn[];
  lines: string[];
  allPass: boolean;
}

export type ReliabilityReportResult =
  | { status: "no_history" | "no_matching_records"; message: string }
  | { status: "success"; data: ReliabilityReportData };

const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

function writeAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, content);
  try {
    fs.renameSync(temp, file);
  } catch {
    fs.writeFileSync(file, content);
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // Best-effort temp cleanup
    }
  }
}

/**
 * Deep module encapsulating the OMP reliability history SQLite database,
 * schema migrations, machine identity resolution, and analytical reporting.
 */
export class ReliabilityHistoryStore {
  private db: Database | null = null;
  private cachedMachine: MachineIdentity | null = null;
  readonly dbPath: string;
  readonly agentDir: string;

  constructor(customDbPath?: string, customAgentDir?: string) {
    this.agentDir = customAgentDir ?? resolveAgentDir();
    this.dbPath = customDbPath ?? resolveHistoryDbPath();
  }

  getDatabase(readonly = false): Database {
    if (this.db) return this.db;
    if (!readonly) {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    }
    const db = new Database(this.dbPath, { create: !readonly, readonly });
    if (!readonly) {
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA busy_timeout = 5000");
      db.exec(`
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY,
          at INTEGER NOT NULL,
          machine_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          provider TEXT,
          account TEXT,
          status TEXT,
          incident_id TEXT,
          detail TEXT
        );
        CREATE INDEX IF NOT EXISTS events_at ON events(at);
        CREATE INDEX IF NOT EXISTS events_kind_at ON events(kind, at);
        CREATE INDEX IF NOT EXISTS events_incident ON events(incident_id);
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '1');
      `);
      db.query("DELETE FROM events WHERE at < ?").run(Date.now() - RETENTION_MS);
    }
    this.db = db;
    return db;
  }

  resetMachineCache(): void {
    this.cachedMachine = null;
  }

  machine(): MachineIdentity {
    if (this.cachedMachine) return this.cachedMachine;
    const file = path.join(this.agentDir, "omp-toolkit-machine.json");
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<MachineIdentity>;
      if (
        typeof parsed?.id !== "string" ||
        parsed.id.length === 0 ||
        typeof parsed?.hostname !== "string" ||
        typeof parsed?.createdAt !== "number"
      ) {
        throw new Error("invalid machine identity");
      }
      this.cachedMachine = {
        id: parsed.id,
        hostname: parsed.hostname,
        createdAt: parsed.createdAt,
      };
      return this.cachedMachine;
    } catch (error) {
      const isEnoent =
        typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
      if (!isEnoent) {
        throw new Error(`history: corrupt machine file ${file}: ${String(error)}`);
      }
      const created: MachineIdentity = {
        id: crypto.randomUUID(),
        hostname: os.hostname(),
        createdAt: Date.now(),
      };
      writeAtomic(file, `${JSON.stringify(created, null, 2)}\n`);
      this.cachedMachine = created;
      return created;
    }
  }

  machineId(): string {
    return this.machine().id;
  }

  recordEvent(event: HistoryEventInput): void {
    this.recordEvents([event]);
  }

  recordEvents(events: HistoryEventInput[], machineId?: string): void {
    if (events.length === 0) return;
    const mId = machineId ?? this.machineId();
    const db = this.getDatabase(false);
    const insert = db.query(`
      INSERT INTO events
        (at, machine_id, kind, provider, account, status, incident_id, detail)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const write = db.transaction((rows: HistoryEventInput[]) => {
      for (const row of rows) {
        insert.run(
          row.at,
          mId,
          row.kind,
          row.provider ?? null,
          row.account ?? null,
          row.status ?? null,
          row.incidentId ?? null,
          row.detail ?? null,
        );
      }
    });
    write(events);
  }

  queryEvents(sinceMs: number): EventRow[] {
    if (!fs.existsSync(this.dbPath)) return [];
    const db = this.getDatabase(true);
    return db
      .query(
        `SELECT at, machine_id, kind, provider, account, status, incident_id, detail
         FROM events
         WHERE at >= ?
         ORDER BY at ASC`,
      )
      .all(sinceMs) as EventRow[];
  }

  readLocalMachine(): LocalMachine | null {
    try {
      const file = path.join(this.agentDir, "omp-toolkit-machine.json");
      return JSON.parse(fs.readFileSync(file, "utf8")) as LocalMachine;
    } catch {
      return null;
    }
  }

  readLocalHeartbeat(): LocalHeartbeat | null {
    try {
      const file = resolveHeartbeatPath({ PI_CODING_AGENT_DIR: this.agentDir });
      return JSON.parse(fs.readFileSync(file, "utf8")) as LocalHeartbeat;
    } catch {
      return null;
    }
  }

  aggregateMachineStats(rows: EventRow[], machineFilter = "all"): Map<string, MachineStats> {
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
          stats.error++;
        }

        const date = new Date(row.at).toISOString().slice(0, 10);
        stats.checksByDay.set(date, (stats.checksByDay.get(date) ?? 0) + 1);
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

    for (const [id, startAt] of incidentAt.entries()) {
      const endAt = resolvedAt.get(id);
      if (endAt === undefined || endAt - startAt > 900_000) {
        const ownerRow = rows.find((r) => r.incident_id === id && r.kind === "incident");
        if (ownerRow) {
          const stats = statsByMachine.get(ownerRow.machine_id);
          if (stats) stats.late++;
        }
      }
    }

    return statsByMachine;
  }

  buildReport(
    options: { days?: number; machineFilter?: string; now?: number } = {},
  ): ReliabilityReportResult {
    if (!fs.existsSync(this.dbPath)) {
      return { status: "no_history", message: "no history" };
    }

    const days = Math.min(366, Math.max(1, options.days ?? 30));
    const machineFilter = options.machineFilter ?? "all";
    const now = options.now ?? Date.now();
    const nowDate = new Date(now);
    const windowStartUtc =
      Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate()) -
      (days - 1) * 86_400_000;

    let rows: EventRow[] = [];
    try {
      rows = this.queryEvents(windowStartUtc);
    } catch (error) {
      return { status: "no_history", message: `history read failed: ${String(error)}` };
    }

    if (rows.length === 0) {
      return { status: "no_history", message: "no history" };
    }

    const localMachine = this.readLocalMachine();
    const localHeartbeat = this.readLocalHeartbeat();
    const statsByMachine = this.aggregateMachineStats(rows, machineFilter);
    if (statsByMachine.size === 0) {
      return { status: "no_matching_records", message: "no history" };
    }

    const columns: ReportColumn[] = [
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

    const lines: string[] = [];
    lines.push(columns.map((col) => col.label.padEnd(col.width)).join(" "));

    let allPass = true;
    for (const stats of statsByMachine.values()) {
      const isLocal = localMachine?.id === stats.machineId;
      let label = stats.machineId.slice(0, 8);
      if (isLocal && localMachine?.hostname) {
        label = `${label} (${localMachine.hostname.slice(0, 10)})`;
      }

      let monitorAge = "unknown";
      if (isLocal && localHeartbeat?.at) {
        const delta = now - localHeartbeat.at;
        monitorAge = delta <= 10 * 60_000 ? "fresh" : "stale";
      } else if (isLocal) {
        monitorAge = "stale";
      }

      const coveredDays = stats.checksByDay.size;
      const daysFraction = `${coveredDays}/${days}`;

      const values = [
        label.padEnd(22),
        daysFraction.padEnd(9),
        String(stats.checks).padEnd(8),
        String(stats.ok).padEnd(7),
        String(stats.hang).padEnd(6),
        String(stats.error).padEnd(7),
        String(stats.auth).padEnd(6),
        String(stats.restores).padEnd(10),
        String(stats.manual).padEnd(8),
        String(stats.incidents).padEnd(11),
        String(stats.late).padEnd(6),
        monitorAge.padEnd(11),
      ];
      lines.push(values.join(" "));

      if (coveredDays < days || stats.manual > 0 || stats.late > 0) {
        allPass = false;
      }
    }

    return {
      status: "success",
      data: {
        columns,
        lines,
        allPass,
      },
    };
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

let sharedStore: ReliabilityHistoryStore | null = null;

export function getHistoryStore(): ReliabilityHistoryStore {
  if (!sharedStore) {
    sharedStore = new ReliabilityHistoryStore();
  }
  return sharedStore;
}

export function resetHistoryCachesForTest(): void {
  if (sharedStore) {
    sharedStore.resetMachineCache();
    sharedStore.close();
    sharedStore = null;
  }
}

export function machineId(): string {
  return getHistoryStore().machineId();
}

export function historyPath(): string {
  return getHistoryStore().dbPath;
}

export function recordEvent(event: HistoryEventInput): void {
  getHistoryStore().recordEvent(event);
}

export function recordEvents(events: HistoryEventInput[]): void {
  getHistoryStore().recordEvents(events);
}

export function closeHistory(): void {
  if (sharedStore) {
    sharedStore.close();
    sharedStore = null;
  }
}

process.on("exit", () => {
  closeHistory();
});
