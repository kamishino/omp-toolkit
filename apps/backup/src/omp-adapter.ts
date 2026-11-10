import { Database } from "bun:sqlite";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  assertSupportedAuthSchemaVersion,
  validateBackupRuntimeVersion,
} from "@omp-toolkit/core/backup";

export interface BackupProcessInfo {
  pid: number;
  commandLine: string | null;
}

export interface BackupLockHandle {
  release(): Promise<void>;
}

export interface BackupRuntime {
  platform: NodeJS.Platform;
  getVersion(ompPath?: string): Promise<string>;
  listProcesses(): Promise<readonly BackupProcessInfo[]>;
  initializeVault(agentDir: string, ompPath?: string): Promise<void>;
  acquireLock(lockPath: string): Promise<BackupLockHandle>;
  launch(
    args: readonly string[],
    env: Record<string, string | undefined>,
    cwd: string,
    ompPath?: string,
  ): Promise<number>;
}

export interface BackupContext {
  home: string;
  env: Record<string, string | undefined>;
  runtime: BackupRuntime;
}

export function createBackupRuntime(defaultOmpBin = "omp"): BackupRuntime {
  const platform = process.platform;

  return {
    platform,

    async getVersion(ompPath: string = defaultOmpBin): Promise<string> {
      try {
        const proc = Bun.spawn([ompPath, "--version"], {
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, _stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        if (exitCode !== 0) {
          throw new Error("Unable to determine OMP version.");
        }
        return validateBackupRuntimeVersion(stdout);
      } catch (err: unknown) {
        if (err instanceof Error) {
          if (
            err.message.startsWith("Unsupported OMP version") ||
            err.message.startsWith("Unrecognized OMP version output")
          ) {
            throw err;
          }
        }
        throw new Error("Unable to determine OMP version.");
      }
    },

    async listProcesses(): Promise<readonly BackupProcessInfo[]> {
      if (platform !== "win32") {
        return [];
      }

      const proc = Bun.spawn(
        [
          "powershell.exe",
          "-NoProfile",
          "-Command",
          "Get-CimInstance Win32_Process -Filter \"Name like 'omp%'\" | Select-Object -Property ProcessId, CommandLine | ConvertTo-Json",
        ],
        { stdout: "pipe", stderr: "pipe" },
      );

      const [stdout, _stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      if (exitCode !== 0) {
        throw new Error("Process check failed: unable to query Windows processes.");
      }

      const output = stdout.trim();
      if (!output || output === "null") {
        return [];
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(output);
      } catch {
        throw new Error("Process check failed: unable to parse running process details.");
      }

      const items = Array.isArray(parsed) ? parsed : [parsed];
      const results: BackupProcessInfo[] = [];

      for (const item of items) {
        if (item && typeof item === "object" && "ProcessId" in item) {
          const pid = Number(item.ProcessId);
          const commandLine =
            "CommandLine" in item && typeof item.CommandLine === "string" ? item.CommandLine : null;
          results.push({ pid, commandLine });
        }
      }

      return results;
    },

    async initializeVault(agentDir: string, ompPath: string = defaultOmpBin): Promise<void> {
      fs.mkdirSync(agentDir, { recursive: true });

      const tmpHome = path.join(
        os.tmpdir(),
        `omp-vault-init-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
      );
      fs.mkdirSync(tmpHome, { recursive: true });

      const childEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (v === undefined) continue;
        if (
          k.startsWith("OMP_AUTH_BROKER_") ||
          k === "OMP_PROFILE" ||
          k === "PI_PROFILE" ||
          k === "PI_CONFIG_FILES" ||
          k === "PI_CONFIG_DIR" ||
          k.startsWith("XDG_")
        ) {
          continue;
        }
        childEnv[k] = v;
      }
      childEnv.USERPROFILE = tmpHome;
      childEnv.HOME = tmpHome;
      childEnv.PI_CODING_AGENT_DIR = agentDir;

      const proc = Bun.spawn([ompPath, "--profile", "default", "auth", "import", "-"], {
        cwd: tmpHome,
        env: childEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      proc.stdin.write('{"version":1,"credentials":[]}\n');
      proc.stdin.flush();
      proc.stdin.end();

      const exitCode = await proc.exited;
      try {
        fs.rmSync(tmpHome, { recursive: true, force: true });
      } catch {}

      const dbPath = path.join(agentDir, "agent.db");
      if (exitCode !== 0 || !fs.existsSync(dbPath)) {
        throw new Error("Failed to initialize empty auth database from native OMP runtime.");
      }

      const db = new Database(dbPath, { readonly: true });
      try {
        const row = db.query("SELECT version FROM auth_schema_version WHERE id = 1").get() as {
          version?: number;
        } | null;
        assertSupportedAuthSchemaVersion(row?.version);
      } finally {
        db.close();
      }
    },

    async acquireLock(lockPath: string): Promise<BackupLockHandle> {
      const parentDir = path.dirname(lockPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      if (platform === "win32") {
        const psScript = `
$ErrorActionPreference = 'Stop'
try {
    $fs = [System.IO.File]::Open('${lockPath.replace(/'/g, "''")}', [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    [Console]::Out.WriteLine('LOCKED')
    [Console]::Out.Flush()
    [Console]::In.ReadLine() | Out-Null
    $fs.Close()
    $fs.Dispose()
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
`;
        const proc = Bun.spawn(["powershell.exe", "-NoProfile", "-Command", psScript], {
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
        });

        const reader = proc.stdout.getReader();
        const { value } = await reader.read();
        reader.releaseLock();

        const text = value ? new TextDecoder().decode(value).trim() : "";
        if (!text.includes("LOCKED")) {
          const errText = await new Response(proc.stderr).text();
          throw new Error(
            `Target profile lock '${lockPath}' is already held by another process: ${errText.trim()}`,
          );
        }

        return {
          async release(): Promise<void> {
            try {
              proc.stdin.write("\n");
              proc.stdin.flush();
              proc.stdin.end();
            } catch {}
            await proc.exited;
            try {
              if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
            } catch {}
          },
        };
      }

      // Non-Windows lock implementation
      let fd: number | null = null;
      try {
        fd = fs.openSync(lockPath, "wx");
        fs.writeFileSync(fd, `${process.pid}\n`, "utf8");
      } catch (err: unknown) {
        const e = err as { code?: string };
        if (e.code === "EEXIST") {
          throw new Error(`Target profile lock '${lockPath}' is already held by another process.`);
        }
        throw err;
      }

      return {
        async release(): Promise<void> {
          if (fd !== null) {
            try {
              fs.closeSync(fd);
            } catch {}
            try {
              fs.unlinkSync(lockPath);
            } catch {}
            fd = null;
          }
        },
      };
    },

    async launch(
      args: readonly string[],
      env: Record<string, string | undefined>,
      cwd: string,
      ompPath: string = defaultOmpBin,
    ): Promise<number> {
      const childEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(env)) {
        if (v === undefined) continue;
        const upper = k.toUpperCase();
        if (
          upper.startsWith("OMP_AUTH_BROKER_") ||
          upper === "OMP_PROFILE" ||
          upper === "PI_PROFILE" ||
          upper === "PI_CODING_AGENT_DIR" ||
          upper === "PI_CONFIG_FILES" ||
          upper === "PI_CONFIG_DIR"
        ) {
          continue;
        }
        childEnv[k] = v;
      }
      childEnv.OMP_PROFILE = "omp-portable";

      const fullArgs = [ompPath, "--profile", "omp-portable", ...args];
      const proc = Bun.spawn(fullArgs, {
        cwd,
        env: childEnv,
        stdio: ["inherit", "inherit", "inherit"],
      });

      return await proc.exited;
    },
  };
}
