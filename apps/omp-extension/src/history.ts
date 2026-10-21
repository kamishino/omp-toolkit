import { Database } from "bun:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HistoryEvent } from "@omp-toolkit/core";

export type HistoryEventInput = Omit<HistoryEvent, "machineId">;

const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export interface MachineIdentity {
  id: string;
  hostname: string;
  createdAt: number;
}

function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".omp", "agent");
}

export function historyPath(): string {
  return process.env.OMP_TOOLKIT_HISTORY_DB ?? path.join(agentDir(), "omp-toolkit-history.db");
}

function machinePath(): string {
  return path.join(agentDir(), "omp-toolkit-machine.json");
}

function writeFileAtomic(file: string, content: string): void {
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
      // Best effort.
    }
  }
}

let cachedMachine: MachineIdentity | null = null;

export function resetHistoryCachesForTest(): void {
  cachedMachine = null;
}

export function machineId(): string {
  return machine().id;
}

function machine(): MachineIdentity {
  if (cachedMachine) return cachedMachine;
  const file = machinePath();
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
    cachedMachine = {
      id: parsed.id,
      hostname: parsed.hostname,
      createdAt: parsed.createdAt,
    };
    return cachedMachine;
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
    writeFileAtomic(file, `${JSON.stringify(created, null, 2)}\n`);
    cachedMachine = created;
    return created;
  }
}
let databaseHandle: Database | null = null;
let databasePath: string | null = null;

function database(): Database {
  const file = historyPath();
  if (databaseHandle && databasePath === file) return databaseHandle;
  if (databaseHandle) {
    databaseHandle.close();
    databaseHandle = null;
    databasePath = null;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file, { create: true });
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
  databaseHandle = db;
  databasePath = file;
  return db;
}

export function recordEvent(event: HistoryEventInput): void {
  recordEvents([event]);
}

export function recordEvents(events: HistoryEventInput[]): void {
  if (events.length === 0) return;
  const db = database();
  const insert = db.query(`
    INSERT INTO events
      (at, machine_id, kind, provider, account, status, incident_id, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const id = machineId();
  const write = db.transaction((rows: HistoryEventInput[]) => {
    for (const row of rows) {
      insert.run(
        row.at,
        id,
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

export function closeHistory(): void {
  if (databaseHandle) {
    databaseHandle.close();
    databaseHandle = null;
    databasePath = null;
  }
}

process.on("exit", () => {
  try {
    closeHistory();
  } catch {
    // Process exit must not throw.
  }
});
