import { describe, expect, test } from "bun:test";
import {
  buildAccountViews,
  buildPoolView,
  computeBlockedUntil,
  type DoctorFacts,
  earliestResetMs,
  evaluateDoctorChecks,
  maskIdentityKey,
  parseClientsFile,
  parseOmpVersion,
  removeAccountPolicy,
  removeClientEntry,
  summarizeSticky,
  upsertAccountPolicy,
  upsertClientEntry,
  versionAtLeast,
} from "./control";

const HEALTHY: DoctorFacts = {
  ompPath: "C:/omp/omp.exe",
  versionText: "omp/18.16.0",
  brokerHelp: "auth-broker (serve|token|login|logout|import|migrate|status|list)",
  gatewayHelp: "auth-gateway (serve|stdio|token|status|check) --clients=<value> --bind=<value>",
  brokerTokenPresent: true,
  gatewayTokenPresent: true,
  brokerHealth: "ok",
  gatewayHealth: "ok",
  gatewayArgv:
    '"omp.exe" auth-gateway serve --bind=127.0.0.1:4000 --clients=C:/Users/x/.omp/gateway-clients.json',
  expectedGatewayBind: "127.0.0.1:4000",
  expectedClientsPath: "C:/Users/x/.omp/gateway-clients.json",
  requireRunning: true,
  tunnelRequested: false,
  cloudflaredPath: null,
  tunnelConfigPath: "C:/Users/x/.omp/cloudflared/config.yml",
  tunnelConfigPresent: false,
  tunnelHealth: "down",
};

describe("omp version parsing", () => {
  test("parses omp/x.y.z output", () => {
    expect(parseOmpVersion("omp/18.16.0")).toEqual([18, 16, 0]);
    expect(parseOmpVersion("garbage")).toBeNull();
  });
  test("compares against the verified floor", () => {
    expect(versionAtLeast([18, 16, 0], [18, 16, 0])).toBe(true);
    expect(versionAtLeast([18, 15, 9], [18, 16, 0])).toBe(false);
    expect(versionAtLeast([19, 0, 0], [18, 16, 0])).toBe(true);
  });
});

describe("evaluateDoctorChecks", () => {
  test("healthy deployment has no failing checks", () => {
    const checks = evaluateDoctorChecks(HEALTHY);
    expect(checks.filter((c) => c.status === "fail")).toEqual([]);
  });
  test("missing binary fails closed", () => {
    const checks = evaluateDoctorChecks({ ...HEALTHY, ompPath: null, versionText: null });
    expect(checks.find((c) => c.id === "omp-binary")?.status).toBe("fail");
  });
  test("old version fails", () => {
    const checks = evaluateDoctorChecks({ ...HEALTHY, versionText: "omp/17.0.0" });
    expect(checks.find((c) => c.id === "omp-version")?.status).toBe("fail");
  });
  test("gateway without --clients support fails", () => {
    const checks = evaluateDoctorChecks({ ...HEALTHY, gatewayHelp: "auth-gateway serve" });
    expect(checks.find((c) => c.id === "gateway-capabilities")?.status).toBe("fail");
  });
  test("running gateway argv without --clients is drift and fails", () => {
    const checks = evaluateDoctorChecks({
      ...HEALTHY,
      gatewayArgv: '"omp.exe" auth-gateway serve --bind=127.0.0.1:4000 --trust-proxy-headers',
    });
    expect(checks.find((c) => c.id === "gateway-argv")?.status).toBe("fail");
  });
  test("not running is a warning when running is not required", () => {
    const checks = evaluateDoctorChecks({
      ...HEALTHY,
      brokerHealth: "down",
      gatewayHealth: "down",
      gatewayArgv: null,
      requireRunning: false,
    });
    expect(checks.find((c) => c.id === "broker-health")?.status).toBe("warn");
    expect(checks.filter((c) => c.status === "fail")).toEqual([]);
  });
  test("tunnel not requested is a single passing check", () => {
    const checks = evaluateDoctorChecks(HEALTHY);
    expect(checks.find((c) => c.id === "tunnel")?.status).toBe("pass");
    expect(checks.find((c) => c.id === "tunnel-binary")).toBeUndefined();
  });
  test("requested tunnel without cloudflared fails closed", () => {
    const checks = evaluateDoctorChecks({ ...HEALTHY, tunnelRequested: true });
    expect(checks.find((c) => c.id === "tunnel-binary")?.status).toBe("fail");
    expect(checks.find((c) => c.id === "tunnel-config")?.status).toBe("fail");
  });
  test("requested tunnel without config fails the config check only", () => {
    const checks = evaluateDoctorChecks({
      ...HEALTHY,
      tunnelRequested: true,
      cloudflaredPath: "C:/Program Files (x86)/cloudflared/cloudflared.exe",
      requireRunning: false,
    });
    expect(checks.find((c) => c.id === "tunnel-binary")?.status).toBe("pass");
    expect(checks.find((c) => c.id === "tunnel-config")?.status).toBe("fail");
    expect(checks.find((c) => c.id === "tunnel-health")?.status).toBe("warn");
  });
});

