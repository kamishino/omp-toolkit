import { describe, expect, test } from "bun:test";
import { parseInterval } from "./interval";

describe("parseInterval", () => {
  test("uses finite positive argument clamped to at least 30", () => {
    expect(parseInterval("60", {})).toBe(60);
    expect(parseInterval("10", {})).toBe(30);
    expect(parseInterval("45.8", {})).toBe(45);
  });

  test("falls back to OMP_WIDGET_INTERVAL_SECONDS when argument is undefined or invalid", () => {
    expect(parseInterval(undefined, { OMP_WIDGET_INTERVAL_SECONDS: "120" })).toBe(120);
    expect(parseInterval("invalid", { OMP_WIDGET_INTERVAL_SECONDS: "50" })).toBe(50);
    expect(parseInterval("-5", { OMP_WIDGET_INTERVAL_SECONDS: "75" })).toBe(75);
    expect(parseInterval("0", { OMP_WIDGET_INTERVAL_SECONDS: "90" })).toBe(90);
  });

  test("falls back to default 300 when both argument and env are absent or invalid", () => {
    expect(parseInterval(undefined, {})).toBe(300);
    expect(parseInterval("invalid", { OMP_WIDGET_INTERVAL_SECONDS: "not-a-number" })).toBe(300);
    expect(parseInterval("-10", { OMP_WIDGET_INTERVAL_SECONDS: "-20" })).toBe(300);
  });
});
