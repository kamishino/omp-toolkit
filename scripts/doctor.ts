import { Database } from "bun:sqlite";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  resolveAgentDir,
  resolveHistoryDbPath,
  resolveLockPath,
  resolveMachinePath,
} from "../packages/core/src/environment";
import { resolveOrcaBin } from "./monitor/orca-monitor";

export interface DoctorDependencies {
  execFileFn?: (
    file: string,
    args: string[],
    options: { timeout?: number; windowsHide?: boolean },
  ) => Promise<{ stdout: string | Buffer; stderr?: string | Buffer }>;
  agentDir?: string;
  now?: () => number;
  ompBin?: string;
  isPidAlive?: (pid: number) => boolean;
}

export interface DoctorResult {
  lines: string[];
  exitCode: 0 | 1;
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function execFilePromise(
  file: string,
  args: string[],
  options: { timeout?: number; windowsHide?: boolean } = {},
): Promise<{ stdout: string | Buffer; stderr?: string | Buffer }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

export async function runDoctor(deps: DoctorDependencies = {}): Promise<DoctorResult> {
  const lines: string[] = [];
  let allPass = true;

  const agentDir = deps.agentDir ?? resolveAgentDir();
  const exec = deps.execFileFn ?? execFilePromise;
  const now = deps.now ?? (() => Date.now());
  const ompBin = deps.ompBin ?? process.env.OMP_BIN ?? "omp";
  const isPidAlive = deps.isPidAlive ?? defaultIsPidAlive;

  function pass(name: string): void {
    lines.push(`PASS ${name}`);
  }

  function fail(name: string, reason: string): void {
    allPass = false;
    lines.push(`FAIL ${name}: ${reason}`);
  }

  // 1. check OMP version via omp --version
  try {
    const res = await exec(ompBin, ["--version"], {
      timeout: 10_000,
      windowsHide: true,
    });
    const version = String(res.stdout).trim();
    if (version.length > 0) {
      pass(`omp-version (${version})`);
    } else {
      fail("omp-version", "empty output");
    }
  } catch (error) {
    fail(
      "omp-version",
      `failed to execute "${ompBin} --version": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // 2. check installed extension/script files exist
  const extFile = path.join(agentDir, "extensions", "gemini-health.js");
  const scriptFile = path.join(agentDir, "scripts", "omp-provider-usage.js");
  if (fs.existsSync(extFile) && fs.existsSync(scriptFile)) {
    pass("installed-files");
  } else {
    const missing: string[] = [];
    if (!fs.existsSync(extFile)) missing.push(extFile);
    if (!fs.existsSync(scriptFile)) missing.push(scriptFile);
    fail("installed-files", `missing ${missing.join(", ")}`);
  }

  // 3. check history DB opens and schema version is current
  const dbPath = deps.agentDir
    ? path.join(deps.agentDir, "omp-toolkit-history.db")
    : resolveHistoryDbPath();
  if (!fs.existsSync(dbPath)) {
    fail("history-db", `history DB missing at ${dbPath}`);
  } else {
    try {
      const db = new Database(dbPath, { readonly: true });
      try {
        const row = db.query("SELECT value FROM meta WHERE key = 'schema_version'").get() as {
          value?: string;
        } | null;
        if (row && row.value === "1") {
          pass("history-db (schema v1)");
        } else {
          fail("history-db", `unexpected schema version: ${row?.value ?? "none"}`);
        }
      } finally {
        db.close();
      }
    } catch (error) {
      fail(
        "history-db",
        `failed to open history DB: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // 4. check machine id file exists and is valid
  const machineFile = deps.agentDir
    ? path.join(deps.agentDir, "omp-toolkit-machine.json")
    : resolveMachinePath();
  if (!fs.existsSync(machineFile)) {
    fail("machine-id", `machine identity missing at ${machineFile}`);
  } else {
    try {
      const parsed = JSON.parse(fs.readFileSync(machineFile, "utf8")) as {
        id?: unknown;
        hostname?: unknown;
        createdAt?: unknown;
      };
      if (
        typeof parsed?.id === "string" &&
        parsed.id.length > 0 &&
        typeof parsed?.hostname === "string" &&
        parsed.hostname.length > 0 &&
        typeof parsed?.createdAt === "number" &&
        Number.isFinite(parsed.createdAt)
      ) {
        pass(`machine-id (${parsed.id.slice(0, 8)}...)`);
      } else {
        fail("machine-id", "invalid machine identity schema");
      }
    } catch {
      fail("machine-id", "corrupt machine identity JSON");
    }
  }

  // 5. check lock file is either absent or stale/alive
  const lockFile = deps.agentDir ? path.join(deps.agentDir, "omp-toolkit.lock") : resolveLockPath();
  if (!fs.existsSync(lockFile)) {
    pass("lock-file (absent)");
  } else {
    try {
      const content = fs.readFileSync(lockFile, "utf8");
      const parsed = JSON.parse(content) as {
        token?: unknown;
        pid?: unknown;
        acquiredAt?: unknown;
      };
      if (
        typeof parsed?.token === "string" &&
        typeof parsed?.pid === "number" &&
        typeof parsed?.acquiredAt === "number"
      ) {
        const age = now() - parsed.acquiredAt;
        if (age > 30_000) {
          pass(`lock-file (stale, age ${Math.round(age / 1000)}s)`);
        } else if (isPidAlive(parsed.pid)) {
          pass(`lock-file (active, pid ${parsed.pid})`);
        } else {
          fail("lock-file", `orphaned lock for dead pid ${parsed.pid}`);
        }
      } else {
        fail("lock-file", "corrupt lock file structure");
      }
    } catch {
      fail("lock-file", "unparseable lock file");
    }
  }

  // 6. check Orca floating selector with orca terminal list --worktree id:global-floating-terminal --json
  try {
    const orcaBin = resolveOrcaBin();
    const res = await exec(
      orcaBin,
      ["terminal", "list", "--worktree", "id:global-floating-terminal", "--json"],
      { timeout: 10_000, windowsHide: true },
    );
    const parsed = JSON.parse(String(res.stdout)) as
      | { ok?: boolean; result?: { terminals?: unknown[] } }
      | unknown[];
    const isArray = Array.isArray(parsed);
    const isEnvelope =
      typeof parsed === "object" && parsed !== null && "ok" in parsed && parsed.ok === true;
    if (isArray || isEnvelope) {
      pass("orca-terminal");
    } else {
      fail("orca-terminal", "orca terminal list did not return valid JSON response");
    }
  } catch (error) {
    fail(
      "orca-terminal",
      `failed to query Orca terminal selector: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return {
    lines,
    exitCode: allPass ? 0 : 1,
  };
}

if (import.meta.main) {
  const result = await runDoctor();
  for (const line of result.lines) {
    console.log(line);
  }
  process.exit(result.exitCode);
}