describe("identity masking", () => {
  test("masks email identity keys", () => {
    expect(maskIdentityKey("email:alice@example.com")).toBe("email:a***@e***.com");
    expect(maskIdentityKey("alice@example.com")).toBe("a***@e***.com");
  });
  test("truncates non-email identity keys", () => {
    expect(maskIdentityKey("project:witty-period-4kks4")).toBe("project:wit***");
  });
});

const NOW = 1_800_000_000_000;

describe("buildAccountViews + pool", () => {
  const views = buildAccountViews({
    nowMs: NOW,
    snapshot: [
      {
        id: 1,
        provider: "google-antigravity",
        identityKey: "email:alice@example.com",
        blocks: [
          { providerKey: "google-antigravity:oauth", blockScope: "", blockedUntilMs: NOW + 60_000 },
        ],
      },
      {
        id: 2,
        provider: "google-antigravity",
        identityKey: "email:bob@example.com",
        blocks: [
          {
            providerKey: "google-antigravity:oauth",
            blockScope: "counter:gemini",
            blockedUntilMs: NOW - 1,
          },
        ],
      },
      { id: 3, provider: "openai-codex", identityKey: "email:carol@example.com" },
    ],
    checks: [
      { id: 1, provider: "google-antigravity", ok: true },
      { id: 2, provider: "google-antigravity", ok: true },
    ],
    usage: [
      {
        provider: "google-antigravity",
        metadata: { email: "bob@example.com" },
        limits: [
          {
            id: "l1",
            label: "Gemini",
            status: "ok",
            amount: { remainingFraction: 0 },
            window: { label: "Weekly", resetsAt: NOW + 5_000 },
          },
        ],
      },
    ],
  });

  test("filters to antigravity and joins check + usage", () => {
    expect(views.map((v) => v.id)).toEqual([1, 2]);
    expect(views[0]?.identityMasked).toBe("email:a***@e***.com");
    expect(views[0]?.ok).toBe(true);
    expect(views[0]?.blocked).toBe(true);
    expect(views[1]?.blocked).toBe(false); // expired block does not count
    expect(views[1]?.limits[0]?.remainingFraction).toBe(0);
  });

  test("earliest reset spans active blocks and depleted windows", () => {
    expect(earliestResetMs(views)).toBe(NOW + 5_000);
  });

  test("pool is exhausted only when every account is blocked", () => {
    const pool = buildPoolView(views);
    expect(pool.total).toBe(2);
    expect(pool.blocked).toBe(1);
    expect(pool.exhausted).toBe(false);
    const allBlocked = buildPoolView(views.map((v) => ({ ...v, blocked: true })));
    expect(allBlocked.exhausted).toBe(true);
  });

  test("view JSON never contains a full email", () => {
    expect(JSON.stringify(views)).not.toContain("alice@example.com");
    expect(JSON.stringify(views)).not.toContain("bob@example.com");
  });
});

describe("parseClientsFile", () => {
  test("parses a valid map and fingerprints digests only", () => {
    const digest = "a".repeat(64);
    const parsed = parseClientsFile(
      JSON.stringify({ laptop: { tokenSha256: digest, models: ["google-antigravity/*"] } }),
    );
    expect(parsed.error).toBeNull();
    expect(parsed.clients[0]?.name).toBe("laptop");
    expect(parsed.clients[0]?.tokenFingerprint).toBe("aaaaaaaa");
    expect(JSON.stringify(parsed.clients)).not.toContain(digest);
  });
  test("accepts a BOM-prefixed file (PowerShell Set-Content output)", () => {
    const parsed = parseClientsFile("\uFEFF{}");
    expect(parsed.error).toBeNull();
    expect(parsed.clients).toEqual([]);
  });
  test("fails closed on invalid JSON and bad digests", () => {
    expect(parseClientsFile("not json").error).toBeString();
    expect(parseClientsFile(JSON.stringify({ x: { tokenSha256: "short" } })).error).toBeString();
  });
});

