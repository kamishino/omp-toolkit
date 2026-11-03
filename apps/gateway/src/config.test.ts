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
});
