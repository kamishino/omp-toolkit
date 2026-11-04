import fs from "node:fs";
import path from "node:path";
import { portOfBind } from "./config";

export type DaemonKind = "broker" | "gateway" | "tunnel";

export interface DaemonRecord {
  kind: DaemonKind;
  pid: number;
  bind: string;
  startedAtMs: number;
  /** Substring that must appear in the pid's live command line before we stop it. */
  marker: string;
  /**
   * Second required command-line token. Records written before this field
   * existed fall back to `--bind=<bind>`.
   */
  match?: string;
}

export interface DaemonRecordStore {
  read(kind: DaemonKind, bind: string): DaemonRecord | null;
  write(record: DaemonRecord): void;
  remove(kind: DaemonKind, bind: string): void;
}

function recordFileName(kind: DaemonKind, bind: string): string {
  return `gateway-ctl-${kind}-${portOfBind(bind)}.json`;
}

export function createFileRecordStore(runDir: string): DaemonRecordStore {
  const fileFor = (kind: DaemonKind, bind: string) => path.join(runDir, recordFileName(kind, bind));
  return {
    read(kind, bind) {
      try {
        return JSON.parse(fs.readFileSync(fileFor(kind, bind), "utf-8")) as DaemonRecord;
      } catch {
        return null;
      }
    },
    write(record) {
      fs.mkdirSync(runDir, { recursive: true });
      const file = fileFor(record.kind, record.bind);
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
      fs.renameSync(tmp, file);
    },
    remove(kind, bind) {
      try {
        fs.rmSync(fileFor(kind, bind), { force: true });
      } catch {
        // best effort cleanup
      }
    },
  };
}
