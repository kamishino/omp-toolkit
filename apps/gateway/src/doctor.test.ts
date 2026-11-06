import { describe, expect, test } from "bun:test";
import type { BrokerClient } from "./broker-client";
import { parseGatewayCtlConfig } from "./config";
import { runDoctorChecks, runRemoteDoctorChecks } from "./doctor";
import type { OmpAdapter } from "./omp-adapter";

function adapter(over: Partial<Record<string, string | null>> = {}): OmpAdapter {
  return {
    resolveOmpPath: async () => (over.path === undefined ? "omp.exe" : over.path),
    runOmpText: async (args: string[]) => {
      if (args[0] === "--version") return over.version === undefined ? "omp/18.16.0" : over.version;
      if (args[0] === "auth-broker") return "serve token status list";
      if (args[0] === "auth-gateway") return "serve stdio token status check --clients";
      return null;
    },
    launch: async () => 1,
    listOmpProcesses: async () => [],
    commandLineOf: async () => null,
    kill: async () => {},
    resolveCloudflaredPath: async () => over.cloudflared ?? null,
    runCloudflaredText: async () => "cloudflared version 2026.10.7",
    launchExe: async () => 1,
  };
}

function client(over: { tunnelHealth?: boolean } = {}): BrokerClient {
  return {
    brokerHealth: async () => true,
    gatewayHealth: async () => true,
    tunnelHealth: async () => over.tunnelHealth ?? false,
    getModels: async () => [],
    getSnapshot: async () => [],
    getCredentialCheck: async () => [],
    getUsage: async () => [],
    readStickyRows: async () => [],
    tokenPresent: () => true,
    readBrokerToken: () => "tok",
    postBlock: async () => {},
    deleteBlock: async () => {},
  };
}

const config = parseGatewayCtlConfig(["doctor"], {}, "C:/home/tester");

describe("runDoctorChecks", () => {
  test("passes on a healthy installation", async () => {
    const report = await runDoctorChecks({ adapter: adapter(), client: client(), config }, true);
    expect(report.passed).toBe(true);
    expect(report.exitCode).toBe(0);
  });
  test("fails closed when omp is missing (PATH stub)", async () => {
    const report = await runDoctorChecks(
      { adapter: adapter({ path: null, version: null }), client: client(), config },
      true,
    );
    expect(report.passed).toBe(false);
    expect(report.checks.find((c) => c.id === "omp-binary")?.status).toBe("fail");
  });
  test("tunnel checks only run when requested", async () => {
    const plain = await runDoctorChecks({ adapter: adapter(), client: client(), config }, true);
    expect(plain.checks.find((c) => c.id === "tunnel")?.status).toBe("pass");

    const tunnelConfig = parseGatewayCtlConfig(
      ["doctor", "--with-tunnel", "--tunnel-config=C:/missing/config.yml"],
      {},
      "C:/home/tester",
    );
    const missing = await runDoctorChecks(
      { adapter: adapter(), client: client(), config: tunnelConfig },
      false,
    );
    expect(missing.passed).toBe(false);
    expect(missing.checks.find((c) => c.id === "tunnel-binary")?.status).toBe("fail");
  });
});

describe("runRemoteDoctorChecks", () => {
  test("probes remote endpoint with mocked fetch and returns report", async () => {
    const remoteConfig = parseGatewayCtlConfig(
      [
        "doctor",
        "--remote",
        "--base-url=https://gw.example.com",
        "--cf-client-id=id",
        "--cf-client-secret=sec",
        "--gateway-token=tok",
      ],
      {},
      "C:/home/tester",
    );

    const mockFetch = async () =>
      new Response(JSON.stringify({ data: [{ id: "google-antigravity/gemini-3.8-flash" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    const report = await runRemoteDoctorChecks(
      { adapter: adapter(), client: client(), config: remoteConfig },
      mockFetch as unknown as typeof fetch,
    );

    expect(report.passed).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.checks.find((c) => c.id === "remote-tunnel")?.status).toBe("pass");
    expect(report.checks.find((c) => c.id === "remote-auth")?.status).toBe("pass");
    expect(report.checks.find((c) => c.id === "remote-models")?.status).toBe("pass");
  });
});
