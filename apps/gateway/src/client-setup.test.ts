import { describe, expect, test } from "bun:test";
import type { AuditEvent, GatewayAudit } from "./audit";
import type { BrokerClient } from "./broker-client";
import { setupGatewayClient } from "./client-setup";
import { parseGatewayCtlConfig } from "./config";
import { GatewayWrites, sha256Hex } from "./writes";

const NOW = 1_800_000_000_000;
const CF_ENV = {
  OMP_CF_CLIENT_ID: "fixture-id",
  OMP_CF_CLIENT_SECRET: "fixture-secret",
};

function setupWrites() {
  let nonce = 0;
  let clientsText = "{}";
  const events: AuditEvent[] = [];
  const client: BrokerClient = {
    brokerHealth: async () => true,
    gatewayHealth: async () => true,
    tunnelHealth: async () => false,
    getModels: async () => [],
    getSnapshot: async () => [
      { id: 1, provider: "google-antigravity", identityKey: "email:alice@example.com" },
    ],
    getCredentialCheck: async () => [],
    getUsage: async () => [],
    readStickyRows: async () => [],
    tokenPresent: () => true,
    readBrokerToken: () => "tok",
    postBlock: async () => {},
    deleteBlock: async () => {},
  };
  const writes = new GatewayWrites({
    client,
    readPoliciesRaw: async () => "[]",
    writePolicies: async () => {},
    readTextFile: () => clientsText,
    writeTextFileAtomic: (_p, text) => {
      clientsText = text;
    },
    fileExists: () => true,
    clientsPath: "clients.json",
    provider: "google-antigravity",
    audit: {
      record: async (e) => {
        events.push(e);
      },
      latest: async () => null,
    } satisfies GatewayAudit,
    now: () => NOW,
    randomHex: (n) => {
      nonce += 1;
      return nonce.toString(16).padStart(2 * n, "a");
    },
  });
  return { writes, events, getClientsText: () => clientsText };
}

function remoteConfig(argv: string[]) {
  return parseGatewayCtlConfig(argv, CF_ENV, "/tmp/nonexistent-home");
}

describe("setupGatewayClient", () => {
  test("remote-pair omp emits the two-file YAML with a real token", async () => {
    const { writes, events, getClientsText } = setupWrites();
    const result = await setupGatewayClient(
      remoteConfig(["remote-pair", "omp", "pc2", "--base-url=https://gw.example.test"]),
      "remote-pair",
      writes,
    );
    expect(result.exitCode).toBe(0);
    expect(result.payload.ok).toBe(true);
    expect(result.payload.token).toStartWith("omp_gw_");
    expect(result.payload.recipe?.platform).toBe("omp");
    expect(result.payload.recipe?.snippet).toContain("models.yml");
    expect(result.payload.recipe?.snippet).toContain("config.yml");
    expect(result.payload.recipe?.snippet).toContain("CF-Access-Client-Id: fixture-id");
    expect(getClientsText()).toContain(sha256Hex(result.payload.token ?? ""));
    expect(getClientsText()).not.toContain(result.payload.token ?? "never");
    expect(events.some((e) => e.kind === "gateway.client-add")).toBe(true);
  });

  test("missing remote settings fail before any client mutation", async () => {
    const { writes, getClientsText } = setupWrites();
    const noUrl = await setupGatewayClient(
      remoteConfig(["remote-pair", "omp", "pc2"]),
      "remote-pair",
      writes,
    );
    expect(noUrl.exitCode).toBe(2);
    expect(noUrl.payload.token).toBeUndefined();
    expect(getClientsText()).toBe("{}");
  });

  test("malformed URLs and partial Access pairs fail closed", async () => {
    for (const argv of [
      ["remote-pair", "omp", "pc2", "--base-url=http://gw.example.test"],
      ["remote-pair", "omp", "pc2", "--base-url=https://gw.example.test/v1"],
      ["remote-pair", "omp", "pc2", "--base-url=https://gw.example.test/path?q=1"],
      ["remote-pair", "omp", "pc2", "--base-url=https://gw.example.test", "--cf-client-id=only-id"],
    ]) {
      const { writes, getClientsText } = setupWrites();
      const env = argv.some((a) => a.includes("cf-client-id")) ? {} : CF_ENV;
      const result = await setupGatewayClient(
        parseGatewayCtlConfig(argv, env, "/tmp/nonexistent-home"),
        "remote-pair",
        writes,
      );
      expect(result.exitCode).toBe(2);
      expect(getClientsText()).toBe("{}");
    }
  });

  test("unknown platforms and Access-incompatible recipes fail before mutation", async () => {
    const { writes, getClientsText } = setupWrites();
    const unknown = await setupGatewayClient(
      remoteConfig(["remote-pair", "nope", "pc2", "--base-url=https://gw.example.test"]),
      "remote-pair",
      writes,
    );
    expect(unknown.exitCode).toBe(2);
    const claude = await setupGatewayClient(
      remoteConfig(["remote-pair", "claude-code", "pc2", "--base-url=https://gw.example.test"]),
      "remote-pair",
      writes,
    );
    expect(claude.exitCode).toBe(2);
    expect(claude.lines.join("\n")).toContain("curl, dsh, omp");
    expect(getClientsText()).toBe("{}");
  });

  test("duplicate names fail without snippets; only --force replaces", async () => {
    const { writes, getClientsText } = setupWrites();
    const first = await setupGatewayClient(
      remoteConfig(["remote-pair", "omp", "pc2", "--base-url=https://gw.example.test"]),
      "remote-pair",
      writes,
    );
    expect(first.exitCode).toBe(0);
    const before = getClientsText();
    const dup = await setupGatewayClient(
      remoteConfig(["remote-pair", "omp", "pc2", "--base-url=https://gw.example.test"]),
      "remote-pair",
      writes,
    );
    expect(dup.exitCode).toBe(1);
    expect(dup.payload.token).toBeUndefined();
    expect(dup.payload.recipe).toBeUndefined();
    expect(dup.lines.join("\n")).not.toContain("models.yml");
    expect(getClientsText()).toBe(before);
    const forced = await setupGatewayClient(
      remoteConfig(["remote-pair", "omp", "pc2", "--base-url=https://gw.example.test", "--force"]),
      "remote-pair",
      writes,
    );
    expect(forced.exitCode).toBe(0);
    expect(forced.payload.token).not.toBe(first.payload.token);
  });

  test("connect loopback keeps working without remote settings", async () => {
    const { writes } = setupWrites();
    const result = await setupGatewayClient(
      parseGatewayCtlConfig(["connect", "codex", "pc1"], {}, "/tmp/nonexistent-home"),
      "connect",
      writes,
    );
    expect(result.exitCode).toBe(0);
    expect(result.payload.recipe?.snippet).toContain("http://127.0.0.1:4000");
  });

  test("connect with partial Access pair fails before mutation", async () => {
    const { writes, getClientsText } = setupWrites();
    const result = await setupGatewayClient(
      parseGatewayCtlConfig(
        ["connect", "curl", "pc1", "--cf-client-id=only-id"],
        {},
        "/tmp/nonexistent-home",
      ),
      "connect",
      writes,
    );
    expect(result.exitCode).toBe(2);
    expect(getClientsText()).toBe("{}");
  });
});
