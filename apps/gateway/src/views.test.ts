import { describe, expect, test } from "bun:test";
import type { BrokerClient } from "./broker-client";
import {
  getAccountsOutput,
  getClientsOutput,
  renderAccountsText,
  renderClientsText,
} from "./views";

function fakeClient(): BrokerClient {
  return {
    brokerHealth: async () => true,
    gatewayHealth: async () => true,
    tunnelHealth: async () => false,
    getModels: async () => [],
    getSnapshot: async () => [
      { id: 1, provider: "google-antigravity", identityKey: "email:alice@example.com", blocks: [] },
      { id: 2, provider: "google-antigravity", identityKey: "email:bob@example.com", blocks: [] },
    ],
    getCredentialCheck: async () => [
      { id: 1, provider: "google-antigravity", ok: true },
      { id: 2, provider: "google-antigravity", ok: false },
    ],
    getUsage: async () => [],
    readStickyRows: async () => [
      { key: "session:sticky:google-antigravity:s1", value: "1" },
      { key: "session:sticky:google-antigravity:s2", value: "1" },
    ],
    tokenPresent: () => true,
    readBrokerToken: () => "tok",
    postBlock: async () => {},
    deleteBlock: async () => {},
  };
}

describe("gateway views", () => {
  test("accounts output masks identities and aggregates the pool", async () => {
    const output = await getAccountsOutput({
      client: fakeClient(),
      readTextFile: () => "{}",
      fileExists: () => false,
      clientsPath: "clients.json",
      provider: "google-antigravity",
      now: () => 1_800_000_000_000,
    });
    expect(output.accounts).toHaveLength(2);
    expect(output.pool.total).toBe(2);
    expect(output.sticky).toEqual([{ credentialId: 1, sessions: 2 }]);
    const text = renderAccountsText(output).join("\n");
    expect(text).toContain("a***@e***.com");
    expect(text).not.toContain("alice@example.com");
    expect(text).not.toContain("bob@example.com");
    expect(text).not.toContain("tok");
  });

  test("clients output reports the empty state cleanly", () => {
    const result = getClientsOutput({
      client: fakeClient(),
      readTextFile: () => "{}",
      fileExists: () => false,
      clientsPath: "clients.json",
      provider: "google-antigravity",
    });
    expect(result.clients).toEqual([]);
    expect(renderClientsText(result.clients)).toEqual(["no scoped gateway clients configured"]);
  });
});
