import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".omp", "agent");
}

export function heartbeatPath(): string {
  return path.join(agentDir(), "omp-toolkit-monitor.json");
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

export function writeHeartbeat(): void {
  writeFileAtomic(
    heartbeatPath(),
    `${JSON.stringify({ at: Date.now(), hostname: os.hostname(), pid: process.pid }, null, 2)}\n`,
  );
}
