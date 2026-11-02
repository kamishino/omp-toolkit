import { describe, expect, test } from "bun:test";
import { checkGatewayStatus } from "./gateway-status";

describe("gateway status probe", () => {
  test("active when health endpoint is ok", async () => {
    const status = await checkGatewayStatus(
      (async () => new Response("ok", { status: 200 })) as typeof fetch,
    );
    expect(status).toBe("Gateway: Active (:4000)");
  });

  test("reports HTTP status when not ok", async () => {
    const status = await checkGatewayStatus(
      (async () => new Response("no", { status: 503 })) as typeof fetch,
    );
    expect(status).toBe("Gateway: HTTP 503");
  });

  test("off when the probe throws", async () => {
    const status = await checkGatewayStatus((async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch);
    expect(status).toBe("Gateway: Off");
  });
});
