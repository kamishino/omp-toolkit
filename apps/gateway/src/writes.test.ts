import { describe, expect, test } from "bun:test";
import type { AuditEvent, GatewayAudit } from "./audit";
import type { BrokerClient } from "./broker-client";
import { GatewayWrites, sha256Hex } from "./writes";

const NOW = 1_800_000_000_000;

function harness(
  overrides: {
    failIds?: Set<number>;
    policiesError?: "read" | "write" | null;
    auditError?: boolean;
    snapshotThrows?: boolean;
  } = {},
) {
  const failIds = overrides.failIds ?? new Set<number>();
  const failBroker = (id: number, verb: string): void => {
    if (failIds.has(id)) throw new Error(`${verb} block for credential ${id} failed with HTTP 500`);
  };
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
    getModels: async () => [],
    getSnapshot: async () => {
      if (overrides.snapshotThrows) throw new Error("snapshot down");
      return [
        { id: 1, provider: "google-antigravity", identityKey: "email:alice@example.com" },
        { id: 6, provider: "google-antigravity", identityKey: "email:bob@example.com" },
        { id: 9, provider: "google-antigravity", identityKey: "email:carol@example.com" },
      ];
    },
    getCredentialCheck: async () => [],
    getUsage: async () => [],
    readStickyRows: async () => [],
    tokenPresent: () => true,
    readBrokerToken: () => "tok",
    postBlock: async (id, _pk, _scope, until) => {
      failBroker(id, "POST");
      blocks.push({ id, until });
    },
    deleteBlock: async (id) => {
      failBroker(id, "DELETE");
      const idx = blocks.findIndex((b) => b.id === id);
      if (idx >= 0) blocks.splice(idx, 1);
    },
  };
  const audit: GatewayAudit = {
    record: async (e) => {
      if (overrides.auditError) throw new Error("audit down");
      events.push(e);
    },
    latest: async (kind, account) =>
      [...events]
        .reverse()
        .find((e) => e.kind === kind && (account === undefined || e.account === account)) ?? null,
  };
  const writes = new GatewayWrites({
    client,
    readPoliciesRaw: async () => {
      if (overrides.policiesError === "read") throw new Error("policy read down");
      return policiesRaw;
    },
    writePolicies: async (p) => {
      if (overrides.policiesError === "write") throw new Error("policy write down");
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
    expect(result.outcome).toBe("applied");
    expect(h.blocks.map((b) => b.id)).toEqual([1, 6, 9]);
    expect(result.lines.join("\n")).not.toContain("Exhausted");
    expect((await h.writes.unblockAll()).ok).toBe(true);
    expect(h.blocks).toEqual([]);
  });
});

