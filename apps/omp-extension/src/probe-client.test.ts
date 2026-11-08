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

  test("probe returns ok when stream emits candidate model text with terminal finishReason", async () => {
    const client = new AntigravityProbeClient({
      execFileFn: async () => ({ stdout: "valid-token" }),
      fetchFn: async () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"candidates":[{"content":{"parts":[{"text":"OK"}]},"finishReason":"STOP"}]}\n\n',
              ),
            );
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
    expect(result.failureKind).toBeNull();
  });

  test("probe classifies HTTP 200 in-band SSE error as auth and invalidates cache", async () => {
    const client = new AntigravityProbeClient({
      execFileFn: async () => ({ stdout: "cached-token" }),
      fetchFn: async () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"error":{"code":401,"status":"UNAUTHENTICATED","message":"expired token"}}\n\n',
              ),
            );
            controller.close();
          },
        });
        return new Response(stream, { status: 200 });
      },
    });

    const account: Account = { index: 1, email: "user@example.com", project: "p-1" };
    await client.getToken(account);
    expect(client.getTokenCacheSize()).toBe(1);

    const result = await client.probe(account);
    expect(result.status).toBe("auth");
    expect(result.failureKind).toBe("auth");
    expect(client.getTokenCacheSize()).toBe(0); // Evicted!
  });

  test("probe classifies 401 as auth and invalidates cached token", async () => {
    const client = new AntigravityProbeClient({
      execFileFn: async () => ({ stdout: "token-to-invalidate" }),
      fetchFn: async () => new Response("Unauthorized", { status: 401 }),
    });

    const account: Account = { index: 5, email: "auth@example.com", project: "p-auth" };
    await client.getToken(account);
    expect(client.getTokenCacheSize()).toBe(1);

    const result = await client.probe(account);
    expect(result.status).toBe("auth");
    expect(result.failureKind).toBe("auth");
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
    expect(result.failureKind).toBe("model");
    expect(result.detail).toContain("404");
  });

  test("probe classifies timeout waiting for stream body as hang", async () => {
    const client = new AntigravityProbeClient({
      probeTimeoutMs: 20,
      execFileFn: async () => ({ stdout: "valid-token" }),
      fetchFn: async () => {
        // Return 200 OK headers immediately, but infinite hang on stream reading
        const hangingStream = new ReadableStream({
          pull() {
            return new Promise(() => {});
          },
        });
        return new Response(hangingStream, { status: 200 });
      },
    });

    const account: Account = { index: 2, email: "hang@example.com", project: "p-hang" };
    const result = await client.probe(account);
    expect(result.status).toBe("hang");
    expect(result.failureKind).toBe("timeout");
  });

  test("probe classifies network connection abort as network error", async () => {
    const client = new AntigravityProbeClient({
      execFileFn: async () => ({ stdout: "valid-token" }),
      fetchFn: async () => {
        const err = new Error("connection reset by peer");
        throw err;
      },
    });

    const account: Account = { index: 2, email: "network@example.com", project: "p-net" };
    const result = await client.probe(account);
    expect(result.status).toBe("error");
    expect(result.failureKind).toBe("network");
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
    const chunks = [
      encoder.encode("da"),
      encoder.encode(
        'ta: {"candidates":[{"content":{"parts":[{"text":"Hello"}]},"finishReason":"STOP"}]}\n\n',
      ),
    ];
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
    expect(result.failureKind).toBeNull();
  });

  test("checkAll returns ProbeSweep and updates confirmed status with second observation", async () => {
    let callCount = 0;
    const client = new AntigravityProbeClient({
      confirmDelayMs: 5,
      execFileFn: async () => ({ stdout: "valid-token" }),
      fetchFn: async () => {
        callCount++;
        if (callCount === 1) {
          // 1st probe: 503 transient error
          return new Response("Service Unavailable", { status: 503 });
        }
        // 2nd probe: 401 auth error
        return new Response("Unauthorized", { status: 401 });
      },
    });

    const account: Account = { index: 1, email: "u@ex.com", project: "p-1" };
    client.loadAccounts = async () => [account];

    const sweep = await client.checkAll(true);
    expect(sweep.startedAt).toBeGreaterThan(0);
    expect(sweep.results.length).toBe(1);

    // The second observation must NOT be masked as error! It should be auth with confirmed: false
    expect(sweep.results[0].status).toBe("auth");
    expect(sweep.results[0].failureKind).toBe("auth");
    expect(sweep.results[0].confirmed).toBe(false);
  });
});
