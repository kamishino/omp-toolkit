import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Write audit into the shared History events table
 * (omp-toolkit-history.db, schema owned by apps/omp-extension history-store).
 * Events use kind `gateway.*`; account carries `id:<credentialId>` only.
 */
export interface AuditEvent {
  at: number;
  kind: string;
  provider: string | null;
  account: string | null;
  detail: string | null;
}

export interface GatewayAudit {
  record(event: AuditEvent): Promise<void>;
  /** Newest-first gateway events, optionally filtered by exact kind/account. */
  latest(kind: string, account?: string): Promise<AuditEvent | null>;
}

type SqliteDatabase = {
  exec: (sql: string) => void;
  query: (sql: string) => {
    run: (...args: unknown[]) => unknown;
    get: (...args: unknown[]) => unknown;
  };
  close: () => void;
};

async function openDb(dbPath: string, readonly: boolean): Promise<SqliteDatabase> {
  const sqlite = (await import("bun:sqlite")) as unknown as {
    Database: new (
      path: string,
      options?: { readonly?: boolean; create?: boolean },
    ) => SqliteDatabase;
  };
  return new sqlite.Database(dbPath, { readonly, create: !readonly });
}

export function resolveMachineId(machinePath: string): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(machinePath, "utf-8")) as { id?: unknown };
    if (typeof parsed.id === "string" && parsed.id.length > 0) return parsed.id;
  } catch {
    // fall through to a stable local label; the extension owns identity creation
  }
  return `gateway-ctl:${os.hostname()}`;
}

export function createHistoryAudit(historyDbPath: string, machinePath: string): GatewayAudit {
  return {
    async record(event: AuditEvent): Promise<void> {
      fs.mkdirSync(path.dirname(historyDbPath), { recursive: true });
      const db = await openDb(historyDbPath, false);
      try {
        db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
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
        `);
        db.query(
          "INSERT INTO events (at, machine_id, kind, provider, account, status, incident_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(
          event.at,
          resolveMachineId(machinePath),
          event.kind,
          event.provider,
          event.account,
          null,
          null,
          event.detail,
        );
      } finally {
        db.close();
      }
    },
    async latest(kind: string, account?: string): Promise<AuditEvent | null> {
      if (!fs.existsSync(historyDbPath)) return null;
      const db = await openDb(historyDbPath, true);
      try {
        const row = (
          account !== undefined
            ? db
                .query(
                  "SELECT at, kind, provider, account, detail FROM events WHERE kind = ? AND account = ? ORDER BY at DESC, id DESC LIMIT 1",
                )
                .get(kind, account)
            : db
                .query(
                  "SELECT at, kind, provider, account, detail FROM events WHERE kind = ? ORDER BY at DESC, id DESC LIMIT 1",
                )
                .get(kind)
        ) as AuditEvent | null;
        return row ?? null;
      } catch {
        return null;
      } finally {
        db.close();
      }
    },
  };
}
