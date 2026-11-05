import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MONITOR_INTERVAL,
  parseMonitorCliConfig,
  parseThreshold,
  useAlternateScreen,
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

  test("defaults accountSort to weekly-reset and parses --sort with aliases", () => {
    expect(parseMonitorCliConfig([], {}).accountSort).toBe("weekly-reset");
    expect(parseMonitorCliConfig(["--sort=weekly-usage"], {}).accountSort).toBe("weekly-usage");
    expect(parseMonitorCliConfig(["--sort=usage"], {}).accountSort).toBe("weekly-usage");
    expect(parseMonitorCliConfig(["--sort=reset"], {}).accountSort).toBe("weekly-reset");
    expect(parseMonitorCliConfig(["--sort=bogus"], {}).accountSort).toBe("weekly-reset");
  });

  test("reads accountSort from OMP_ACCOUNT_SORT and flags it as a known argument", () => {
    expect(parseMonitorCliConfig([], { OMP_ACCOUNT_SORT: "weekly-usage" }).accountSort).toBe(
      "weekly-usage",
    );
    expect(parseMonitorCliConfig(["--sort=weekly-usage"], {}).unknown).toEqual([]);
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

describe("useAlternateScreen", () => {
  const base = {
    watch: true,
    isTTY: true,
    json: false,
    term: "xterm-256color",
    noAltScreen: false,
  };

  test("returns true when watching interactively in a capable terminal", () => {
    expect(useAlternateScreen(base)).toBe(true);
  });

  test("returns false when watch is false or not a TTY", () => {
    expect(useAlternateScreen({ ...base, watch: false })).toBe(false);
    expect(useAlternateScreen({ ...base, isTTY: false })).toBe(false);
  });

  test("returns false when json or noAltScreen is set or terminal is dumb", () => {
    expect(useAlternateScreen({ ...base, json: true })).toBe(false);
    expect(useAlternateScreen({ ...base, noAltScreen: true })).toBe(false);
    expect(useAlternateScreen({ ...base, term: "dumb" })).toBe(false);
  });
});
