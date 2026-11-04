import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface OmpProcessInfo {
  pid: number;
  commandLine: string;
}

/** Seam over the external omp/cloudflared binaries and OS process table. */
export interface OmpAdapter {
  resolveOmpPath(): Promise<string | null>;
  runOmpText(args: string[]): Promise<string | null>;
  launch(args: string[], env: Record<string, string>): Promise<number>;
  listOmpProcesses(): Promise<OmpProcessInfo[]>;
  commandLineOf(pid: number): Promise<string | null>;
  kill(pid: number): Promise<void>;
  resolveCloudflaredPath(cloudflaredBin: string): Promise<string | null>;
  runCloudflaredText(cloudflaredBin: string, args: string[]): Promise<string | null>;
  launchExe(exe: string, args: string[], env: Record<string, string>): Promise<number>;
}

async function tryExec(file: string, args: string[], timeout = 15_000): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, { timeout, windowsHide: true });
    return `${stdout?.toString() ?? ""}\n${stderr?.toString() ?? ""}`.trim();
  } catch (err) {
    const e = err as { stdout?: string | Buffer; stderr?: string | Buffer };
    const text = `${e.stdout?.toString() ?? ""}\n${e.stderr?.toString() ?? ""}`.trim();
    return text.length > 0 ? text : null;
  }
}

export function createOmpAdapter(ompBin: string): OmpAdapter {
  const isWindows = process.platform === "win32";
  let cachedPath: string | null | undefined;

  async function listProcesses(): Promise<OmpProcessInfo[]> {
    if (isWindows) {
      const out = await tryExec("powershell", [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name='omp.exe' OR Name='cloudflared.exe'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }",
      ]);
      if (!out) return [];
      return out
        .split("\n")
        .map((line) => {
          const tab = line.indexOf("\t");
          if (tab < 0) return null;
          const pid = Number(line.slice(0, tab));
          return Number.isFinite(pid) ? { pid, commandLine: line.slice(tab + 1).trim() } : null;
        })
        .filter((p): p is OmpProcessInfo => p !== null);
    }
    const out = await tryExec("ps", ["-eo", "pid=,command="]);
    if (!out) return [];
    return out
      .split("\n")
      .map((line) => {
        const match = line.trim().match(/^(\d+)\s+(.*)$/);
        if (!match?.[2] || (!match[2].includes("omp") && !match[2].includes("cloudflared")))
          return null;
        return { pid: Number(match[1]), commandLine: match[2] };
      })
      .filter((p): p is OmpProcessInfo => p !== null);
  }

  async function resolveBinOnPath(bin: string): Promise<string | null> {
    if ((bin.includes("/") || bin.includes("\\")) && fs.existsSync(bin)) return bin;
    const out = isWindows ? await tryExec("where", [bin]) : await tryExec("which", [bin]);
    return (
      out
        ?.split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0) ?? null
    );
  }

  async function launchDetached(exe: string, args: string[], env: Record<string, string>) {
    const child = spawn(exe, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, ...env },
    });
    child.unref();
    if (typeof child.pid !== "number") throw new Error(`failed to launch ${exe} ${args.join(" ")}`);
    return child.pid;
  }

  return {
    async resolveOmpPath(): Promise<string | null> {
      if (cachedPath !== undefined) return cachedPath;
      cachedPath =
        (await resolveBinOnPath(ompBin)) ??
        ((await this.runOmpText(["--version"])) !== null ? ompBin : null);
      return cachedPath;
    },
    async runOmpText(args: string[]): Promise<string | null> {
      return tryExec(ompBin, args, 30_000);
    },
    async launch(args: string[], env: Record<string, string>): Promise<number> {
      return launchDetached((await this.resolveOmpPath()) ?? ompBin, args, env);
    },
    async resolveCloudflaredPath(cloudflaredBin: string): Promise<string | null> {
      return (
        (await resolveBinOnPath(cloudflaredBin)) ??
        ((await tryExec(cloudflaredBin, ["version"], 30_000)) !== null ? cloudflaredBin : null)
      );
    },
    async runCloudflaredText(cloudflaredBin: string, args: string[]): Promise<string | null> {
      return tryExec(cloudflaredBin, args, 30_000);
    },
    async launchExe(exe, args, env): Promise<number> {
      return launchDetached(exe, args, env);
    },
    // Match on the executable token only: a tunnel command line can
    // mention .omp paths (its --config file) without being an omp process.
    listOmpProcesses: async () =>
      (await listProcesses()).filter((p) => (p.commandLine.split(/\s/)[0] ?? "").includes("omp")),
    async commandLineOf(pid: number): Promise<string | null> {
      const found = (await listProcesses()).find((p) => p.pid === pid);
      return found ? found.commandLine : null;
    },
    async kill(pid: number): Promise<void> {
      if (isWindows) {
        const result = await tryExec("taskkill", ["/PID", String(pid), "/F"]);
        if (result === null) throw new Error(`taskkill failed for pid ${pid}`);
        return;
      }
      process.kill(pid, "SIGTERM");
    },
  };
}
