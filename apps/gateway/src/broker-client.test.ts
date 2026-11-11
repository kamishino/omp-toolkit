import { describe, expect, test } from "bun:test";
import { createBrokerClient } from "./broker-client";
import { parseGatewayCtlConfig } from "./config";

const CONFIG = parseGatewayCtlConfig(["status"], {}, "C:/home/tester");

function stubFetch(handler: () => Promise<Response>): typeof fetch {
  return handler as unknown as typeof fetch;
}

describe("tunnelHealth", () => {
  test("is healthy with registered edge connections", async () => {
    const client = createBrokerClient(CONFIG, {
      fetchFn: stubFetch(async () => new Response("cloudflared_tunnel_ha_connections 4\n")),
    });
    expect(await client.tunnelHealth()).toBe(true);
  });
  test("reads down with zero connections despite a serving listener", async () => {
    const client = createBrokerClient(CONFIG, {
      fetchFn: stubFetch(async () => new Response("cloudflared_tunnel_ha_connections 0\n")),
    });
    expect(await client.tunnelHealth()).toBe(false);
  });
  test("reads down when metrics are unreachable", async () => {
    const client = createBrokerClient(CONFIG, {
      fetchFn: stubFetch(async () => {
        throw new Error("refused");
      }),
    });
    expect(await client.tunnelHealth()).toBe(false);
  });
});

describe("getModels", () => {
  test("returns served model ids, skipping malformed entries", async () => {
    const client = createBrokerClient(CONFIG, {
      fetchFn: stubFetch(
        async () =>
          new Response(JSON.stringify({ data: [{ id: "p/a" }, { id: 7 }, {}, { id: "p/b" }] }), {
            headers: { "Content-Type": "application/json" },
          }),
      ),
    });
    expect(await client.getModels()).toEqual(["p/a", "p/b"]);
  });
});

describe("payload validation", () => {
  test("getSnapshot accepts the credentials list and the entries alias", async () => {
    const rows = [{ id: 1, provider: "google-antigravity", identityKey: "email:a@example.com" }];
    for (const body of [{ credentials: rows }, { entries: rows }]) {
      const client = createBrokerClient(CONFIG, {
        fetchFn: stubFetch(async () => new Response(JSON.stringify(body))),
      });
      expect(await client.getSnapshot()).toEqual(rows);
    }
  });

  test("getSnapshot rejects malformed payloads without echoing them", async () => {
    const bad = [
      { credentials: { id: 1 } },
      { credentials: [{ id: 0, provider: "google-antigravity" }] },
      { credentials: [{ id: 1 }] },
      { credentials: [{ id: 1, provider: "google-antigravity", identityKey: 7 }] },
      {
        credentials: [
          {
            id: 1,
            provider: "google-antigravity",
            blocks: [{ providerKey: "k", blockScope: "", blockedUntilMs: Number.NaN }],
          },
        ],
      },
    ];
    for (const body of bad) {
      const client = createBrokerClient(CONFIG, {
        fetchFn: stubFetch(async () => new Response(JSON.stringify(body))),
      });
      const error = await client.getSnapshot().then(
        () => null,
        (err: unknown) => err,
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("unusable snapshot payload");
      expect((error as Error).message).not.toContain("NaN");
    }
  });

  test("getCredentialCheck validates rows and getUsage validates envelopes", async () => {
    const checkClient = createBrokerClient(CONFIG, {
      fetchFn: stubFetch(
        async () =>
          new Response(JSON.stringify({ credentials: [{ id: 1, provider: "p", ok: "yes" }] })),
      ),
    });
    await expect(checkClient.getCredentialCheck()).rejects.toThrow(
      "unusable credential-check payload",
    );

    const usageClient = createBrokerClient(CONFIG, {
      fetchFn: stubFetch(async () => new Response(JSON.stringify({ reports: "none" }))),
    });
    await expect(usageClient.getUsage()).rejects.toThrow("unusable usage payload");

    const okUsage = createBrokerClient(CONFIG, {
      fetchFn: stubFetch(
        async () =>
          new Response(
            JSON.stringify({
              reports: [{ provider: "p", limits: [{ amount: { remainingFraction: 0 } }] }],
            }),
          ),
      ),
    });
    expect(await okUsage.getUsage()).toHaveLength(1);
  });

  test("missing sticky cache throws instead of reading as empty", async () => {
    const client = createBrokerClient(CONFIG, {});
    await expect(client.readStickyRows()).rejects.toThrow("pin distribution unavailable");
  });
});
