import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type MonitorHeartbeat, resolveHeartbeatPath } from "@omp-toolkit/core";

export function heartbeatPath(env = process.env): string {
  return resolveHeartbeatPath(env);
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

export function writeHeartbeat(env = process.env): void {
  const payload: MonitorHeartbeat = {
    at: Date.now(),
    hostname: os.hostname(),
    pid: process.pid,
  };
  writeFileAtomic(heartbeatPath(env), `${JSON.stringify(payload, null, 2)}\n`);
}
