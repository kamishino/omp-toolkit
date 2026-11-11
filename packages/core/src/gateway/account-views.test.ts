import { describe, expect, test } from "bun:test";
import {
  type AccountView,
  buildAccountViews,
  buildPoolView,
  type PoolEvidence,
} from "./account-views";

const NOW = 1_800_000_000_000;
const EVIDENCE_OK: PoolEvidence = { checks: "ok", usage: "ok", policies: "ok" };

describe("buildAccountViews observations", () => {
  test("credential checks are isolated by provider when ids collide", () => {
    const views = buildAccountViews({
      nowMs: NOW,
      snapshot: [{ id: 1, provider: "google-antigravity", identityKey: "email:a@example.com" }],
      checks: [
        { id: 1, provider: "openai-codex", ok: false },
        { id: 1, provider: "google-antigravity", ok: true },
      ],
      usage: [],
    });
    expect(views[0]?.ok).toBe(true);
  });

  test("checks from another provider alone leave ok unknown", () => {
    const views = buildAccountViews({
      nowMs: NOW,
      snapshot: [{ id: 1, provider: "google-antigravity", identityKey: "email:a@example.com" }],
      checks: [{ id: 1, provider: "openai-codex", ok: false }],
      usage: [],
    });
    expect(views[0]?.ok).toBeNull();
  });

  test("non-boolean check results become unknown", () => {
    const views = buildAccountViews({
      nowMs: NOW,
      snapshot: [{ id: 1, provider: "google-antigravity", identityKey: "email:a@example.com" }],
      checks: [{ id: 1, provider: "google-antigravity" }],
      usage: [],
    });
    expect(views[0]?.ok).toBeNull();
  });

  test("out-of-range and non-finite fractions normalize to null", () => {
    const views = buildAccountViews({
      nowMs: NOW,
      snapshot: [{ id: 1, provider: "google-antigravity", identityKey: "email:a@example.com" }],
      checks: [],
      usage: [
        {
          provider: "google-antigravity",
          metadata: { email: "a@example.com" },
          limits: [
            { id: "neg", amount: { remainingFraction: -0.5 } },
            { id: "over", amount: { remainingFraction: 1.5 } },
            { id: "nan", amount: { remainingFraction: NaN } },
            { id: "inf", amount: { remainingFraction: Number.POSITIVE_INFINITY } },
            { id: "fine", amount: { remainingFraction: 0.25 } },
          ],
        },
      ],
    });
    const fractions = views[0]?.limits.map((l) => l.remainingFraction);
    expect(fractions).toEqual([null, null, null, null, 0.25]);
  });

  test("non-finite reset timestamps normalize to null", () => {
    const views = buildAccountViews({
      nowMs: NOW,
      snapshot: [{ id: 1, provider: "google-antigravity", identityKey: "email:a@example.com" }],
      checks: [],
      usage: [
        {
          provider: "google-antigravity",
          metadata: { email: "a@example.com" },
          limits: [{ id: "l", window: { resetsAt: NaN } }],
        },
      ],
    });
    expect(views[0]?.limits[0]?.resetsAtMs).toBeNull();
  });

  test("expired and non-finite block times do not count as active", () => {
    const views = buildAccountViews({
      nowMs: NOW,
      snapshot: [
        {
          id: 1,
          provider: "google-antigravity",
          identityKey: "email:a@example.com",
          blocks: [
            { providerKey: "google-antigravity:oauth", blockScope: "", blockedUntilMs: NOW - 1 },
            {
              providerKey: "google-antigravity:oauth",
              blockScope: "",
              blockedUntilMs: Number.NaN,
            },
            {
              providerKey: "google-antigravity:oauth",
              blockScope: "counter:gemini",
              blockedUntilMs: Number.POSITIVE_INFINITY,
            },
          ],
        },
      ],
      checks: [],
      usage: [],
    });
    expect(views[0]?.blocked).toBe(false);
    expect(views[0]?.blocks).toEqual([]);
  });

  test("block scope is preserved on active blocks", () => {
    const views = buildAccountViews({
      nowMs: NOW,
      snapshot: [
        {
          id: 1,
          provider: "google-antigravity",
          identityKey: "email:a@example.com",
          blocks: [
            {
              providerKey: "google-antigravity:oauth",
              blockScope: "counter:gemini",
              blockedUntilMs: NOW + 60_000,
            },
          ],
        },
      ],
      checks: [],
      usage: [],
    });
    expect(views[0]?.blocked).toBe(true);
    expect(views[0]?.blocks).toEqual([{ scope: "counter:gemini", blockedUntilMs: NOW + 60_000 }]);
  });
});

describe("buildPoolView observations", () => {
  function drainedViews(): AccountView[] {
    return buildAccountViews({
      nowMs: NOW,
      snapshot: [
        { id: 1, provider: "google-antigravity", identityKey: "email:a@example.com" },
        { id: 2, provider: "google-antigravity", identityKey: "email:b@example.com" },
        { id: 3, provider: "google-antigravity", identityKey: "email:c@example.com" },
      ],
      checks: [],
      usage: [],
      policies: [
        { provider: "google-antigravity", account: { email: "a@example.com" }, reservePct: 100 },
        { provider: "google-antigravity", account: { email: "b@example.com" }, reservePct: 100 },
        { provider: "google-antigravity", account: { email: "c@example.com" }, reservePct: 100 },
      ],
    });
  }

  test("three drained accounts are not three usable accounts", () => {
    const pool = buildPoolView(drainedViews(), EVIDENCE_OK);
    expect(pool.total).toBe(3);
    expect(pool.blocked).toBe(0);
    expect(pool.unblocked).toBe(3);
    expect(pool.drained).toBe(3);
    expect(pool.checkUnknown).toBe(3);
  });

  test("unavailable policy source yields null drained, not zero", () => {
    const pool = buildPoolView(drainedViews(), { ...EVIDENCE_OK, policies: "unavailable" });
    expect(pool.drained).toBeNull();
  });

  test("unavailable sources make unknown counts total and depleted counts null", () => {
    const pool = buildPoolView(drainedViews(), {
      checks: "unavailable",
      usage: "unavailable",
      policies: "unavailable",
    });
    expect(pool.checkFailed).toBeNull();
    expect(pool.checkUnknown).toBe(3);
    expect(pool.quotaDepleted).toBeNull();
    expect(pool.quotaUnknown).toBe(3);
    expect(pool.drained).toBeNull();
  });

  test("quota depletion counts accounts with a reported zero fraction", () => {
    const views = buildAccountViews({
      nowMs: NOW,
      snapshot: [
        { id: 1, provider: "google-antigravity", identityKey: "email:a@example.com" },
        { id: 2, provider: "google-antigravity", identityKey: "email:b@example.com" },
      ],
      checks: [{ id: 1, provider: "google-antigravity", ok: false }],
      usage: [
        {
          provider: "google-antigravity",
          metadata: { email: "a@example.com" },
          limits: [{ id: "l", amount: { remainingFraction: 0 } }],
        },
      ],
    });
    const pool = buildPoolView(views, EVIDENCE_OK);
    expect(pool.quotaDepleted).toBe(1);
    expect(pool.quotaUnknown).toBe(1);
    expect(pool.checkFailed).toBe(1);
    expect(pool.checkUnknown).toBe(1);
  });

  test("empty snapshot is explicitly empty, not an exhausted pool", () => {
    const pool = buildPoolView([], EVIDENCE_OK);
    expect(pool.total).toBe(0);
    expect(pool.unblocked).toBe(0);
    expect(pool.drained).toBe(0);
  });
});
