import { describe, expect, test } from "bun:test";
import { checkGatewayStatus, GatewayStatusProbe } from "./gateway-status";

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

  test("off when the probe throws", async () => {
    const status = await checkGatewayStatus(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(status).toBe("Gateway: Off");
  });
});
