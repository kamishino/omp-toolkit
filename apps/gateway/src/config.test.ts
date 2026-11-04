import { describe, expect, test } from "bun:test";
import { bindToBaseUrl, parseGatewayCtlConfig, portOfBind } from "./config";

const HOME = "C:/home/tester";

describe("parseGatewayCtlConfig", () => {
  test("defaults to the standard binds and .omp layout", () => {
    const config = parseGatewayCtlConfig(["accounts"], {}, HOME);
    expect(config.command).toBe("accounts");
    expect(config.brokerBind).toBe("127.0.0.1:8765");
    expect(config.gatewayBind).toBe("127.0.0.1:4000");
    expect(config.clientsPath.replace(/\\/g, "/")).toEndWith(".omp/gateway-clients.json");
    expect(config.provider).toBe("google-antigravity");
  });
  test("accepts bind overrides and json", () => {
    const config = parseGatewayCtlConfig(
      ["start", "--json", "--broker-bind=127.0.0.1:18765", "--gateway-bind=127.0.0.1:14001"],
      {},
      HOME,
    );
    expect(config.json).toBe(true);
    expect(portOfBind(config.gatewayBind)).toBe(14001);
    expect(bindToBaseUrl(config.brokerBind)).toBe("http://127.0.0.1:18765");
  });
  test("unknown command falls back to help and flags unknowns", () => {
    const config = parseGatewayCtlConfig(["nope", "--wat"], {}, HOME);
    expect(config.command).toBe("help");
    expect(config.unknown).toEqual(["--wat"]);
  });
  test("tunnel and remote-recipe flags have loopback-safe defaults", () => {
    const config = parseGatewayCtlConfig(["start"], {}, HOME);
    expect(config.withTunnel).toBe(false);
    expect(config.cloudflaredBin).toBe("cloudflared");
    expect(config.tunnelConfigPath.replace(/\\/g, "/")).toEndWith(".omp/cloudflared/config.yml");
    expect(config.tunnelMetricsBind).toBe("127.0.0.1:48333");
    expect(config.baseUrl).toBeNull();
    expect(config.cfClientId).toBeNull();
    expect(config.cfClientSecret).toBeNull();
  });
  test("tunnel flags and CF env fallbacks parse", () => {
    const config = parseGatewayCtlConfig(
      [
        "start",
        "--with-tunnel",
        "--tunnel-config=C:/x/t.yml",
        "--base-url=https://gw.example.com",
        "--model=google-antigravity/gemini-3.8-flash",
        "--cf-client-id=id.access",
      ],
      { OMP_CF_CLIENT_SECRET: "s3cret" },
      HOME,
    );
    expect(config.withTunnel).toBe(true);
    expect(config.tunnelConfigPath).toBe("C:/x/t.yml");
    expect(config.baseUrl).toBe("https://gw.example.com");
    expect(config.recipeModel).toBe("google-antigravity/gemini-3.8-flash");
    expect(config.cfClientId).toBe("id.access");
    expect(config.cfClientSecret).toBe("s3cret");
    expect(config.unknown).toEqual([]);
  });
  test("tunnel env fallbacks drive autostart without flags", () => {
    const config = parseGatewayCtlConfig(
      ["start"],
      { OMP_WITH_TUNNEL: "1", OMP_TUNNEL_CONFIG: "C:/x/t.yml" },
      HOME,
    );
    expect(config.withTunnel).toBe(true);
    expect(config.tunnelConfigPath).toBe("C:/x/t.yml");
  });
});
