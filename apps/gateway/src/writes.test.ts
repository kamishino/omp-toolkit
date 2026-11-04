import { describe, expect, test } from "bun:test";
import type { AuditEvent, GatewayAudit } from "./audit";
import type { BrokerClient } from "./broker-client";
import { GatewayWrites, sha256Hex } from "./writes";

const NOW = 1_800_000_000_000;

function harness() {
  const blocks: { id: number; until: number }[] = [];
  let clientsText = "{}";
  let policiesRaw = JSON.stringify([
    {
      provider: "google-antigravity",
      account: { email: "alice@example.com" },
      reservePct: 10,
      priority: 2,
    },
  ]);
  const events: AuditEvent[] = [];
  const client: BrokerClient = {
    brokerHealth: async () => true,
    gatewayHealth: async () => true,
    tunnelHealth: async () => false,
    getSnapshot: async () => [
      { id: 1, provider: "google-antigravity", identityKey: "email:alice@example.com" },
      { id: 6, provider: "google-antigravity", identityKey: "email:bob@example.com" },
    ],
    getCredentialCheck: async () => [],
    getUsage: async () => [],
    readStickyRows: async () => [],
    tokenPresent: () => true,
    readBrokerToken: () => "tok",
    postBlock: async (id, _pk, _scope, until) => {
      blocks.push({ id, until });
    },
    deleteBlock: async (id) => {
      const idx = blocks.findIndex((b) => b.id === id);
      if (idx >= 0) blocks.splice(idx, 1);
    },
  };
  const audit: GatewayAudit = {
    record: async (e) => {
      events.push(e);
    },
    latest: async (kind, account) =>
      [...events]
        .reverse()
        .find((e) => e.kind === kind && (account === undefined || e.account === account)) ?? null,
  };
  const writes = new GatewayWrites({
    client,
    readPoliciesRaw: async () => policiesRaw,
    writePolicies: async (p) => {
      policiesRaw = JSON.stringify(p);
    },
    readTextFile: () => clientsText,
    writeTextFileAtomic: (_p, text) => {
      clientsText = text;
    },
    fileExists: () => true,
    clientsPath: "clients.json",
    provider: "google-antigravity",
    audit,
    now: () => NOW,
    randomHex: (n) => "ab".repeat(n),
  });
  return {
    writes,
    blocks,
    events,
    getClientsText: () => clientsText,
    getPoliciesRaw: () => policiesRaw,
  };
}

describe("GatewayWrites", () => {
  test("clients-add mints a token, stores only its digest, revoke removes it", async () => {
    const h = harness();
    const added = await h.writes.clientsAdd("laptop", {
      models: ["google-antigravity/*"],
      accountIds: [1],
      force: false,
    });
    expect(added.ok).toBe(true);
    expect(added.clientToken).toStartWith("omp_gw_");
    expect(h.getClientsText()).toContain(sha256Hex(added.clientToken ?? ""));
    expect(h.getClientsText()).not.toContain(added.clientToken ?? "never");
    expect(JSON.stringify(h.events)).not.toContain(added.clientToken ?? "never");
    const revoked = await h.writes.clientsRevoke("laptop");
    expect(revoked.ok).toBe(true);
    expect(h.getClientsText()).not.toContain("laptop");
  });

  test("block validates duration and account, audits the action", async () => {
    const h = harness();
    expect((await h.writes.block(1, 1)).ok).toBe(false);
    expect((await h.writes.block(999, 60)).ok).toBe(false);
    const blocked = await h.writes.block(1, 60);
    expect(blocked.ok).toBe(true);
    expect(h.blocks).toEqual([{ id: 1, until: NOW + 60_000 }]);
    expect(h.events.at(-1)).toMatchObject({ kind: "gateway.block", account: "id:1" });
    expect((await h.writes.unblock(1)).ok).toBe(true);
    expect(h.blocks).toEqual([]);
  });

  test("drain sets reservePct=100 and undrain restores the audited prior", async () => {
    const h = harness();
    expect((await h.writes.drain(1)).ok).toBe(true);
    let policies = JSON.parse(h.getPoliciesRaw()) as { reservePct?: number; priority?: number }[];
    expect(policies[0]?.reservePct).toBe(100);
    expect(policies[0]?.priority).toBe(2);
    expect((await h.writes.undrain(1)).ok).toBe(true);
    policies = JSON.parse(h.getPoliciesRaw()) as { reservePct?: number; priority?: number }[];
    expect(policies[0]?.reservePct).toBe(10);
    expect(policies[0]?.priority).toBe(2);
    expect(JSON.stringify(h.events)).not.toContain("alice@example.com");
  });

  test("drain-all blocks every account with one expiry", async () => {
    const h = harness();
    const result = await h.writes.drainAll(30);
    expect(result.ok).toBe(true);
    expect(h.blocks.map((b) => b.id)).toEqual([1, 6]);
    expect(result.lines.join("\n")).toContain("Exhausted");
    expect((await h.writes.unblockAll()).ok).toBe(true);
    expect(h.blocks).toEqual([]);
  });
});
