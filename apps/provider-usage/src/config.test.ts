import { describe, expect, test } from "bun:test";
import {
  buildCliArgs,
  DEFAULT_MONITOR_INTERVAL,
  parseMonitorCliConfig,
  parseThreshold,
} from "./config";

describe("parseMonitorCliConfig", () => {
  test("returns default configuration with no arguments", () => {
    const config = parseMonitorCliConfig([], {});
    expect(config.schedule).toBe(false);
    expect(config.json).toBe(false);
    expect(config.watch).toBe(false);
    expect(config.interval).toBe(DEFAULT_MONITOR_INTERVAL);
    expect(config.altScreen).toBe(true);
    expect(config.unknown).toEqual([]);
    expect(config.balanceAlert.cny).toBe(10);
    expect(config.balanceAlert.usd).toBe(10);
  });

  test("parses and clamps interval argument", () => {
    expect(parseMonitorCliConfig(["--interval=5"], {}).interval).toBe(10);
    expect(parseMonitorCliConfig(["--interval=45"], {}).interval).toBe(45);
    expect(parseMonitorCliConfig(["--interval=notanumber"], {}).interval).toBe(
      DEFAULT_MONITOR_INTERVAL,
    );
  });

  test("handles boolean flags and unknown arguments", () => {
    const config = parseMonitorCliConfig(
      ["--json", "--watch", "--no-alt-screen", "--custom-arg"],
      {},
    );
    expect(config.json).toBe(true);
    expect(config.watch).toBe(true);
    expect(config.altScreen).toBe(false);
    expect(config.unknown).toEqual(["--custom-arg"]);
  });

  test("parses balance alert thresholds from environment", () => {
    const config = parseMonitorCliConfig([], {
      DEEPSEEK_BALANCE_ALERT_CNY: "25.5",
      DEEPSEEK_BALANCE_ALERT_USD: "5.0",
    });
    expect(config.balanceAlert.cny).toBe(25.5);
    expect(config.balanceAlert.usd).toBe(5.0);
  });
});

describe("parseThreshold", () => {
  test("handles numeric and non-numeric values safely", () => {
    expect(parseThreshold("15", 5)).toBe(15);
    expect(parseThreshold("-3", 5)).toBe(5);
    expect(parseThreshold("invalid", 5)).toBe(5);
    expect(parseThreshold(undefined, 5)).toBe(5);
  });
});

describe("buildCliArgs", () => {
  test("serializes config into CLI flag strings", () => {
    const flags = buildCliArgs({
      watch: true,
      interval: 20,
      health: true,
      altScreen: false,
    });
    expect(flags).toContain("--watch");
    expect(flags).toContain("--interval=20");
    expect(flags).toContain("--health");
    expect(flags).toContain("--no-alt-screen");
  });
});
