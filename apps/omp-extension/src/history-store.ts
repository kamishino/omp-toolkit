import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import { resolveAgentDir, resolveHistoryDbPath } from "@omp-toolkit/core";
import type { HistoryEventInput } from "./history";

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
}

export interface LocalHeartbeat {
  at?: number;
  hostname?: string;
  pid?: number;
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

const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

/**
 * Deep module encapsulating the OMP reliability history SQLite database,
 * schema migrations, event persistence, and analytical reporting queries.
 */
export class ReliabilityHistoryStore {
  private db: Database | null = null;
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

  recordEvents(events: HistoryEventInput[], machineId: string): void {
    if (events.length === 0) return;
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
          machineId,
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
      const file = path.join(this.agentDir, "omp-toolkit-monitor.json");
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

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
