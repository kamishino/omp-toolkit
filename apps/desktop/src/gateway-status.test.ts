import { describe, expect, test } from "bun:test";
import { checkGatewayStatus, fetchGatewayPanelView, GatewayStatusProbe } from "./gateway-status";

describe("gateway status probe", () => {
  test("alive without access check when no token is configured", async () => {
    const urls: string[] = [];
    const status = await checkGatewayStatus(async (url) => {
      urls.push(url);
      return { ok: true, status: 200 };
    });
    expect(status).toBe("Gateway: Alive · access not checked");
    expect(urls).toEqual(["http://127.0.0.1:4000/healthz"]);
  });

  test("reports HTTP status when not ok", async () => {
    const status = await checkGatewayStatus(async () => ({ ok: false, status: 503 }));
    expect(status).toBe("Gateway: HTTP 503");
  });

  test("probe caches within TTL, dedupes in-flight, refreshes after TTL", async () => {
    let fetches = 0;
    let now = 1_000_000;
    const probe = new GatewayStatusProbe(
      30_000,
      async () => {
        fetches++;
        return { ok: true, status: 200 };
      },
      () => now,
    );

    expect(await probe.get()).toBe("Gateway: Alive · access not checked");
    expect(await probe.get()).toBe("Gateway: Alive · access not checked");
    expect(fetches).toBe(1);

    const [a, b] = await Promise.all([probe.get(), probe.get()]);
    expect(a).toBe(b);
    expect(fetches).toBe(1);

    now += 30_001;
    expect(await probe.get()).toBe("Gateway: Alive · access not checked");
    expect(fetches).toBe(2);
  });

  test("verified catalogue reports counts and full endpoint", async () => {
    const view = await fetchGatewayPanelView(
      async (url) =>
        url.endsWith("/v1/models")
          ? {
              ok: true,
              status: 200,
              json: async () => ({
                data: [{ id: "google-antigravity/gemini-3.8-flash" }, { id: "openai/gpt" }],
              }),
            }
          : { ok: true, status: 200 },
      { readGatewayToken: () => "tok", readClientCount: () => 2 },
      () => 42,
    );
    expect(view.state).toBe("active");
    expect(view.label).toBe("Gateway: Alive · access verified");
    expect(view.endpoint).toBe("http://127.0.0.1:4000");
    expect(view.access).toBe("ok");
    expect(view.accessHttpStatus).toBe(200);
    expect(view.modelCount).toBe(2);
    expect(view.antigravityModelCount).toBe(1);
    expect(view.clientCount).toBe(2);
    expect(view.checkedAt).toBe(42);
  });

  test("denied catalogue keeps liveness with denied access", async () => {
    const view = await fetchGatewayPanelView(
      async (url) =>
        url.endsWith("/v1/models") ? { ok: false, status: 401 } : { ok: true, status: 200 },
      { readGatewayToken: () => "tok" },
      () => 7,
    );
    expect(view.state).toBe("active");
    expect(view.label).toBe("Gateway: Alive · access denied");
    expect(view.access).toBe("denied");
    expect(view.accessHttpStatus).toBe(401);
    expect(view.modelCount).toBeNull();
  });

  test("broken catalogue keeps liveness with unavailable access", async () => {
    const view = await fetchGatewayPanelView(
      async (url) =>
        url.endsWith("/v1/models") ? { ok: false, status: 500 } : { ok: true, status: 200 },
      { readGatewayToken: () => "tok" },
      () => 7,
    );
    expect(view.state).toBe("active");
    expect(view.access).toBe("error");
    expect(view.modelCount).toBeNull();
  });

  test("malformed catalogue is an error, not zero models", async () => {
    const view = await fetchGatewayPanelView(
      async (url) =>
        url.endsWith("/v1/models")
          ? { ok: true, status: 200, json: async () => ({ data: [{ id: 7 }] }) }
          : { ok: true, status: 200 },
      { readGatewayToken: () => "tok" },
      () => 7,
    );
    expect(view.access).toBe("error");
    expect(view.modelCount).toBeNull();
  });

  test("empty catalogue is known zero, not an error", async () => {
    const view = await fetchGatewayPanelView(
      async (url) =>
        url.endsWith("/v1/models")
          ? { ok: true, status: 200, json: async () => ({ data: [] }) }
          : { ok: true, status: 200 },
      { readGatewayToken: () => "tok" },
      () => 7,
    );
    expect(view.access).toBe("ok");
    expect(view.modelCount).toBe(0);
    expect(view.antigravityModelCount).toBe(0);
  });

  test("panel view is off without probing models when health fails", async () => {
    const urls: string[] = [];
    const view = await fetchGatewayPanelView(async (url) => {
      urls.push(url);
      throw new Error("ECONNREFUSED");
    });
    expect(view.state).toBe("off");
    expect(view.access).toBe("unknown");
    expect(urls).toHaveLength(1);
  });

  test("off when the probe throws", async () => {
    const status = await checkGatewayStatus(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(status).toBe("Gateway: Off");
  });
});
