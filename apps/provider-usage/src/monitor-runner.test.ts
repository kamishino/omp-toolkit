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
    schemaVersion: 2,
    probeModel: "gemini-3.8-flash-high",
    sweepStartedAt: null,
    checkedAt: 1_700_000_000_000,
    results: [
      {
        provider: "google-antigravity",
        email: "user@example.com",
        project: "p1",
        model: "gemini-3.8-flash-high",
        status: "ok",
        ms: 40,
        startedAt: 1_700_000_000_000 - 40,
        checkedAt: 1_700_000_000_000,
        failureKind: null,
        confirmed: false,
      },
    ],
    streaks: {},
  };

  test("executeCycle generates valid JSON payload when json is true", async () => {
    let heartbeatCalled = false;
    const runner = new MonitorRunner({
      fetchReports: async () => dummyReports,
      readSnapshotFn: () => dummySnapshot,
      recordPacingFn: () => ({}),
      writeHeartbeatFn: () => {
        heartbeatCalled = true;
      },
    });

    const config = parseMonitorCliConfig(["--json"], {});
    const { output } = await runner.executeCycle(config);
    expect(heartbeatCalled).toBe(true);

    const parsed = JSON.parse(output);
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.dashboard.providers[0].name).toBe("GOOGLE ANTIGRAVITY");
  });

  test("executeCycle generates ANSI text frame when json is false", async () => {
    const runner = new MonitorRunner({
      fetchReports: async () => dummyReports,
      readSnapshotFn: () => dummySnapshot,
      recordPacingFn: () => ({}),
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
      recordPacingFn: () => ({}),
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

  test("executeCycle includes pacing in JSON payload for muse-code and invokes recordPacingFn", async () => {
    const now = Date.now();
    const resetsAt = now + 400_000_000;
    const museReports: UsageReport[] = [
      {
        provider: "muse-code",
        metadata: { email: "muse@example.com" },
        limits: [
          { label: "Weekly", window: { label: "Weekly", resetsAt }, amount: { usedFraction: 0.3 } },
        ],
      },
    ];

    let recordPacingCalled = false;
    const runner = new MonitorRunner({
      fetchReports: async () => museReports,
      readSnapshotFn: () => null,
      recordPacingFn: () => {
        recordPacingCalled = true;
        return {};
      },
    });

    const config = parseMonitorCliConfig(["--json"], {});
    const { output } = await runner.executeCycle(config);
    expect(recordPacingCalled).toBe(true);

    const parsed = JSON.parse(output);
    const weekly = parsed.dashboard.providers[0].rows[0].limits[0];
    expect(weekly.pacing).toBeDefined();
    expect(weekly.pacing.todayCeilingFraction).toBeCloseTo(3 / 7, 4);
    expect(weekly.pacing.headroomFraction).toBeCloseTo(3 / 7 - 0.3, 4);
  });
});
