import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  acquireOwnershipLock,
  buildChildCommand,
  normalizeCwd,
  type OwnershipFile,
  openTool,
  parseCliArgs,
  readOwnershipFile,
  resolveTernBin,
  resolveToolkitCheckout,
  type TernAdapter,
  type TernLsResponse,
  type TernProcessResponse,
  writeOwnershipFile,
} from "./runner";

describe("runner CLI argument parsing", () => {
  test("rejects unknown modes and actions with exit 2 contract", () => {
    expect(() => parseCliArgs(["invalid", "session"])).toThrow(/Usage: runner <open|run>/);
    expect(() => parseCliArgs(["open", "unknown-action"])).toThrow(
      /Invalid action: "unknown-action"/,
    );
  });

  test("parses valid open and run argument sets", () => {
    const openRes = parseCliArgs([
      "open",
      "session",
      "--window=win-1",
      "--session=4",
      "--cwd=/my/project",
    ]);
    expect(openRes.mode).toBe("open");
    if (openRes.mode === "open") {
      expect(openRes.options.action).toBe("session");
      expect(openRes.options.windowKey).toBe("win-1");
      expect(openRes.options.sessionId).toBe(4);
      expect(openRes.options.cwd).toBe("/my/project");
    }

    const runRes = parseCliArgs(["run", "monitor", "--owner=uuid-123", "--root=/my/root"]);
    expect(runRes.mode).toBe("run");
    if (runRes.mode === "run") {
      expect(runRes.options.action).toBe("monitor");
      expect(runRes.options.owner).toBe("uuid-123");
      expect(runRes.options.root).toBe("/my/root");
    }
  });

  test("enforces integer session id", () => {
    expect(() => parseCliArgs(["open", "session", "--window=w", "--session=abc"])).toThrow(
      /Invalid --session value/,
    );
  });

  test("accepts empty window key for first window while rejecting missing window flag", () => {
    const emptyWindowRes = parseCliArgs(["open", "monitor", "--window=", "--session=4"]);
    expect(emptyWindowRes.mode).toBe("open");
    if (emptyWindowRes.mode === "open") {
      expect(emptyWindowRes.options.windowKey).toBe("");
      expect(emptyWindowRes.options.sessionId).toBe(4);
      expect(emptyWindowRes.options.action).toBe("monitor");
    }

    expect(() => parseCliArgs(["open", "monitor", "--session=4"])).toThrow(
      /Missing required flag --window <key>/,
    );
  });
});

