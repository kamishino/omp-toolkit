import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import { parseMonitorCliConfig } from "./config";
import { InteractiveMonitor } from "./interactive-monitor";

describe("InteractiveMonitor", () => {
  test("handles view toggle and exit keystrokes", () => {
    const mockStdout = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }) as unknown as NodeJS.WriteStream;

    const config = parseMonitorCliConfig([], {});
    const monitor = new InteractiveMonitor({
      config,
      stdout: mockStdout,
      fetchReports: async () => [],
      readSnapshot: () => null,
      writeHeartbeat: () => {},
    });

    expect(monitor.getActiveView()).toBe("usage");
    expect(monitor.handleKey("s")).toBe("handled");
    expect(monitor.getActiveView()).toBe("schedule");
    expect(monitor.handleKey("\t")).toBe("handled");
    expect(monitor.getActiveView()).toBe("usage");

    expect(monitor.handleKey("q")).toBe("exit");
    expect(monitor.handleKey("\u0003")).toBe("exit");
  });

  test("refresh updates reports, heartbeat, and snapshot", async () => {
    let reportsFetched = false;
    let heartbeatWritten = false;
    let snapshotRead = false;

    const config = parseMonitorCliConfig(["--health"], {});
    const monitor = new InteractiveMonitor({
      config,
      fetchReports: async () => {
        reportsFetched = true;
        return [];
      },
      readSnapshot: () => {
        snapshotRead = true;
        return null;
      },
      writeHeartbeat: () => {
        heartbeatWritten = true;
      },
    });

    await monitor.refresh();
    expect(reportsFetched).toBe(true);
    expect(heartbeatWritten).toBe(true);
    expect(snapshotRead).toBe(true);
  });
});
