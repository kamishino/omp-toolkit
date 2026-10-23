import { describe, expect, test } from "bun:test";
import {
  applyHeal,
  PROVIDER,
  readSnapshot,
  readStreaks,
  restoreManaged,
  short,
  snapshotPath,
  statePath,
  streakPath,
} from "./circuit-breaker";

describe("circuit-breaker module", () => {
  test("exports expected provider identity and path resolvers", () => {
    expect(PROVIDER).toBe("google-antigravity");
    expect(statePath()).toContain("gemini-health-state.json");
    expect(snapshotPath()).toContain("gemini-health-latest.json");
    expect(streakPath()).toContain("gemini-health-streaks.json");
  });

  test("short formats error messages within length limit", () => {
    const err = new Error("Connection failed due to network timeout");
    expect(short(err)).toBe("Connection failed due to network timeout");

    const longError = new Error("A ".repeat(200));
    expect(short(longError).length).toBeLessThanOrEqual(180);
  });

  test("applyHeal handles empty results without policy mutation", async () => {
    const action = await applyHeal([], "tool");
    expect(action.changed).toEqual([]);
    expect(action.skipped).toEqual([]);
    expect(action.reason).toBe("no accounts to check");
  });

  test("applyHeal handles all-healthy accounts without exclusions", async () => {
    const results = [
      { index: 1, email: "ok1@example.com", project: "p1", status: "ok" as const, ms: 100 },
      { index: 2, email: "ok2@example.com", project: "p2", status: "ok" as const, ms: 120 },
    ];
    const action = await applyHeal(results, "tool");
    expect(action.changed).toEqual([]);
    expect(action.skipped).toEqual([]);
    expect(action.reason).toBe("all accounts healthy");
  });

  test("applyHeal recognizes provider-wide failures and skips exclusions", async () => {
    const results = [
      { index: 1, email: "fail1@example.com", project: "p1", status: "hang" as const, ms: 15000 },
      { index: 2, email: "fail2@example.com", project: "p2", status: "hang" as const, ms: 15000 },
    ];
    const action = await applyHeal(results, "tool");
    expect(action.changed).toEqual([]);
    expect(action.reason).toContain("all accounts failing");
  });

  test("readSnapshot returns null or valid snapshot structure", () => {
    const snapshot = readSnapshot();
    expect(snapshot === null || typeof snapshot.checkedAt === "number").toBe(true);
  });

  test("readStreaks returns streak record object", () => {
    const streaks = readStreaks();
    expect(typeof streaks).toBe("object");
  });

  test("restoreManaged returns array of restored accounts", async () => {
    const restored = await restoreManaged();
    expect(Array.isArray(restored)).toBe(true);
  });
});
