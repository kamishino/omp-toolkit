import { type ChildProcess, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type RunnerAction = "session" | "monitor" | "status" | "doctor";

export interface OwnershipRecord {
  sessionId: number;
  action: "session" | "monitor";
  cwd: string;
  paneId: number;
  pid: number;
  owner: string;
}

export interface OwnershipFile {
  version: 1;
  records: OwnershipRecord[];
}

export interface OpenOptions {
  action: RunnerAction;
  windowKey: string;
  sessionId: number;
  cwd?: string;
  root?: string;
  pluginDataDir?: string;
}

export interface RunOptions {
  action: RunnerAction;
  owner: string;
  root?: string;
  cwd?: string;
}

export interface OpenResult {
  ok: boolean;
  outcome: "opened" | "focused" | "failed";
  message: string;
  paneId?: number;
}

export interface TernAdapter {
  ls(windowKey: string): Promise<TernLsResponse | null>;
  process(
    sessionId: number,
    paneId: number,
    windowKey: string,
  ): Promise<TernProcessResponse | null>;
  focus(sessionId: number, paneId: number, windowKey: string): Promise<boolean>;
  newTab(
    sessionId: number,
    windowKey: string,
    toolCwd: string,
    argv: string[],
  ): Promise<{ paneId?: number; rawOutput: string }>;
}

export interface TernBlockInfo {
  id: number;
  cwd?: string | null;
  program?: string | null;
  args?: string[] | null;
  command?: string | null;
  live?: boolean;
  exited?: number | null;
}

export interface TernTabInfo {
  id: number;
  blocks?: TernBlockInfo[];
}

export interface TernSessionInfo {
  id: number;
  name?: string;
  tabs?: TernTabInfo[];
}

export interface TernLsResponse {
  sessions?: TernSessionInfo[];
}

export interface TernProcessResponse {
  pane: number;
  child?: {
    pid?: number;
    name?: string;
    argv?: string[];
  } | null;
}

export function normalizeCwd(cwd: string, platform: NodeJS.Platform = process.platform): string {
  const resolved = path.resolve(cwd);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function resolveToolkitCheckout(
  explicitRoot?: string,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string {
  if (env.OMP_TOOLKIT_HOME && env.OMP_TOOLKIT_HOME.trim() !== "") {
    const candidate = path.resolve(env.OMP_TOOLKIT_HOME.trim());
    if (!fs.existsSync(candidate) || !fs.existsSync(path.join(candidate, "package.json"))) {
      throw new Error(
        `OMP_TOOLKIT_HOME is set to "${env.OMP_TOOLKIT_HOME}" but that directory is invalid or missing package.json.`,
      );
    }
    return candidate;
  }

  if (explicitRoot) {
    const candidate = path.resolve(explicitRoot);
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
  }

  const relativeRoot = path.resolve(__dirname, "../..");
  if (fs.existsSync(relativeRoot) && fs.existsSync(path.join(relativeRoot, "package.json"))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(relativeRoot, "package.json"), "utf-8"));
      if (pkg.name === "omp-toolkit") {
        return relativeRoot;
      }
    } catch {}
  }

  const installedRoot = path.join(home, ".omp", "omp-toolkit");
  if (fs.existsSync(installedRoot) && fs.existsSync(path.join(installedRoot, "package.json"))) {
    return installedRoot;
  }

  throw new Error(
    "Could not resolve OMP Toolkit root. Set OMP_TOOLKIT_HOME to your omp-toolkit checkout directory.",
  );
}

export function getOwnershipPaths(
  windowKey: string,
  pluginDataDir?: string,
): { ownershipPath: string; lockPath: string } {
  const dir =
    pluginDataDir ?? process.env.TERN_PLUGIN_DATA ?? path.join(os.tmpdir(), "tern-plugin-data");
  fs.mkdirSync(dir, { recursive: true });
  const hash = crypto.createHash("sha256").update(windowKey).digest("hex");
  return {
    ownershipPath: path.join(dir, `ownership-${hash}.json`),
    lockPath: path.join(dir, `ownership-${hash}.json.lock`),
  };
}

export function acquireOwnershipLock(lockPath: string): () => void {
  let fd: number;
  try {
    fd = fs.openSync(lockPath, "wx");
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "EEXIST") {
      throw new Error(
        `Exclusive lock already exists at "${lockPath}". If an earlier helper was interrupted, remove this lock only after confirming it is no longer running.`,
      );
    }
    throw err;
  }
  return () => {
    try {
      fs.closeSync(fd);
    } catch {}
    try {
      fs.unlinkSync(lockPath);
    } catch {}
  };
}

