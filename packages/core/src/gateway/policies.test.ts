import { describe, expect, test } from "bun:test";
import { parseAccountPolicies } from "./policies";

describe("parseAccountPolicies", () => {
  test("empty and whitespace-only output means no policies", () => {
    expect(parseAccountPolicies("")).toEqual([]);
    expect(parseAccountPolicies("  \n\t ")).toEqual([]);
    expect(parseAccountPolicies("\uFEFF  ")).toEqual([]);
  });

  test("valid entries pass through with unknown fields preserved", () => {
    const raw = JSON.stringify([
      { provider: "google-antigravity", account: { email: "a@example.com" }, reservePct: 100 },
      { provider: "google-antigravity", account: { email: "b@example.com" }, custom: [1, 2] },
    ]);
    const parsed = parseAccountPolicies(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[1]).toMatchObject({ custom: [1, 2] });
  });

  test("non-array payloads throw a safe error", () => {
    for (const raw of ['{"provider":"x"}', '"policies"', "42", "null"]) {
      let error: unknown;
      try {
        parseAccountPolicies(raw);
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Invalid auth.accountPolicies payload");
      expect((error as Error).message).not.toContain(raw);
    }
  });

  test("invalid JSON throws the same safe error", () => {
    expect(() => parseAccountPolicies("{oops")).toThrow("Invalid auth.accountPolicies payload");
  });

  test("non-object rows throw without discarding the payload", () => {
    expect(() => parseAccountPolicies("[null]")).toThrow("Invalid auth.accountPolicies payload");
    expect(() => parseAccountPolicies('["x"]')).toThrow("Invalid auth.accountPolicies payload");
  });

  test("consumed fields are validated", () => {
    const bad = [
      JSON.stringify([{ provider: 42 }]),
      JSON.stringify([{ account: "a@example.com" }]),
      JSON.stringify([{ account: { email: 42 } }]),
      JSON.stringify([{ account: { accountId: null } }]),
      JSON.stringify([{ priority: Number.NaN }]),
      JSON.stringify([{ priority: "high" }]),
      JSON.stringify([{ reservePct: -1 }]),
      JSON.stringify([{ reservePct: 101 }]),
      JSON.stringify([{ reservePct: "100" }]),
    ];
    for (const raw of bad) {
      expect(() => parseAccountPolicies(raw)).toThrow("Invalid auth.accountPolicies payload");
    }
  });

  test("boundary reserve values and missing fields are accepted", () => {
    const parsed = parseAccountPolicies(
      JSON.stringify([{ reservePct: 0 }, { reservePct: 100 }, {}]),
    );
    expect(parsed).toHaveLength(3);
  });
});
