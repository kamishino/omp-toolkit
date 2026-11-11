import { describe, expect, test } from "bun:test";
import type { BrokerClient } from "./broker-client";
import {
  getAccountsOutput,
  getClientsOutput,
  renderAccountsText,
  renderClientsText,
  renderPoolText,
  SnapshotUnavailableError,
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

describe("gateway views partial evidence", () => {
  function depsWith(
    overrides: Partial<{
      snapshot: () => Promise<never>;
      checks: () => Promise<never>;
      usage: () => Promise<never>;
      sticky: () => Promise<never>;
      policies: () => Promise<never>;
    }> = {},
  ) {
    const client = fakeClient();
    if (overrides.snapshot) client.getSnapshot = overrides.snapshot as typeof client.getSnapshot;
    if (overrides.checks)
      client.getCredentialCheck = overrides.checks as typeof client.getCredentialCheck;
    if (overrides.usage) client.getUsage = overrides.usage as typeof client.getUsage;
    if (overrides.sticky) client.readStickyRows = overrides.sticky as typeof client.readStickyRows;
    return {
      client,
      readTextFile: () => "{}",
      fileExists: () => false,
      clientsPath: "clients.json",
      provider: "google-antigravity",
      now: () => 1_800_000_000_000,
      ...(overrides.policies ? { getPolicies: overrides.policies } : {}),
    };
  }

  test("snapshot failure rejects instead of an empty-success view", async () => {
    await expect(
      getAccountsOutput(depsWith({ snapshot: async () => Promise.reject(new Error("down")) })),
    ).rejects.toBeInstanceOf(SnapshotUnavailableError);
  });

  test("failed checks keep accounts with unknown ok and a warning", async () => {
    const output = await getAccountsOutput(
      depsWith({ checks: async () => Promise.reject(new Error("down")) }),
    );
    expect(output.accounts).toHaveLength(2);
    expect(output.sources.checks).toBe("unavailable");
    expect(output.pool.checkFailed).toBeNull();
    expect(output.pool.checkUnknown).toBe(2);
    expect(output.warnings).toContain("credential-check unavailable; ok=unknown");
    const text = renderAccountsText(output).join("\n");
    expect(text).toContain("check=unknown");
    expect(text).toContain("warning: credential-check unavailable; ok=unknown");
  });

  test("failed usage keeps identities with unknown quota", async () => {
    const output = await getAccountsOutput(
      depsWith({ usage: async () => Promise.reject(new Error("down")) }),
    );
    expect(output.accounts).toHaveLength(2);
    expect(output.pool.quotaDepleted).toBeNull();
    expect(output.pool.quotaUnknown).toBe(2);
    expect(output.warnings).toContain("usage unavailable; quota=unknown");
  });

  test("missing policies source means drained unknown, not zero", async () => {
    const output = await getAccountsOutput(depsWith());
    expect(output.sources.policies).toBe("unavailable");
    expect(output.pool.drained).toBeNull();
    expect(output.warnings).toContain("policy unavailable; drained=unknown");
  });

  test("failed sticky rows render unavailable instead of silent empty", async () => {
    const output = await getAccountsOutput(
      depsWith({ sticky: async () => Promise.reject(new Error("down")) }),
    );
    expect(output.sources.sticky).toBe("unavailable");
    expect(output.sticky).toEqual([]);
    expect(renderPoolText(output).join("\n")).toContain("pin distribution unavailable");
  });

  test("known empty sticky rows report no active pins", async () => {
    const client = fakeClient();
    client.readStickyRows = async () => [];
    const output = await getAccountsOutput({
      client,
      readTextFile: () => "{}",
      fileExists: () => false,
      clientsPath: "clients.json",
      provider: "google-antigravity",
      now: () => 1_800_000_000_000,
    });
    expect(output.sources.sticky).toBe("ok");
    expect(renderPoolText(output).join("\n")).toContain("no active pins observed");
  });

  test("empty snapshot is labeled empty, not exhausted", async () => {
    const client = fakeClient();
    client.getSnapshot = async () => [];
    const output = await getAccountsOutput({
      client,
      readTextFile: () => "{}",
      fileExists: () => false,
      clientsPath: "clients.json",
      provider: "google-antigravity",
      now: () => 1_800_000_000_000,
    });
    expect(output.pool.total).toBe(0);
    const text = renderAccountsText(output).join("\n");
    expect(text).toContain("pool: empty snapshot (no google-antigravity credentials)");
    expect(text).not.toContain("Exhausted");
    expect(text).not.toContain("available=");
  });

  test("pool text never claims usable availability", async () => {
    const output = await getAccountsOutput(depsWith());
    const text = renderPoolText(output).join("\n");
    expect(text).not.toContain("available=");
    expect(text).not.toContain("Exhausted");
    expect(text).toContain("unblocked=");
  });
});
