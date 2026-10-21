import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { clipboard } from "electron";
import { commandLine, orcaInvocation, terminalInvocations } from "./open-commands";

function findInPath(file: string): boolean {
  if (path.isAbsolute(file)) {
    return fs.existsSync(file);
  }
  const dirs = (process.env.PATH ?? "").split(path.delimiter);
  return dirs.some((dir) => {
    try {
      return fs.existsSync(path.join(dir, file));
    } catch {
      return false;
    }
  });
}

export function openTerminal(platform: NodeJS.Platform, command: string[]): "opened" | "copied" {
  const candidates = terminalInvocations(platform, command);

  for (const candidate of candidates) {
    if (!findInPath(candidate.file)) {
      continue;
    }

    try {
      const child = spawn(candidate.file, candidate.args, {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      child.unref();
      return "opened";
    } catch {
      // try next candidate
    }
  }

  const str = commandLine(platform, command);
  clipboard.writeText(str);
  return "copied";
}

export function openOrca(checkout: string | null, bun: string | null): void {
  if (!checkout) {
    throw new Error("OMP toolkit checkout not found. Set OMP_TOOLKIT_HOME or reinstall.");
  }
  if (!bun) {
    throw new Error("Bun was not found. Install Bun or set BUN_BIN.");
  }

  const cmd = orcaInvocation(checkout, bun);
  const child = spawn(cmd.file, cmd.args, {
    cwd: cmd.cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}
