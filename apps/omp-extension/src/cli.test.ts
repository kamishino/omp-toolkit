import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GEMINI_HEALTH_PAUSED_MESSAGE } from "@omp-toolkit/core";

const entry = path.join(import.meta.dir, "index.ts");
const seededFiles: Record<string, string> = {
  "gemini-health-latest.json": '{"schemaVersion":2,"results":[]}\n',
  "gemini-health-state.json": '{"schemaVersion":2,"excluded":[],"pending":[]}\n',
  "gemini-health-auto-restore.json": '{"enabled":[]}\n',
  "gemini-warmup-state.json": '{"lastWarmupAt":{}}\n',
};

interface AgentDir {
  dir: string;
  restore: () => void;
}

function createAgentDir(): AgentDir {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-cli-pause-"));
  for (const [name, content] of Object.entries(seededFiles)) {
    fs.writeFileSync(path.join(dir, name), content, "utf8");
  }
  return {
    dir,
    restore: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function snapshotDir(dir: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const name of fs.readdirSync(dir).sort()) {
    snapshot[name] = fs.readFileSync(path.join(dir, name), "utf8");
  }
  return snapshot;
}

function runCli(
  args: string[],
  dir: string,
  extraEnv: Record<string, string> = {},
): { exitCode: number | null; stdout: string; stderr: string } {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  delete env.GEMINI_HEALTH_ENABLED;
  env.PI_CODING_AGENT_DIR = dir;
  env.OMP_BIN = path.join(dir, "must-not-run-omp");
  Object.assign(env, extraEnv);

  const result = Bun.spawnSync([process.execPath, entry, ...args], {
    env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10_000,
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

describe("runExtensionCli while Gemini health is paused", () => {
  let agentDir: AgentDir | null = null;

  afterEach(() => {
    agentDir?.restore();
    agentDir = null;
  });

  const pausedInvocations = [
    ["--json"],
    ["--watch", "--json"],
    ["--warmup", "--all", "--json"],
    ["--check", "--account=alpha@example.com", "--json"],
  ];

  for (const enabledValue of [undefined, "0"]) {
    for (const args of pausedInvocations) {
      const label = args.join(" ");
      const envLabel = enabledValue === undefined ? "unset" : `"${enabledValue}"`;
      test(`${label} exits 2 with the paused envelope when GEMINI_HEALTH_ENABLED is ${envLabel}`, () => {
        agentDir = createAgentDir();
        const before = snapshotDir(agentDir.dir);

        const { exitCode, stdout, stderr } = runCli(args, agentDir.dir);

        expect(exitCode).toBe(2);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout.trim())).toEqual({
          paused: true,
          message: GEMINI_HEALTH_PAUSED_MESSAGE,
        });
        expect(snapshotDir(agentDir.dir)).toEqual(before);
      });
    }
  }

  test("text mode prints only the pause explanation", () => {
    agentDir = createAgentDir();
    const before = snapshotDir(agentDir.dir);

    const { exitCode, stdout, stderr } = runCli(["--warmup", "--all"], agentDir.dir);

    expect(exitCode).toBe(2);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe(GEMINI_HEALTH_PAUSED_MESSAGE);
    expect(snapshotDir(agentDir.dir)).toEqual(before);
  });

  test("argument validation still fails before the pause refusal", () => {
    agentDir = createAgentDir();

    const { exitCode, stdout, stderr } = runCli(["--warmup"], agentDir.dir);

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("error: --warmup requires either --account=<email> or --all");
  });
});
