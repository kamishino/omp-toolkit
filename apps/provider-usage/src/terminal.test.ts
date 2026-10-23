import { describe, expect, test } from "bun:test";
import { isInteractiveTui, useAlternateScreen } from "./terminal";

const base = {
  watch: true,
  isTTY: true,
  json: false,
  term: undefined as string | undefined,
  noAltScreen: false,
};

describe("alternate-screen selection", () => {
  test("uses the alternate screen for an interactive watch", () => {
    expect(useAlternateScreen(base)).toBe(true);
    expect(isInteractiveTui(base)).toBe(true);
  });

  test("falls back for non-TTY, dumb terminals, json, one-shot, and --no-alt-screen", () => {
    expect(useAlternateScreen({ ...base, isTTY: false })).toBe(false);
    expect(useAlternateScreen({ ...base, term: "dumb" })).toBe(false);
    expect(useAlternateScreen({ ...base, json: true })).toBe(false);
    expect(useAlternateScreen({ ...base, watch: false })).toBe(false);
    expect(useAlternateScreen({ ...base, noAltScreen: true })).toBe(false);
  });
});
