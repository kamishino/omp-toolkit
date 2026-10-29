import { describe, expect, test } from "bun:test";
import type { Account } from "@omp-toolkit/core";
import { AntigravityProbeClient } from "./probe-client";

describe("AntigravityProbeClient", () => {
  test("loadAccounts parses token list and usage report correctly", async () => {
    let usageCalled = false;
    let tokenListCalled = false;

    const client = new AntigravityProbeClient({
      execFileFn: async (_file, args) => {
        if (args.includes("usage")) {
          usageCalled = true;
          return {
            stdout: JSON.stringify({
              reports: [
                { metadata: { email: "beta@example.com", projectId: "proj-beta" } },
                { metadata: { email: "alpha@example.com", projectId: "proj-alpha" } },
              ],
            }),
          };
        }
        if (args.includes("--list")) {
          tokenListCalled = true;
          return {
            stdout: "2. beta@example.com\n1. alpha@example.com\n",
          };
        }
        return { stdout: "" };
      },
    });

    const accounts = await client.loadAccounts();
    expect(usageCalled).toBe(true);
    expect(tokenListCalled).toBe(true);
    expect(accounts.length).toBe(2);
    // Must be sorted by index ascending
    expect(accounts[0]).toEqual({ index: 1, email: "alpha@example.com", project: "proj-alpha" });
    expect(accounts[1]).toEqual({ index: 2, email: "beta@example.com", project: "proj-beta" });
  });

  test("getToken caches token and reuses it within TTL", async () => {
    let callCount = 0;
    const client = new AntigravityProbeClient({
      execFileFn: async () => {
        callCount++;
        return { stdout: "mock-oauth-bearer-token\n" };
      },
    });

    const token1 = await client.getToken(1);
    expect(token1).toBe("mock-oauth-bearer-token");
    expect(callCount).toBe(1);

    const token2 = await client.getToken(1);
    expect(token2).toBe("mock-oauth-bearer-token");
    expect(callCount).toBe(1); // Served from cache!

    client.clearTokenCache();
    expect(client.getTokenCacheSize()).toBe(0);

    const token3 = await client.getToken(1);
    expect(token3).toBe("mock-oauth-bearer-token");
    expect(callCount).toBe(2); // Fresh call after clear!
  });

  test("probe returns ok when stream emits data: event", async () => {
    const client = new AntigravityProbeClient({
      execFileFn: async () => ({ stdout: "valid-token" }),
      fetchFn: async () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"response": "OK"}\n\n'));
            controller.close();
          },
        });
        return new Response(stream, { status: 200 });
      },
    });

    const account: Account = { index: 1, email: "user@example.com", project: "p-1" };
    const result = await client.probe(account);
    expect(result.status).toBe("ok");
    expect(result.email).toBe("user@example.com");
  });

  test("probe classifies 401 as auth and invalidates cached token", async () => {
    const client = new AntigravityProbeClient({
      execFileFn: async () => ({ stdout: "token-to-invalidate" }),
      fetchFn: async () => new Response("Unauthorized", { status: 401 }),
    });

    const account: Account = { index: 5, email: "auth@example.com", project: "p-auth" };
    await client.getToken(5);
    expect(client.getTokenCacheSize()).toBe(1);

    const result = await client.probe(account);
    expect(result.status).toBe("auth");
    expect(result.detail).toContain("401");
    expect(client.getTokenCacheSize()).toBe(0); // Invalidation verified!
  });

  test("probe classifies 404 as model-error", async () => {
    const client = new AntigravityProbeClient({
      execFileFn: async () => ({ stdout: "valid-token" }),
      fetchFn: async () => new Response("Not Found", { status: 404 }),
    });

    const account: Account = { index: 3, email: "model@example.com", project: "p-model" };
    const result = await client.probe(account);
    expect(result.status).toBe("model-error");
    expect(result.detail).toContain("404");
  });

  test("probe classifies timeout or abort as hang", async () => {
    const client = new AntigravityProbeClient({
      execFileFn: async () => ({ stdout: "valid-token" }),
      fetchFn: async () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        throw err;
      },
    });

    const account: Account = { index: 2, email: "hang@example.com", project: "p-hang" };
    const result = await client.probe(account);
    expect(result.status).toBe("hang");
    expect(result.detail).toContain("no first event");
  });

  test("loadAccounts handles case mismatch and index 0", async () => {
    const client = new AntigravityProbeClient({
      execFileFn: async (_file, args) => {
        if (args.includes("usage")) {
          return {
            stdout: JSON.stringify({
              reports: [{ metadata: { email: "user@example.com", projectId: "proj-zero" } }],
            }),
          };
        }
        if (args.includes("--list")) {
          return {
            stdout: "0. User@Example.com\n",
          };
        }
        return { stdout: "" };
      },
    });

    const accounts = await client.loadAccounts();
    expect(accounts).toEqual([{ index: 0, email: "user@example.com", project: "proj-zero" }]);
  });

  test("probe accumulates split chunks across chunk boundaries", async () => {
    const encoder = new TextEncoder();
    const chunks = [encoder.encode("da"), encoder.encode('ta: {"candidates":[]}\n\n')];
    let chunkIndex = 0;

    const stream = new ReadableStream({
      pull(controller) {
        if (chunkIndex < chunks.length) {
          controller.enqueue(chunks[chunkIndex++]);
        } else {
          controller.close();
        }
      },
    });

    const client = new AntigravityProbeClient({
      execFileFn: async () => ({ stdout: "valid-token" }),
      fetchFn: async () => new Response(stream, { status: 200 }),
    });

    const account: Account = { index: 1, email: "split@example.com", project: "p-split" };
    const result = await client.probe(account);
    expect(result.status).toBe("ok");
    expect(result.email).toBe("split@example.com");
  });
});
