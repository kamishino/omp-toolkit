import os from "node:os";
import { type MonitorHeartbeat, resolveHeartbeatPath } from "@omp-toolkit/core";
import { writeFileAtomic } from "./fs-util";

export function writeHeartbeat(env = process.env): void {
  const payload: MonitorHeartbeat = {
    at: Date.now(),
    hostname: os.hostname(),
    pid: process.pid,
  };
  writeFileAtomic(resolveHeartbeatPath(env), `${JSON.stringify(payload, null, 2)}\n`);
}
