import { describe, expect, test } from "bun:test";
import type { HealthSnapshot, UsageReport } from "@omp-toolkit/core";
import { parseMonitorCliConfig } from "./config";
import { MonitorRunner } from "./monitor-runner";

describe("MonitorRunner deep execution coordinator", () => {
  const dummyReports: UsageReport[] = [
    {
      provider: "google-antigravity",
      metadata: { email: "user@example.com" },
      limits: [{ id: "l1", label: "Gemini", amount: { usedFraction: 0.1 } }],
    },
  ];

  const dummySnapshot: HealthSnapshot = {
    checkedAt: 1_700_000_000_000,
    results: [{ email: "user@example.com", status: "ok", ms: 40 }],
  };

  test("executeCycle generates valid JSON payload when json is true", async () => {
    let heartbeatCalled = false;
    const runner = new MonitorRunner({
      fetchReports: async () => dummyReports,
      readSnapshotFn: () => dummySnapshot,
      writeHeartbeatFn: () => {
        heartbeatCalled = true;
      },
    });

    const config = parseMonitorCliConfig(["--json"], {});
    const { output } = await runner.executeCycle(config);
    expect(heartbeatCalled).toBe(true);

    const parsed = JSON.parse(output);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.dashboard.providers[0].name).toBe("GOOGLE ANTIGRAVITY");
  });

  test("executeCycle generates ANSI text frame when json is false", async () => {
    const runner = new MonitorRunner({
      fetchReports: async () => dummyReports,
      readSnapshotFn: () => dummySnapshot,
    });

    const config = parseMonitorCliConfig([], {});
    const { output } = await runner.executeCycle(config);
    expect(output).toContain("GOOGLE ANTIGRAVITY");
    expect(output).toContain("user");
  });

  test("run executes schedule view cleanly when schedule is true", async () => {
    let capturedOutput = "";
    const runner = new MonitorRunner({
      outputFn: (text) => {
        capturedOutput = text;
      },
    });

    const config = parseMonitorCliConfig(["--schedule"], {});
    await runner.run(config);
    expect(capturedOutput.length).toBeGreaterThan(0);
    expect(capturedOutput.toLowerCase()).toContain("deepseek");
  });

  test("run executes one-shot batch without starting loop when watch is false", async () => {
    const outputs: string[] = [];
    const runner = new MonitorRunner({
      fetchReports: async () => dummyReports,
      readSnapshotFn: () => dummySnapshot,
      outputFn: (text) => {
        outputs.push(text);
      },
      isTTY: false,
    });

    const config = parseMonitorCliConfig([], {});
    await runner.run(config);
    expect(outputs.length).toBe(1);
    expect(outputs[0]).toContain("GOOGLE ANTIGRAVITY");
  });
});