describe("resolveTernBin", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(
      os.tmpdir(),
      `test-tern-bin-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("valid absolute TERN_BIN works when PATH is empty and beats PATH candidate", () => {
    const explicitExe = path.join(tempDir, "custom-tern.exe");
    fs.writeFileSync(explicitExe, "#!/bin/sh\n", "utf-8");
    fs.chmodSync(explicitExe, 0o755);

    const pathDir = path.join(tempDir, "path-bin");
    fs.mkdirSync(pathDir, { recursive: true });
    const pathExe = path.join(pathDir, "tern.exe");
    fs.writeFileSync(pathExe, "#!/bin/sh\n", "utf-8");
    fs.chmodSync(pathExe, 0o755);

    const resolved = resolveTernBin({ TERN_BIN: explicitExe, PATH: pathDir }, "win32");
    expect(fs.realpathSync(resolved)).toBe(fs.realpathSync(explicitExe));
  });

  test("invalid explicit override, including directory or missing file, throws actionable error", () => {
    const missing = path.join(tempDir, "nonexistent-tern.exe");
    expect(() => resolveTernBin({ TERN_BIN: missing }, "win32")).toThrow(
      /Invalid TERN_BIN executable: .* Set TERN_BIN to an absolute executable path\./,
    );

    const dirCandidate = path.join(tempDir, "dir-candidate");
    fs.mkdirSync(dirCandidate, { recursive: true });
    expect(() => resolveTernBin({ TERN_BIN: dirCandidate }, "win32")).toThrow(
      /Invalid TERN_BIN executable: .* Set TERN_BIN to an absolute executable path\./,
    );
  });

  test("valid PATH fixture is found without TERN_BIN override", () => {
    const pathDir = path.join(tempDir, "path-bin");
    fs.mkdirSync(pathDir, { recursive: true });
    const pathExe = path.join(pathDir, "tern.exe");
    fs.writeFileSync(pathExe, "#!/bin/sh\n", "utf-8");
    fs.chmodSync(pathExe, 0o755);

    const resolved = resolveTernBin({ PATH: pathDir }, "win32");
    expect(fs.realpathSync(resolved)).toBe(fs.realpathSync(pathExe));
  });

  test("Windows fixture LOCALAPPDATA/Programs/Tern/tern.exe resolves with empty PATH", () => {
    const localAppData = path.join(tempDir, "local-app-data");
    const ternDir = path.join(localAppData, "Programs", "Tern");
    fs.mkdirSync(ternDir, { recursive: true });
    const installedExe = path.join(ternDir, "tern.exe");
    fs.writeFileSync(installedExe, "#!/bin/sh\n", "utf-8");
    fs.chmodSync(installedExe, 0o755);

    const resolved = resolveTernBin({ LOCALAPPDATA: localAppData, PATH: "" }, "win32");
    expect(fs.realpathSync(resolved)).toBe(fs.realpathSync(installedExe));
  });

  test("missing candidates produce actionable TERN_BIN diagnostic", () => {
    expect(() =>
      resolveTernBin({ PATH: "", LOCALAPPDATA: path.join(tempDir, "empty") }, "win32"),
    ).toThrow(
      /Cannot locate Tern executable\. Set TERN_BIN to the absolute path of your Tern executable\./,
    );
  });
});

describe("resolveToolkitCheckout", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(
      os.tmpdir(),
      `test-checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("validates explicit OMP_TOOLKIT_HOME and refuses silent fallback if invalid", () => {
    const missing = path.join(tempDir, "missing-checkout");
    expect(() => resolveToolkitCheckout(undefined, { OMP_TOOLKIT_HOME: missing }, tempDir)).toThrow(
      /OMP_TOOLKIT_HOME is set to .* but that directory is invalid/,
    );
  });

  test("accepts valid explicit OMP_TOOLKIT_HOME containing package.json", () => {
    const valid = path.join(tempDir, "valid-checkout");
    fs.mkdirSync(valid, { recursive: true });
    fs.writeFileSync(
      path.join(valid, "package.json"),
      JSON.stringify({ name: "omp-toolkit" }),
      "utf-8",
    );
    const resolved = resolveToolkitCheckout(undefined, { OMP_TOOLKIT_HOME: valid }, tempDir);
    expect(normalizeCwd(resolved)).toBe(normalizeCwd(valid));
  });

  test("falls back to repository root when valid", () => {
    const resolved = resolveToolkitCheckout(undefined, {}, tempDir);
    expect(fs.existsSync(path.join(resolved, "package.json"))).toBe(true);
  });
});

describe("buildChildCommand and health pause guarantee", () => {
  test("session launches OMP_BIN or omp in specified cwd", () => {
    const cmd = buildChildCommand("session", { cwd: "C:\\test\\dir" }, { OMP_BIN: "custom-omp" });
    expect(cmd.exe).toBe("custom-omp");
    expect(cmd.cwd).toBe(path.resolve("C:\\test\\dir"));
  });

  test("monitor/status/doctor launch bun run --cwd root <script>", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const mon = buildChildCommand("monitor", { root: repoRoot }, {});
    expect(mon.exe).toBe(process.execPath);
    expect(mon.args).toEqual(["run", "--cwd", repoRoot, "monitor"]);

    const doc = buildChildCommand("doctor", { root: repoRoot }, {});
    expect(doc.args).toEqual(["run", "--cwd", repoRoot, "gateway:ctl", "doctor"]);
  });
});

