import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { quote } from "shell-quote";

function copyToClipboard(text: string): void {
  try {
    // biome-ignore lint/suspicious/noExplicitAny: electron runtime detection
    const electron = (globalThis as any).require?.("electron");
    if (electron && typeof electron.clipboard?.writeText === "function") {
      electron.clipboard.writeText(text);
    }
  } catch {
    // Ignore when running outside Electron runtime (e.g. in unit tests)
  }
}

export interface Command {
  file: string;
  args: string[];
  cwd?: string;
}

export function appleScriptString(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")}"`;
}

export function commandLine(platform: NodeJS.Platform, command: string[]): string {
  if (platform === "win32") {
    return command
      .map((arg) => (arg.includes(" ") ? `"${arg.replace(/"/g, '\\"')}"` : arg))
      .join(" ");
  }
  return quote(command);
}

export function terminalInvocations(platform: NodeJS.Platform, command: string[]): Command[] {
  if (platform === "win32") {
    return [
      {
        file: "cmd.exe",
        args: ["/c", "start", "", ...command],
      },
    ];
  }

  if (platform === "darwin") {
    const shellCmd = quote(command);
    return [
      {
        file: "osascript",
        args: [
          "-e",
          'tell application "Terminal" to activate',
          "-e",
          `tell application "Terminal" to do script ${appleScriptString(shellCmd)}`,
        ],
      },
    ];
  }

  // Linux candidates
  return [
    { file: "x-terminal-emulator", args: ["-e", ...command] },
    { file: "gnome-terminal", args: ["--", ...command] },
    { file: "konsole", args: ["-e", ...command] },
    { file: "xterm", args: ["-e", ...command] },
  ];
}

export function orcaInvocation(checkout: string, bun: string): Command {
  return {
    file: bun,
    args: ["run", "monitor:orca", "--restart"],
    cwd: checkout,
  };
}

export function findInPath(file: string): boolean {
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
  copyToClipboard(str);
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
