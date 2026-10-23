import { describe, expect, test } from "bun:test";
import type { Policy } from "@omp-toolkit/core";
import { RoutingPolicyStore } from "./policy-store";

describe("RoutingPolicyStore", () => {
  test("reads policies safely with fallbacks", async () => {
    let calledCommand: string[] = [];
    const store = new RoutingPolicyStore({
      execFileFn: async (_file, args) => {
        calledCommand = args;
        return {
          stdout: JSON.stringify([
            {
              provider: "google-antigravity",
              account: { email: "test@example.com" },
              reservePct: 100,
            },
          ]),
        };
      },
    });

    const policies = await store.readPolicies();
    expect(calledCommand).toContain("get");
    expect(policies.length).toBe(1);
    expect(policies[0].account?.email).toBe("test@example.com");
  });

  test("handles empty or invalid policy output gracefully", async () => {
    const store = new RoutingPolicyStore({
      execFileFn: async () => ({ stdout: "not-json" }),
    });

    const policies = await store.readPolicies();
    expect(policies).toEqual([]);
  });

  test("addExclusion adds new policy and saves", async () => {
    let saved: Policy[] = [];
    const store = new RoutingPolicyStore({
      execFileFn: async (_file, args) => {
        if (args.includes("get")) {
          return { stdout: JSON.stringify(saved) };
        }
        if (args.includes("set")) {
          saved = JSON.parse(args[args.length - 1]);
          return { stdout: "" };
        }
        return { stdout: "" };
      },
    });

    const res1 = await store.addExclusion("google-antigravity", "hung@example.com", 100);
    expect(res1.changed).toBe(true);
    expect(saved.length).toBe(1);
    expect(saved[0].account?.email).toBe("hung@example.com");
    expect(saved[0].reservePct).toBe(100);

    // Duplicate add should not re-save
    const res2 = await store.addExclusion("google-antigravity", "hung@example.com", 100);
    expect(res2.changed).toBe(false);
  });

  test("removeExclusions removes matching emails and saves", async () => {
    let saved: Policy[] = [
      { provider: "google-antigravity", account: { email: "user1@example.com" }, reservePct: 100 },
      { provider: "google-antigravity", account: { email: "user2@example.com" }, reservePct: 100 },
      { provider: "deepseek", account: { email: "user1@example.com" }, reservePct: 100 },
    ];

    const store = new RoutingPolicyStore({
      execFileFn: async (_file, args) => {
        if (args.includes("get")) {
          return { stdout: JSON.stringify(saved) };
        }
        if (args.includes("set")) {
          saved = JSON.parse(args[args.length - 1]);
          return { stdout: "" };
        }
        return { stdout: "" };
      },
    });

    const toRemove = new Set(["user1@example.com"]);
    const result = await store.removeExclusions("google-antigravity", toRemove);
    expect(result.removed).toEqual(["user1@example.com"]);
    expect(saved.length).toBe(2);
    // DeepSeek user1@example.com must remain untouched
    expect(saved.find((p) => p.provider === "deepseek")).toBeDefined();
    // Antigravity user2@example.com must remain
    expect(saved.find((p) => p.account?.email === "user2@example.com")).toBeDefined();
  });
});