describe("clients file writes", () => {
  const digestA = "a".repeat(64);
  const digestB = "b".repeat(64);
  test("upserts and removes entries, preserving siblings", () => {
    const added = upsertClientEntry("{}", "laptop", {
      tokenSha256: digestA,
      models: ["google-antigravity/*"],
    });
    expect(added.error).toBeNull();
    const added2 = upsertClientEntry(added.text, "desktop", { tokenSha256: digestB });
    expect(added2.error).toBeNull();
    expect(parseClientsFile(added2.text).clients.map((c) => c.name)).toEqual(["desktop", "laptop"]);
    const dup = upsertClientEntry(added2.text, "laptop", { tokenSha256: digestB });
    expect(dup.error).toBeString();
    const removed = removeClientEntry(added2.text, "laptop");
    expect(removed.error).toBeNull();
    expect(parseClientsFile(removed.text).clients.map((c) => c.name)).toEqual(["desktop"]);
    expect(removeClientEntry(removed.text, "laptop").error).toBeString();
  });
  test("rejects invalid digests and corrupted existing files", () => {
    expect(upsertClientEntry("{}", "x", { tokenSha256: "nope" }).error).toBeString();
    expect(upsertClientEntry("not json", "x", { tokenSha256: digestA }).error).toBeString();
  });
});

describe("account policies", () => {
  const base = [
    { provider: "google-antigravity", account: { email: "alice@example.com" }, reservePct: 10 },
    { provider: "google-antigravity", account: { email: "bob@example.com" }, priority: 3 },
  ];
  test("drain upserts reservePct=100 and reports the prior entry", () => {
    const { policies, prior } = upsertAccountPolicy(base, {
      provider: "google-antigravity",
      email: "alice@example.com",
      reservePct: 100,
    });
    expect(prior?.reservePct).toBe(10);
    expect(policies).toHaveLength(2);
    expect(policies.find((p) => p.account?.email === "alice@example.com")?.reservePct).toBe(100);
    expect(policies.find((p) => p.account?.email === "bob@example.com")?.priority).toBe(3);
  });
  test("creates and removes entries case-insensitively", () => {
    const { policies, prior } = upsertAccountPolicy(base, {
      provider: "google-antigravity",
      email: "Carol@Example.com",
      priority: 1,
    });
    expect(prior).toBeNull();
    expect(policies).toHaveLength(3);
    const removed = removeAccountPolicy(policies, "google-antigravity", "carol@example.com");
    expect(removed).toHaveLength(2);
  });
  test("account view exposes policy and drained state", () => {
    const views = buildAccountViews({
      nowMs: NOW,
      snapshot: [{ id: 1, provider: "google-antigravity", identityKey: "email:alice@example.com" }],
      checks: [],
      usage: [],
      policies: [
        {
          provider: "google-antigravity",
          account: { email: "alice@example.com" },
          reservePct: 100,
          priority: 2,
        },
      ],
    });
    expect(views[0]?.policy).toEqual({ priority: 2, reservePct: 100, drained: true });
  });
});

describe("computeBlockedUntil", () => {
  test("bounds durations and computes expiry", () => {
    expect(computeBlockedUntil(NOW, 60)).toBe(NOW + 60_000);
    expect(computeBlockedUntil(NOW, 1)).toBeNull();
    expect(computeBlockedUntil(NOW, 90_000)).toBeNull();
  });
});

describe("summarizeSticky", () => {
  test("counts pins per credential id without leaking session ids", () => {
    const rows = [
      { key: "session:sticky:google-antigravity:secret-session-1", value: "15" },
      { key: "session:sticky:google-antigravity:secret-session-2", value: '{"id":15}' },
      { key: "session:sticky:google-antigravity:secret-session-3", value: '{"id":8}' },
      { key: "session:sticky:openai-codex:secret-session-4", value: "3" },
    ];
    const summary = summarizeSticky(rows, "google-antigravity");
    expect(summary).toEqual([
      { credentialId: 15, sessions: 2 },
      { credentialId: 8, sessions: 1 },
    ]);
    expect(JSON.stringify(summary)).not.toContain("secret-session");
  });
});
