import { describe, expect, test } from "bun:test";
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

  test("readPoliciesStrict propagates exec errors and non-array output", async () => {
    const rejectingStore = new RoutingPolicyStore({
      execFileFn: async () => {
        throw new Error("spawn omp ENOENT");
      },
    });

    expect(await rejectingStore.readPolicies()).toEqual([]);
    await expect(rejectingStore.readPoliciesStrict()).rejects.toThrow("spawn omp ENOENT");

    const invalidJsonStore = new RoutingPolicyStore({
      execFileFn: async () => ({ stdout: "not-json" }),
    });
    expect(await invalidJsonStore.readPolicies()).toEqual([]);
    await expect(invalidJsonStore.readPoliciesStrict()).rejects.toThrow();

    const nonArrayStore = new RoutingPolicyStore({
      execFileFn: async () => ({ stdout: '{"not":"array"}' }),
    });
    expect(await nonArrayStore.readPolicies()).toEqual([]);
    await expect(nonArrayStore.readPoliciesStrict()).rejects.toThrow(
      "auth.accountPolicies is not an array",
    );
  });
});
