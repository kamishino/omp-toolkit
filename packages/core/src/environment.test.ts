import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  resolveAgentDir,
  resolveHealthScriptCandidates,
  resolveHeartbeatPath,
  resolveHistoryDbPath,
  resolveInstalledScript,
  resolveMonitorScriptCandidates,
  resolveSnapshotPath,
  resolveStatePath,
  resolveStreakPath,
} from "./environment";

describe("AgentEnvironment path resolver", () => {
  const fakeHome = path.join("fake", "home");

  test("resolveAgentDir defaults to .omp/agent under home", () => {
    const dir = resolveAgentDir({}, fakeHome);
    expect(dir).toBe(path.join(fakeHome, ".omp", "agent"));
  });

  test("resolveAgentDir respects PI_CODING_AGENT_DIR override", () => {
    const custom = path.join("custom", "agent");
    const dir = resolveAgentDir({ PI_CODING_AGENT_DIR: custom }, fakeHome);
    expect(dir).toBe(custom);
  });

  test("resolves state, snapshot, and streak paths under agent directory", () => {
    const dir = path.join(fakeHome, ".omp", "agent");
    expect(resolveSnapshotPath({}, fakeHome)).toBe(path.join(dir, "gemini-health-latest.json"));
    expect(resolveStatePath({}, fakeHome)).toBe(path.join(dir, "gemini-health-state.json"));
    expect(resolveStreakPath({}, fakeHome)).toBe(path.join(dir, "gemini-health-streaks.json"));
  });

  test("resolveHeartbeatPath resolves monitor json under agent directory", () => {
    const dir = path.join(fakeHome, ".omp", "agent");
    expect(resolveHeartbeatPath({}, fakeHome)).toBe(path.join(dir, "omp-toolkit-monitor.json"));
  });

  test("resolveHistoryDbPath defaults to db under agentDir or respects env override", () => {
    const defaultDb = resolveHistoryDbPath({}, fakeHome);
    expect(defaultDb).toBe(path.join(fakeHome, ".omp", "agent", "omp-toolkit-history.db"));

    const customDb = path.join("var", "log", "history.db");
    const overridden = resolveHistoryDbPath({ OMP_TOOLKIT_HISTORY_DB: customDb }, fakeHome);
    expect(overridden).toBe(customDb);
  });

  test("resolveInstalledScript resolves scripts under agentDir/scripts", () => {
    const script = resolveInstalledScript("test-tool.js", {}, fakeHome);
    expect(script).toBe(path.join(fakeHome, ".omp", "agent", "scripts", "test-tool.js"));
  });

  test("resolveMonitorScriptCandidates returns expected ordered search array", () => {
    const checkout = path.join("my", "checkout");
    const candidates = resolveMonitorScriptCandidates(checkout, {}, fakeHome);
    expect(candidates.length).toBe(3);
    expect(candidates[0]).toContain("omp-provider-usage.js");
    expect(candidates[1]).toContain(
      path.join(checkout, "apps", "provider-usage", "dist", "index.js"),
    );
    expect(candidates[2]).toContain(
      path.join(checkout, "apps", "provider-usage", "src", "index.ts"),
    );
  });

  test("resolveHealthScriptCandidates returns expected ordered search array", () => {
    const checkout = path.join("my", "checkout");
    const candidates = resolveHealthScriptCandidates(checkout, {}, fakeHome);
    expect(candidates.length).toBe(3);
    expect(candidates[0]).toContain(
      path.join(checkout, "apps", "omp-extension", "dist", "index.js"),
    );
    expect(candidates[1]).toContain(
      path.join(fakeHome, ".omp", "agent", "extensions", "gemini-health.js"),
    );
    expect(candidates[2]).toContain(
      path.join(checkout, "apps", "omp-extension", "src", "index.ts"),
    );
  });
});