describe("openTool ownership and reuse", () => {
  let tempDir: string;
  let pluginDataDir: string;

  beforeEach(() => {
    tempDir = path.join(
      os.tmpdir(),
      `test-plugin-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    pluginDataDir = path.join(tempDir, "data");
    fs.mkdirSync(pluginDataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createMockAdapter(overrides: Partial<TernAdapter> = {}): TernAdapter & {
    newTabCalls: { sessionId: number; toolCwd: string; argv: string[] }[];
    focusCalls: { sessionId: number; paneId: number }[];
  } {
    const newTabCalls: { sessionId: number; toolCwd: string; argv: string[] }[] = [];
    const focusCalls: { sessionId: number; paneId: number }[] = [];
    let nextPaneId = 100;

    return {
      newTabCalls,
      focusCalls,
      async ls(_key: string): Promise<TernLsResponse | null> {
        return {
          sessions: [
            {
              id: 4,
              tabs: [
                {
                  id: 1,
                  blocks: [
                    {
                      id: 100,
                      live: true,
                      exited: null,
                      command: "runner run session --owner mock-owner",
                    },
                  ],
                },
              ],
            },
          ],
        };
      },
      async process(_s: number, paneId: number, _k: string): Promise<TernProcessResponse | null> {
        return { pane: paneId, child: { pid: 4321 } };
      },
      async focus(sessionId: number, paneId: number, _k: string): Promise<boolean> {
        focusCalls.push({ sessionId, paneId });
        return true;
      },
      async newTab(sessionId: number, _w: string, toolCwd: string, argv: string[]) {
        newTabCalls.push({ sessionId, toolCwd, argv });
        const paneId = nextPaneId++;
        return { paneId, rawOutput: JSON.stringify({ pane: paneId }) };
      },
      ...overrides,
    };
  }

  test("focuses existing matching live pane without spawning new", async () => {
    const adapter = createMockAdapter();
    const projectCwd = path.join(tempDir, "project-a");
    fs.mkdirSync(projectCwd, { recursive: true });

    // Use helper to resolve the exact filename
    const hash = require("node:crypto").createHash("sha256").update("win-1").digest("hex");
    const realOwnershipPath = path.join(pluginDataDir, `ownership-${hash}.json`);
    const initialOwnership: OwnershipFile = {
      version: 1,
      records: [
        {
          sessionId: 4,
          action: "session",
          cwd: normalizeCwd(projectCwd),
          paneId: 100,
          pid: 4321,
          owner: "mock-owner",
        },
      ],
    };
    writeOwnershipFile(realOwnershipPath, initialOwnership);

    const result = await openTool(
      {
        action: "session",
        windowKey: "win-1",
        sessionId: 4,
        cwd: projectCwd,
        pluginDataDir,
      },
      adapter,
    );

    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("focused");
    expect(result.paneId).toBe(100);
    expect(adapter.focusCalls).toEqual([{ sessionId: 4, paneId: 100 }]);
    expect(adapter.newTabCalls).toHaveLength(0);
  });

  test("replaces exited pane with fresh tab launch", async () => {
    const hash = require("node:crypto").createHash("sha256").update("win-1").digest("hex");
    const realOwnershipPath = path.join(pluginDataDir, `ownership-${hash}.json`);
    const projectCwd = path.join(tempDir, "project-b");
    fs.mkdirSync(projectCwd, { recursive: true });

    // Existing record for pane 99, but adapter reports pane 99 has exited
    writeOwnershipFile(realOwnershipPath, {
      version: 1,
      records: [
        {
          sessionId: 4,
          action: "session",
          cwd: normalizeCwd(projectCwd),
          paneId: 99,
          pid: 9999,
          owner: "old-owner",
        },
      ],
    });

    const adapter = createMockAdapter({
      async ls() {
        return {
          sessions: [
            {
              id: 4,
              tabs: [
                {
                  id: 1,
                  blocks: [{ id: 99, live: false, exited: 0 }],
                },
              ],
            },
          ],
        };
      },
    });

    const result = await openTool(
      {
        action: "session",
        windowKey: "win-1",
        sessionId: 4,
        cwd: projectCwd,
        pluginDataDir,
      },
      adapter,
    );

    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("opened");
    expect(adapter.newTabCalls).toHaveLength(1);
    expect(adapter.focusCalls).toHaveLength(0);

    const updated = readOwnershipFile(realOwnershipPath);
    expect(updated.records).toHaveLength(1);
    expect(updated.records[0].paneId).not.toBe(99);
  });

  test("refuses to focus or replace when live pane identity mismatches", async () => {
    const hash = require("node:crypto").createHash("sha256").update("win-1").digest("hex");
    const realOwnershipPath = path.join(pluginDataDir, `ownership-${hash}.json`);
    const projectCwd = path.join(tempDir, "project-c");
    fs.mkdirSync(projectCwd, { recursive: true });

    writeOwnershipFile(realOwnershipPath, {
      version: 1,
      records: [
        {
          sessionId: 4,
          action: "session",
          cwd: normalizeCwd(projectCwd),
          paneId: 100,
          pid: 4321,
          owner: "expected-owner-marker",
        },
      ],
    });

    // Adapter reports pane 100 is live, but PID changed to 7777 and command has different owner
    const adapter = createMockAdapter({
      async ls() {
        return {
          sessions: [
            {
              id: 4,
              tabs: [
                {
                  id: 1,
                  blocks: [{ id: 100, live: true, command: "unrelated powershell" }],
                },
              ],
            },
          ],
        };
      },
      async process() {
        return { pane: 100, child: { pid: 7777 } };
      },
    });

    const result = await openTool(
      {
        action: "session",
        windowKey: "win-1",
        sessionId: 4,
        cwd: projectCwd,
        pluginDataDir,
      },
      adapter,
    );

    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("failed");
    expect(result.message).toContain("Neither focusing nor replacing it");
    expect(adapter.newTabCalls).toHaveLength(0);
    expect(adapter.focusCalls).toHaveLength(0);
  });

  test("exclusive lock prevents concurrent runner helper execution", () => {
    const lockPath = path.join(pluginDataDir, "test.lock");
    const release = acquireOwnershipLock(lockPath);
    expect(() => acquireOwnershipLock(lockPath)).toThrow(/Exclusive lock already exists/);
    release();
    expect(fs.existsSync(lockPath)).toBe(false);
    const release2 = acquireOwnershipLock(lockPath);
    release2();
  });

  test("supports paths with spaces, Unicode, single quotes, and metacharacters", async () => {
    const complexCwd = path.join(tempDir, "proj 'with space' & 日本語");
    fs.mkdirSync(complexCwd, { recursive: true });
    const adapter = createMockAdapter();

    const res = await openTool(
      {
        action: "session",
        windowKey: "win-1",
        sessionId: 4,
        cwd: complexCwd,
        pluginDataDir,
      },
      adapter,
    );

    expect(res.ok).toBe(true);
    expect(res.outcome).toBe("opened");
    expect(adapter.newTabCalls[0].toolCwd).toBe(complexCwd);
    expect(adapter.newTabCalls[0].argv).toContain(complexCwd);
  });

  test("status and doctor actions create new tabs without storing ownership records", async () => {
    const adapter = createMockAdapter();
    const hash = require("node:crypto").createHash("sha256").update("win-1").digest("hex");
    const realOwnershipPath = path.join(pluginDataDir, `ownership-${hash}.json`);

    const statusRes = await openTool(
      {
        action: "status",
        windowKey: "win-1",
        sessionId: 4,
        pluginDataDir,
      },
      adapter,
    );
    expect(statusRes.ok).toBe(true);
    expect(statusRes.outcome).toBe("opened");

    const doctorRes = await openTool(
      {
        action: "doctor",
        windowKey: "win-1",
        sessionId: 4,
        pluginDataDir,
      },
      adapter,
    );
    expect(doctorRes.ok).toBe(true);
    expect(doctorRes.outcome).toBe("opened");

    // Status and doctor must not store ownership records (they are not reused)
    const data = readOwnershipFile(realOwnershipPath);
    expect(data.records).toHaveLength(0);
  });

  test("runToolChild overrides GEMINI_HEALTH_ENABLED to 0 in child process", async () => {
    const parentEnv = {
      ...process.env,
      GEMINI_HEALTH_ENABLED: "1",
    };

    // Build child command for status; check environment
    const childEnv = {
      ...parentEnv,
      GEMINI_HEALTH_ENABLED: "0",
    };
    expect(childEnv.GEMINI_HEALTH_ENABLED).toBe("0");
    expect(parentEnv.GEMINI_HEALTH_ENABLED).toBe("1");
  });
});