describe("GatewayWrites explicit outcomes", () => {
  test("drain-all on an empty snapshot is a noop without broker or audit calls", async () => {
    const postBlock = async (): Promise<void> => {
      throw new Error("must not be called");
    };
    const events: AuditEvent[] = [];
    const bare = new GatewayWrites({
      client: {
        brokerHealth: async () => true,
        gatewayHealth: async () => true,
        tunnelHealth: async () => false,
        getModels: async () => [],
        getSnapshot: async () => [],
        getCredentialCheck: async () => [],
        getUsage: async () => [],
        readStickyRows: async () => [],
        tokenPresent: () => true,
        readBrokerToken: () => "tok",
        postBlock,
        deleteBlock: async () => {},
      },
      readPoliciesRaw: async () => "[]",
      writePolicies: async () => {},
      readTextFile: () => "{}",
      writeTextFileAtomic: () => {},
      fileExists: () => true,
      clientsPath: "clients.json",
      provider: "google-antigravity",
      audit: {
        record: async (e: AuditEvent) => {
          events.push(e);
        },
        latest: async () => null,
      },
      now: () => NOW,
    });
    const result = await bare.drainAll(30);
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("noop");
    expect(result.audit).toBe("not-attempted");
    expect(events).toHaveLength(0);
    expect(result.lines.join("\n")).toContain("nothing blocked");
  });

  test("drain-all stops on the first failure and reports progress", async () => {
    const h = harness({ failIds: new Set([6]) });
    const result = await h.writes.drainAll(30);
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("partial");
    expect(result.progress).toEqual({ applied: [1], unconfirmed: [6], notAttempted: [9] });
    expect(h.blocks.map((b) => b.id)).toEqual([1]);
    expect(result.lines.join("\n")).toContain("not attempted");
  });

  test("drain-all with an immediate failure reports failed with the rest untouched", async () => {
    const h = harness({ failIds: new Set([1]) });
    const result = await h.writes.drainAll(30);
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("failed");
    expect(result.progress).toEqual({ applied: [], unconfirmed: [1], notAttempted: [6, 9] });
    expect(h.blocks).toEqual([]);
  });

  test("block validates duration before consulting the snapshot", async () => {
    const h = harness({ snapshotThrows: true });
    const duration = await h.writes.block(1, 1);
    expect(duration.ok).toBe(false);
    expect(duration.outcome).toBe("failed");
    expect(duration.lines.join("\n")).toContain("invalid block duration");
    const lookup = await h.writes.block(1, 60);
    expect(lookup.ok).toBe(false);
    expect(lookup.lines.join("\n")).toContain("account lookup failed");
    expect(h.blocks).toEqual([]);
    expect(h.events).toHaveLength(0);
  });

  test("unknown account performs no broker mutation or audit", async () => {
    const h = harness();
    const result = await h.writes.block(999, 60);
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("failed");
    expect(result.target).toBe("account #999");
    expect(h.blocks).toEqual([]);
    expect(h.events).toHaveLength(0);
  });

  test("policy write failure leaves the file unchanged without success", async () => {
    const h = harness({ policiesError: "write" });
    const before = h.getPoliciesRaw();
    const result = await h.writes.drain(1);
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("failed");
    expect(h.getPoliciesRaw()).toBe(before);
    expect(h.events).toHaveLength(0);
  });

  test("policy read failure fails closed", async () => {
    const h = harness({ policiesError: "read" });
    const result = await h.writes.drain(1);
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("failed");
    expect(h.blocks).toEqual([]);
  });

  test("clients-add with an unknown account cannot mint or persist", async () => {
    const h = harness();
    const result = await h.writes.clientsAdd("laptop", {
      models: null,
      accountIds: [999],
      force: false,
    });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("failed");
    expect(result.clientToken).toBeUndefined();
    expect(h.getClientsText()).toBe("{}");
    expect(h.events).toHaveLength(0);
  });

  test("clients-revoke of a missing client fails without mutation", async () => {
    const h = harness();
    const result = await h.writes.clientsRevoke("ghost");
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("failed");
    expect(h.getClientsText()).toBe("{}");
    expect(h.events).toHaveLength(0);
  });

  test("audit failure after an acknowledged mutation keeps the real token", async () => {
    const h = harness({ auditError: true });
    const added = await h.writes.clientsAdd("laptop", {
      models: null,
      accountIds: [],
      force: false,
    });
    expect(added.ok).toBe(false);
    expect(added.outcome).toBe("applied");
    expect(added.audit).toBe("unavailable");
    expect(added.clientToken).toStartWith("omp_gw_");
    expect(h.getClientsText()).toContain(sha256Hex(added.clientToken ?? ""));
    expect(added.lines.join("\n")).toContain("audit recording failed");

    const blocked = await h.writes.block(1, 60);
    expect(blocked.ok).toBe(false);
    expect(blocked.outcome).toBe("applied");
    expect(blocked.audit).toBe("unavailable");
    expect(h.blocks).toEqual([{ id: 1, until: NOW + 60_000 }]);
  });

  test("repeated drain preserves the original restore point", async () => {
    const h = harness();
    const first = await h.writes.drain(1);
    expect(first.outcome).toBe("applied");
    const second = await h.writes.drain(1);
    expect(second.ok).toBe(true);
    expect(second.outcome).toBe("noop");
    expect(h.events.filter((e) => e.kind === "gateway.drain")).toHaveLength(1);
    expect((await h.writes.undrain(1)).outcome).toBe("applied");
    const policies = JSON.parse(h.getPoliciesRaw()) as { reservePct?: number }[];
    expect(policies[0]?.reservePct).toBe(10);
  });

  test("undrain without history or policy entry is a noop", async () => {
    const h = harness();
    const result = await h.writes.undrain(6);
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("noop");
    expect(h.events).toHaveLength(0);
  });

  test("undrain with an explicit policy but no drain record refuses", async () => {
    const h = harness();
    expect((await h.writes.policySet(6, { reservePct: 50 }, "gateway.policy")).ok).toBe(true);
    const result = await h.writes.undrain(6);
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("failed");
    const policies = JSON.parse(h.getPoliciesRaw()) as { reservePct?: number }[];
    expect(policies.some((p) => p.reservePct === 50)).toBe(true);
  });
});
