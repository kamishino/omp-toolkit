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
