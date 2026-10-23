import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HistoryEvent } from "@omp-toolkit/core";
import { ReliabilityHistoryStore } from "./history-store";

export type HistoryEventInput = Omit<HistoryEvent, "machineId">;

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
let sharedStore: ReliabilityHistoryStore | null = null;

function getStore(): ReliabilityHistoryStore {
  const file = historyPath();
  if (sharedStore && sharedStore.dbPath === file) return sharedStore;
  if (sharedStore) {
    sharedStore.close();
  }
  sharedStore = new ReliabilityHistoryStore(file);
  return sharedStore;
}

export function recordEvent(event: HistoryEventInput): void {
  recordEvents([event]);
}

export function recordEvents(events: HistoryEventInput[]): void {
  if (events.length === 0) return;
  getStore().recordEvents(events, machineId());
}

export function closeHistory(): void {
  if (sharedStore) {
    sharedStore.close();
    sharedStore = null;
  }
}

process.on("exit", () => {
  try {
    closeHistory();
  } catch {
    // Process exit must not throw.
  }
});
