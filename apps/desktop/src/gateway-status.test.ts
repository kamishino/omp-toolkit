import { describe, expect, test } from "bun:test";
import { checkGatewayStatus, fetchGatewayPanelView, GatewayStatusProbe } from "./gateway-status";

describe("gateway status probe", () => {
  test("active when health endpoint is ok", async () => {
    const status = await checkGatewayStatus(async () => ({ ok: true, status: 200 }));
    expect(status).toBe("Gateway: Active (:4000)");
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

    expect(await probe.get()).toBe("Gateway: Active (:4000)");
    expect(await probe.get()).toBe("Gateway: Active (:4000)");
    expect(fetches).toBe(1);

    const [a, b] = await Promise.all([probe.get(), probe.get()]);
    expect(a).toBe(b);
    expect(fetches).toBe(1);

    now += 30_001;
    expect(await probe.get()).toBe("Gateway: Active (:4000)");
    expect(fetches).toBe(2);
  });

  test("panel view enriches active state with model and client counts", async () => {
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
    expect(view.modelCount).toBe(2);
    expect(view.antigravityModelCount).toBe(1);
    expect(view.clientCount).toBe(2);
    expect(view.checkedAt).toBe(42);
  });

  test("panel view is off without probing models when health fails", async () => {
    const urls: string[] = [];
    const view = await fetchGatewayPanelView(async (url) => {
      urls.push(url);
      throw new Error("ECONNREFUSED");
    });
    expect(view.state).toBe("off");
    expect(urls).toHaveLength(1);
  });

  test("off when the probe throws", async () => {
    const status = await checkGatewayStatus(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(status).toBe("Gateway: Off");
  });
});
