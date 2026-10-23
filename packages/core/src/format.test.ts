import { describe, expect, test } from "bun:test";
import {
  formatAge,
  formatPercent,
  formatResetCompact,
  money,
  padPercent,
  padResetCompact,
  truncate,
} from "./format";

describe("format helpers", () => {
  test("formats money amounts with currency symbols", () => {
    expect(money(110, "cny")).toBe("¥110.00");
    expect(money(25.5, "usd")).toBe("$25.50");
    expect(money(undefined, "cny")).toBe("—");
    expect(money(Number.NaN, "cny")).toBe("—");
  });

  test("formats age relative to now", () => {
    const now = 100_000;
    expect(formatAge(undefined, now)).toBe("no snapshot");
    expect(formatAge(now, now)).toBe("0s ago");
    expect(formatAge(now - 45_000, now)).toBe("45s ago");
    expect(formatAge(now - 120_000, now)).toBe("2m ago");
    expect(formatAge(now - 7_200_000, now)).toBe("2h ago");

    expect(formatAge(now - 30_000, now, true)).toBe("<1m ago");
    expect(formatAge(now - 90_000, now, true)).toBe("1m ago");
    expect(formatAge(now - 7_200_000, now, true)).toBe("2h ago");
  });

  test("formats percentage values", () => {
    expect(formatPercent(undefined)).toBe("—");
    expect(formatPercent(0.5)).toBe("50.0%");
    expect(formatPercent(1)).toBe("100.0%");
    expect(formatPercent(0.1234)).toBe("12.3%");
  });

  test("pads percentage and compact reset values", () => {
    expect(padPercent(0.5)).toBe(" 50.0%");
    expect(padPercent(undefined)).toBe("     —");
    expect(padPercent(0.5, 8)).toBe("   50.0%");

    const now = 1_000_000;
    expect(padResetCompact(now + 120_000, now)).toBe("    2m");
    expect(padResetCompact(undefined, now)).toBe("     —");
    expect(padResetCompact(now + 120_000, now, 4)).toBe("  2m");
  });
  test("formats compact reset relative countdown", () => {
    const now = 1_000_000;
    expect(formatResetCompact(undefined, now)).toBe("—");
    expect(formatResetCompact(Number.NaN, now)).toBe("—");
    expect(formatResetCompact(now - 100, now)).toBe("now");
    expect(formatResetCompact(now, now)).toBe("now");
    expect(formatResetCompact(now + 30_000, now)).toBe("0m");
    expect(formatResetCompact(now + 120_000, now)).toBe("2m");
    expect(formatResetCompact(now + 3_600_000, now)).toBe("1h0m");
    expect(formatResetCompact(now + 3_720_000, now)).toBe("1h2m");
    expect(formatResetCompact(now + 93_600_000, now)).toBe("1d2h");
  });

  test("truncates text with ellipsis", () => {
    expect(truncate("hello", 10)).toBe("hello");
    expect(truncate("hello", 5)).toBe("hello");
    expect(truncate("hello world", 8)).toBe("hello...");
    expect(truncate("hello", 3)).toBe("hel");
    expect(truncate("hello", 2)).toBe("he");
  });
});
