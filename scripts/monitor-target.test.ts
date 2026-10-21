import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { monitorCommandArgs, parseMonitorArgs, resolveMonitorScript } from "./monitor-target";

describe("monitor launcher options", () => {
  test("defaults to a 300 s health-enabled alternate-screen watch", () => {
    expect(parseMonitorArgs([])).toEqual({
      interval: 300,
      health: true,
      altScreen: true,
      unknown: [],
    });
  });

  test("parses interval, health, and alt-screen flags", () => {
    expect(parseMonitorArgs(["--interval=600", "--no-health", "--no-alt-screen"])).toEqual({
      interval: 600,
      health: false,
      altScreen: false,
      unknown: [],
    });
  });

  test("clamps invalid intervals", () => {
    expect(parseMonitorArgs(["--interval=abc"]).interval).toBe(300);
    expect(parseMonitorArgs(["--interval=5"]).interval).toBe(10);
  });

  test("reports unknown flags", () => {
    expect(parseMonitorArgs(["--restart", "--bogus"]).unknown).toEqual(["--restart", "--bogus"]);
  });

  test("builds the CLI argv", () => {
    expect(
      monitorCommandArgs("/tmp/monitor.js", {
        interval: 300,
        health: true,
        altScreen: true,
        unknown: [],
      }),
    ).toEqual(["/tmp/monitor.js", "--watch", "--interval=300", "--health"]);
    expect(
      monitorCommandArgs("/tmp/monitor.js", {
        interval: 10,
        health: false,
        altScreen: false,
        unknown: [],
      }),
    ).toEqual(["/tmp/monitor.js", "--watch", "--interval=10", "--no-alt-screen"]);
  });
});

describe("monitor script resolution", () => {
  test("prefers installed, then dist, then source", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "omp-monitor-"));
    const agentDir = path.join(temp, "agent");
    const root = path.join(temp, "repo");
    const installed = path.join(agentDir, "scripts", "omp-provider-usage.js");
    const dist = path.join(root, "apps", "provider-usage", "dist", "index.js");
    const source = path.join(root, "apps", "provider-usage", "src", "index.ts");
    try {
      expect(resolveMonitorScript(agentDir, root)).toBe(installed);
      fs.mkdirSync(path.dirname(dist), { recursive: true });
      fs.writeFileSync(dist, "");
      expect(resolveMonitorScript(agentDir, root)).toBe(dist);
      fs.mkdirSync(path.dirname(source), { recursive: true });
      fs.writeFileSync(source, "");
      expect(resolveMonitorScript(agentDir, root)).toBe(dist);
      fs.rmSync(dist);
      expect(resolveMonitorScript(agentDir, root)).toBe(source);
      fs.mkdirSync(path.dirname(installed), { recursive: true });
      fs.writeFileSync(installed, "");
      expect(resolveMonitorScript(agentDir, root)).toBe(installed);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
});
