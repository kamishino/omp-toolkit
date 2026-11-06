import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  test("help flags set command to help without unknown warnings", () => {
    const config1 = parseGatewayCtlConfig(["--help"], {}, HOME);
    expect(config1.command).toBe("help");
    expect(config1.unknown).toEqual([]);

    const config2 = parseGatewayCtlConfig(["-h"], {}, HOME);
    expect(config2.command).toBe("help");
    expect(config2.unknown).toEqual([]);
  });
  test("doctor --remote parses remote flag without unknown warnings", () => {
    const config = parseGatewayCtlConfig(["doctor", "--remote"], {}, HOME);
    expect(config.command).toBe("doctor");
    expect(config.remote).toBe(true);
    expect(config.unknown).toEqual([]);
  });
  test("connect command parses platform and client name", () => {
    const config = parseGatewayCtlConfig(
      ["connect", "claude-code", "my-client", "--force"],
      {},
      HOME,
    );
    expect(config.command).toBe("connect");
    expect(config.target).toBe("claude-code");
    expect(config.positionals).toEqual(["claude-code", "my-client"]);
    expect(config.force).toBe(true);
    expect(config.unknown).toEqual([]);
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
  test("remote-pack parses platform target and secret inputs", () => {
    const config = parseGatewayCtlConfig(
      ["remote-pack", "dsh", "--base-url=https://gw.example.com", "--gateway-token=omp_gw_x"],
      { OMP_CF_CLIENT_ID: "id", OMP_CF_CLIENT_SECRET: "s" },
      HOME,
    );
    expect(config.command).toBe("remote-pack");
    expect(config.target).toBe("dsh");
    expect(config.baseUrl).toBe("https://gw.example.com");
    expect(config.packGatewayToken).toBe("omp_gw_x");
    expect(config.cfClientId).toBe("id");
    expect(config.cfClientSecret).toBe("s");
    expect(config.unknown).toEqual([]);
  });
  test("remote-pair parses platform and client name", () => {
    const config = parseGatewayCtlConfig(
      ["remote-pair", "claude-code", "pc2", "--base-url=https://gw.example.com"],
      { OMP_CF_CLIENT_ID: "cf-id", OMP_CF_CLIENT_SECRET: "cf-secret" },
      HOME,
    );
    expect(config.command).toBe("remote-pair");
    expect(config.target).toBe("claude-code");
    expect(config.positionals).toEqual(["claude-code", "pc2"]);
    expect(config.baseUrl).toBe("https://gw.example.com");
    expect(config.cfClientId).toBe("cf-id");
    expect(config.cfClientSecret).toBe("cf-secret");
    expect(config.unknown).toEqual([]);
  });
  test("falls back to ~/.omp/cf-access.json when flags and env are omitted", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-access-test-"));
    try {
      const ompDir = path.join(tmpDir, ".omp");
      fs.mkdirSync(ompDir, { recursive: true });
      fs.writeFileSync(
        path.join(ompDir, "cf-access.json"),
        JSON.stringify({
          clientId: "disk-cf-id",
          clientSecret: "disk-cf-secret",
          domain: "disk-gw.example.com",
        }),
      );
      const config = parseGatewayCtlConfig(["recipe", "omp"], {}, tmpDir);
      expect(config.command).toBe("recipe");
      expect(config.target).toBe("omp");
      expect(config.cfClientId).toBe("disk-cf-id");
      expect(config.cfClientSecret).toBe("disk-cf-secret");
      expect(config.baseUrl).toBe("https://disk-gw.example.com");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