export function readOwnershipFile(ownershipPath: string): OwnershipFile {
  if (!fs.existsSync(ownershipPath)) {
    return { version: 1, records: [] };
  }
  try {
    const content = fs.readFileSync(ownershipPath, "utf-8");
    const parsed = JSON.parse(content);
    if (parsed && parsed.version === 1 && Array.isArray(parsed.records)) {
      return parsed as OwnershipFile;
    }
    throw new Error("Invalid ownership file format");
  } catch (err) {
    throw new Error(
      `Failed to read ownership file at "${ownershipPath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function writeOwnershipFile(ownershipPath: string, data: OwnershipFile): void {
  const tmpPath = `${ownershipPath}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmpPath, ownershipPath);
}

export function resolveTernBin(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const custom = env.TERN_BIN?.trim();
  if (custom) {
    if (!path.isAbsolute(custom) || !fs.existsSync(custom)) {
      throw new Error(
        `Invalid TERN_BIN executable: "${custom}". Set TERN_BIN to an absolute executable path.`,
      );
    }
    const stat = fs.statSync(custom);
    if (stat.isDirectory()) {
      throw new Error(
        `Invalid TERN_BIN executable: "${custom}". Set TERN_BIN to an absolute executable path.`,
      );
    }
    return fs.realpathSync(custom);
  }

  const lookupPath = env.PATH ?? env.Path ?? "";
  const found = Bun.which("tern", { PATH: lookupPath });
  if (found && fs.existsSync(found) && !fs.statSync(found).isDirectory()) {
    return fs.realpathSync(found);
  }

  if (platform === "win32" && env.LOCALAPPDATA) {
    const candidate = path.join(env.LOCALAPPDATA, "Programs", "Tern", "tern.exe");
    if (fs.existsSync(candidate) && !fs.statSync(candidate).isDirectory()) {
      return fs.realpathSync(candidate);
    }
  }

  throw new Error(
    "Cannot locate Tern executable. Set TERN_BIN to the absolute path of your Tern executable.",
  );
}

let cachedTernExe: string | null = null;

function getTernExecutable(): string {
  if (cachedTernExe) return cachedTernExe;
  const resolved = resolveTernBin();
  cachedTernExe = resolved;
  return resolved;
}

export const defaultTernAdapter: TernAdapter = {
  async ls(windowKey: string): Promise<TernLsResponse | null> {
    const exe = getTernExecutable();
    try {
      const proc = Bun.spawn([exe, "ls", "--json", "--window", windowKey], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const text = await new Response(proc.stdout).text();
      if ((await proc.exited) !== 0) return null;
      return JSON.parse(text) as TernLsResponse;
    } catch {
      return null;
    }
  },

  async process(
    sessionId: number,
    paneId: number,
    windowKey: string,
  ): Promise<TernProcessResponse | null> {
    const exe = getTernExecutable();
    try {
      const proc = Bun.spawn(
        [exe, "process", `${sessionId}/${paneId}`, "--json", "--window", windowKey],
        {
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const text = await new Response(proc.stdout).text();
      if ((await proc.exited) !== 0) return null;
      return JSON.parse(text) as TernProcessResponse;
    } catch {
      return null;
    }
  },

  async focus(sessionId: number, paneId: number, windowKey: string): Promise<boolean> {
    const exe = getTernExecutable();
    try {
      const proc = Bun.spawn([exe, "focus", `${sessionId}/${paneId}`, "--window", windowKey], {
        stdout: "ignore",
        stderr: "pipe",
      });
      return (await proc.exited) === 0;
    } catch {
      return false;
    }
  },

  async newTab(
    sessionId: number,
    windowKey: string,
    toolCwd: string,
    argv: string[],
  ): Promise<{ paneId?: number; rawOutput: string }> {
    const exe = getTernExecutable();
    const cmd = [
      exe,
      "new",
      "tab",
      String(sessionId),
      "--json",
      "--window",
      windowKey,
      "--cwd",
      toolCwd,
      "--keep-open",
      "--",
      ...argv,
    ];
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    if (code !== 0) {
      throw new Error(`tern new tab failed (code ${code}): ${(stderr || stdout).trim()}`);
    }
    let paneId: number | undefined;
    try {
      const parsed = JSON.parse(stdout);
      if (typeof parsed?.pane === "number") paneId = parsed.pane;
      else if (typeof parsed?.id === "number") paneId = parsed.id;
      else if (typeof parsed?.block === "number") paneId = parsed.block;
    } catch {}
    return { paneId, rawOutput: stdout };
  },
};

export async function openTool(
  options: OpenOptions,
  adapter: TernAdapter = defaultTernAdapter,
): Promise<OpenResult> {
  if (adapter === defaultTernAdapter) {
    getTernExecutable();
  }
  const { action, windowKey, sessionId } = options;
  let toolRoot: string | undefined;
  if (action !== "session") {
    toolRoot = resolveToolkitCheckout(options.root);
  }

  const canonicalTargetCwd = options.cwd ? normalizeCwd(options.cwd) : undefined;
  const canonicalRoot = toolRoot ? normalizeCwd(toolRoot) : undefined;

  const { ownershipPath, lockPath } = getOwnershipPaths(windowKey, options.pluginDataDir);
  const releaseLock = acquireOwnershipLock(lockPath);

  try {
    const ownership = readOwnershipFile(ownershipPath);

    if (action === "session" || action === "monitor") {
      const matchCwd = action === "session" ? canonicalTargetCwd : canonicalRoot;
      if (!matchCwd) {
        return {
          ok: false,
          outcome: "failed",
          message: `Cannot determine working directory for ${action}.`,
        };
      }
      const existingIdx = ownership.records.findIndex(
        (r) => r.sessionId === sessionId && r.action === action && r.cwd === matchCwd,
      );

      if (existingIdx !== -1) {
        const candidate = ownership.records[existingIdx];
        const lsData = await adapter.ls(windowKey);
        const session = lsData?.sessions?.find((s) => s.id === sessionId);
        let liveBlock: TernBlockInfo | undefined;
        for (const tab of session?.tabs ?? []) {
          for (const block of tab.blocks ?? []) {
            if (block.id === candidate.paneId) {
              liveBlock = block;
              break;
            }
          }
          if (liveBlock) break;
        }

        const isExited = !liveBlock || liveBlock.live === false || liveBlock.exited != null;

        if (isExited || !liveBlock) {
          ownership.records.splice(existingIdx, 1);
          writeOwnershipFile(ownershipPath, ownership);
        } else {
          const procData = await adapter.process(sessionId, candidate.paneId, windowKey);
          const pidMatches = procData?.child?.pid === candidate.pid;
          const cmdText = liveBlock.command ?? "";
          const argsList = Array.isArray(liveBlock.args) ? liveBlock.args : [];
          const markerFound =
            cmdText.includes(candidate.owner) || argsList.includes(candidate.owner);

          if (pidMatches || markerFound) {
            const focused = await adapter.focus(sessionId, candidate.paneId, windowKey);
            if (focused) {
              return {
                ok: true,
                outcome: "focused",
                paneId: candidate.paneId,
                message: `Focused existing ${action} pane #${candidate.paneId}.`,
              };
            }
          }

          return {
            ok: false,
            outcome: "failed",
            paneId: candidate.paneId,
            message: `A live pane #${candidate.paneId} exists for ${action}, but its identity or process does not match the ownership record. Neither focusing nor replacing it.`,
          };
        }
      }
    }

    const ownerUuid = crypto.randomUUID();
    const bunExe = process.execPath;
    const runnerScriptPath = path.resolve(__dirname, "runner.ts");
    const launchArgv: string[] = [bunExe, runnerScriptPath, "run", action, "--owner", ownerUuid];
    if (toolRoot) launchArgv.push("--root", toolRoot);
    if (options.cwd) launchArgv.push("--cwd", options.cwd);

    const toolCwd =
      action === "session" ? (options.cwd ?? process.cwd()) : (toolRoot ?? process.cwd());
    const { paneId: initialPaneId } = await adapter.newTab(
      sessionId,
      windowKey,
      toolCwd,
      launchArgv,
    );

    let finalPaneId = initialPaneId;
    let finalPid = 0;

    const lsData = await adapter.ls(windowKey);
    const session = lsData?.sessions?.find((s) => s.id === sessionId);
    for (const tab of session?.tabs ?? []) {
      for (const block of tab.blocks ?? []) {
        const matchesOwner =
          Boolean(block.command?.includes(ownerUuid)) ||
          (Array.isArray(block.args) && block.args.includes(ownerUuid));
        if (matchesOwner || block.id === initialPaneId) {
          finalPaneId = block.id;
          break;
        }
      }
      if (finalPaneId) break;
    }

    if (finalPaneId) {
      const procInfo = await adapter.process(sessionId, finalPaneId, windowKey);
      if (procInfo?.child?.pid) finalPid = procInfo.child.pid;
    }

    if (!finalPaneId) {
      return {
        ok: false,
        outcome: "failed",
        message: `Tab was created for ${action}, but Tern did not return a verifiable pane ID.`,
      };
    }

    if (action === "session" || action === "monitor") {
      const matchCwd = action === "session" ? canonicalTargetCwd : canonicalRoot;
      if (matchCwd) {
        ownership.records.push({
          sessionId,
          action,
          cwd: matchCwd,
          paneId: finalPaneId,
          pid: finalPid,
          owner: ownerUuid,
        });

        try {
          writeOwnershipFile(ownershipPath, ownership);
        } catch (err) {
          return {
            ok: false,
            outcome: "opened",
            paneId: finalPaneId,
            message: `Opened ${action} tab in pane #${finalPaneId}, but failed to persist ownership record: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }
    }

    return {
      ok: true,
      outcome: "opened",
      paneId: finalPaneId,
      message: `Opened new ${action} tab in pane #${finalPaneId}.`,
    };
  } finally {
    releaseLock();
  }
}

export function resolveOmpBin(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const custom = env.OMP_BIN?.trim();
  if (custom) return custom;
  if (platform === "win32") {
    const paths = (env.PATH ?? "").split(path.delimiter);
    for (const p of paths) {
      for (const ext of [".exe", ".cmd", ".bat", ""]) {
        const full = path.join(p, `omp${ext}`);
        if (fs.existsSync(full)) return full;
      }
    }
    return "omp.exe";
  }
  return "omp";
}

export function buildChildCommand(
  action: RunnerAction,
  options: { root?: string; cwd?: string },
  env: NodeJS.ProcessEnv = process.env,
): { exe: string; args: string[]; cwd: string } {
  const root = options.root ? path.resolve(options.root) : resolveToolkitCheckout(undefined, env);
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();

  switch (action) {
    case "session": {
      const ompBin = resolveOmpBin(env);
      return { exe: ompBin, args: [], cwd };
    }
    case "monitor": {
      return { exe: process.execPath, args: ["run", "--cwd", root, "monitor"], cwd: root };
    }
    case "status": {
      return {
        exe: process.execPath,
        args: ["run", "--cwd", root, "gateway:ctl", "status"],
        cwd: root,
      };
    }
    case "doctor": {
      return {
        exe: process.execPath,
        args: ["run", "--cwd", root, "gateway:ctl", "doctor"],
        cwd: root,
      };
    }
  }
}

export async function runToolChild(
  options: RunOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    GEMINI_HEALTH_ENABLED: "0",
  };

  const { exe, args, cwd } = buildChildCommand(options.action, options, env);

  const { promise, resolve, reject } = Promise.withResolvers<number>();
  let child: ChildProcess;
  try {
    child = spawn(exe, args, {
      cwd,
      env: childEnv,
      stdio: "inherit",
      shell: false,
    });
  } catch (err) {
    reject(err);
    return promise;
  }

  const onSigint = () => child.kill("SIGINT");
  const onSigterm = () => child.kill("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  child.on("error", (err) => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    reject(err);
  });

  child.on("close", (code) => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    resolve(code ?? 1);
  });

  return promise;
}

export type ParsedCli =
  | { mode: "open"; options: OpenOptions }
  | { mode: "run"; options: RunOptions };

export function parseCliArgs(argv: string[]): ParsedCli {
  const mode = argv[0];
  if (mode !== "open" && mode !== "run") {
    throw new Error(`Usage: runner <open|run> [options] (got "${mode}")`);
  }

  const action = argv[1] as RunnerAction;
  const validActions: RunnerAction[] = ["session", "monitor", "status", "doctor"];
  if (!validActions.includes(action)) {
    throw new Error(`Invalid action: "${action}". Allowed: ${validActions.join(", ")}`);
  }

  const flags = argv.slice(2);
  const getFlag = (name: string): string | undefined => {
    for (let i = 0; i < flags.length; i++) {
      if (flags[i] === `--${name}`) return flags[i + 1];
      if (flags[i]?.startsWith(`--${name}=`)) return flags[i].slice(name.length + 3);
    }
    return undefined;
  };

  if (mode === "open") {
    const windowKey = getFlag("window");
    const sessionRaw = getFlag("session");
    if (windowKey === undefined) throw new Error("Missing required flag --window <key>");
    if (!sessionRaw) throw new Error("Missing required flag --session <id>");
    const sessionId = Number(sessionRaw);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      throw new Error(`Invalid --session value "${sessionRaw}"`);
    }
    const cwd = getFlag("cwd");
    const root = getFlag("root");
    return { mode: "open", options: { action, windowKey, sessionId, cwd, root } };
  } else {
    const owner = getFlag("owner");
    if (!owner) throw new Error("Missing required flag --owner <uuid>");
    const root = getFlag("root");
    const cwd = getFlag("cwd");
    return { mode: "run", options: { action, owner, root, cwd } };
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  let parsed: ParsedCli;
  try {
    parsed = parseCliArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  if (parsed.mode === "open") {
    const result = await openTool(parsed.options);
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  } else {
    try {
      const exitCode = await runToolChild(parsed.options);
      process.exit(exitCode);
    } catch (err) {
      console.error(`Tool launch error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
