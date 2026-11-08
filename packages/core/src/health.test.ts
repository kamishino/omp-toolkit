import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MODEL_WIRE,
  excludedEmails,
  isRetryableRouteFailure,
  mergeHealthResults,
  nextStreaks,
  ROUTE_STALE_MS,
  restorableEmails,
  routeFreshness,
  routeKey,
} from "./health";
import type {
  HealthResult,
  HealthSnapshot,
  HealthState,
  Policy,
  ProbeResult,
  StreakState,
} from "./types";

describe("packages/core/src/health pure domain functions", () => {
  test("routeKey normalizes trimmed email case while preserving project and model", () => {
    const key1 = routeKey({
      provider: "google-antigravity",
      email: "  User@Example.COM  ",
      project: "Proj-Alpha",
      model: "gemini-3.8-flash-high",
    });
    const key2 = routeKey({
      provider: "google-antigravity",
      email: "user@example.com",
      project: "Proj-Alpha",
      model: "gemini-3.8-flash-high",
    });
    expect(key1).toBe(key2);
    expect(key1).toBe(
      JSON.stringify([
        "google-antigravity",
        "user@example.com",
        "Proj-Alpha",
        "gemini-3.8-flash-high",
      ]),
    );

    const differentProject = routeKey({
      provider: "google-antigravity",
      email: "user@example.com",
      project: "proj-alpha",
      model: "gemini-3.8-flash-high",
    });
    expect(key1).not.toBe(differentProject);
  });

  test("routeFreshness classifies fresh, stale, and unknown correctly", () => {
    const now = 1_000_000_000;
    const staleLimit = ROUTE_STALE_MS; // 15 mins = 900,000 ms

    expect(routeFreshness(undefined, now)).toBe("unknown");

    const futureObservation: HealthResult = {
      provider: "google-antigravity",
      email: "u@ex.com",
      project: "p1",
      model: DEFAULT_MODEL_WIRE,
      status: "ok",
      ms: 50,
      startedAt: now + 5000,
      checkedAt: now + 5000,
      failureKind: null,
      confirmed: false,
    };
    expect(routeFreshness(futureObservation, now)).toBe("unknown");

    const freshObservation: HealthResult = {
      provider: "google-antigravity",
      email: "u@ex.com",
      project: "p1",
      model: DEFAULT_MODEL_WIRE,
      status: "ok",
      ms: 50,
      startedAt: now - 60_000,
      checkedAt: now - 60_000,
      failureKind: null,
      confirmed: false,
    };
    expect(routeFreshness(freshObservation, now)).toBe("fresh");

    const staleObservation: HealthResult = {
      provider: "google-antigravity",
      email: "u@ex.com",
      project: "p1",
      model: DEFAULT_MODEL_WIRE,
      status: "hang",
      ms: 15_000,
      startedAt: now - staleLimit - 1000,
      checkedAt: now - staleLimit - 1000,
      failureKind: "timeout",
      confirmed: true,
    };
    expect(routeFreshness(staleObservation, now)).toBe("stale");
  });

  test("isRetryableRouteFailure authorizes only hang/timeout and error/transient", () => {
    const makeResult = (
      status: HealthResult["status"],
      failureKind: HealthResult["failureKind"],
    ): HealthResult => ({
      provider: "google-antigravity",
      email: "u@ex.com",
      project: "p1",
      model: DEFAULT_MODEL_WIRE,
      status,
      ms: 100,
      startedAt: 1000,
      checkedAt: 1100,
      failureKind,
      confirmed: false,
    });

    expect(isRetryableRouteFailure(makeResult("hang", "timeout"))).toBe(true);
    expect(isRetryableRouteFailure(makeResult("error", "transient"))).toBe(true);

    expect(isRetryableRouteFailure(makeResult("ok", null))).toBe(false);
    expect(isRetryableRouteFailure(makeResult("auth", "auth"))).toBe(false);
    expect(isRetryableRouteFailure(makeResult("auth", "credential"))).toBe(false);
    expect(isRetryableRouteFailure(makeResult("model-error", "model"))).toBe(false);
    expect(isRetryableRouteFailure(makeResult("error", "rate-limit"))).toBe(false);
    expect(isRetryableRouteFailure(makeResult("error", "protocol"))).toBe(false);
    expect(isRetryableRouteFailure(makeResult("error", "network"))).toBe(false);
  });

  test("mergeHealthResults accepts only lexicographically newer observations and ignores older ones", () => {
    const initial: HealthResult[] = [
      {
        provider: "google-antigravity",
        email: "alpha@ex.com",
        project: "p1",
        model: DEFAULT_MODEL_WIRE,
        status: "ok",
        ms: 40,
        startedAt: 1000,
        checkedAt: 1040,
        failureKind: null,
        confirmed: false,
      },
    ];

    // Older delayed observation: startedAt 800, checkedAt 900
    const olderProbe: ProbeResult[] = [
      {
        index: 1,
        provider: "google-antigravity",
        email: "alpha@ex.com",
        project: "p1",
        model: DEFAULT_MODEL_WIRE,
        status: "hang",
        ms: 15_000,
        startedAt: 800,
        checkedAt: 900,
        failureKind: "timeout",
        confirmed: true,
      },
    ];

    const afterOlder = mergeHealthResults(initial, olderProbe);
    expect(afterOlder.length).toBe(1);
    expect(afterOlder[0].status).toBe("ok");
    expect(afterOlder[0].startedAt).toBe(1000);

    // Newer observation: startedAt 1200, checkedAt 1250
    const newerProbe: ProbeResult[] = [
      {
        index: 1,
        provider: "google-antigravity",
        email: "alpha@ex.com",
        project: "p1",
        model: DEFAULT_MODEL_WIRE,
        status: "hang",
        ms: 15_000,
        startedAt: 1200,
        checkedAt: 1250,
        failureKind: "timeout",
        confirmed: true,
      },
    ];

    const afterNewer = mergeHealthResults(initial, newerProbe);
    expect(afterNewer.length).toBe(1);
    expect(afterNewer[0].status).toBe("hang");
    expect(afterNewer[0].startedAt).toBe(1200);
  });

  test("nextStreaks requires gapMs spacing, resets on non-OK, restarts if stale, and ignores duplicate/older", () => {
    const initialStreaks: StreakState = {};
    const t0 = 1_000_000;
    const probeOk = (time: number): ProbeResult => ({
      index: 1,
      provider: "google-antigravity",
      email: "user@ex.com",
      project: "p1",
      model: DEFAULT_MODEL_WIRE,
      status: "ok",
      ms: 50,
      startedAt: time - 50,
      checkedAt: time,
      failureKind: null,
      confirmed: false,
    });

    const probeHang = (time: number): ProbeResult => ({
      index: 1,
      provider: "google-antigravity",
      email: "user@ex.com",
      project: "p1",
      model: DEFAULT_MODEL_WIRE,
      status: "hang",
      ms: 15_000,
      startedAt: time - 15000,
      checkedAt: time,
      failureKind: "timeout",
      confirmed: true,
    });

    // 1st healthy check
    const s1 = nextStreaks(initialStreaks, [probeOk(t0)], t0, 60_000, ROUTE_STALE_MS);
    const key = routeKey(probeOk(t0));
    expect(s1[key]).toEqual({ ok: 1, firstAt: t0, lastAt: t0 });

    // Rapid check within gap (30s later) -> streak not incremented
    const s2 = nextStreaks(s1, [probeOk(t0 + 30_000)], t0 + 30_000, 60_000, ROUTE_STALE_MS);
    expect(s2[key].ok).toBe(1);
    expect(s2[key].lastAt).toBe(t0);

    // Properly spaced check (65s later) -> streak increments to 2
    const s3 = nextStreaks(s1, [probeOk(t0 + 65_000)], t0 + 65_000, 60_000, ROUTE_STALE_MS);
    expect(s3[key].ok).toBe(2);
    expect(s3[key].firstAt).toBe(t0);
    expect(s3[key].lastAt).toBe(t0 + 65_000);

    // Duplicate or older check arrives -> ignored, not reset
    const sOlder = nextStreaks(s3, [probeHang(t0 + 10_000)], t0 + 70_000, 60_000, ROUTE_STALE_MS);
    expect(sOlder[key].ok).toBe(2);

    // Non-OK probe resets streak
    const sReset = nextStreaks(s3, [probeHang(t0 + 100_000)], t0 + 100_000, 60_000, ROUTE_STALE_MS);
    expect(sReset[key]).toEqual({ ok: 0, firstAt: 0, lastAt: 0 });

    // Restart at 1 when stale (20 minutes later)
    const sStaleRestart = nextStreaks(
      s3,
      [probeOk(t0 + 20 * 60_000)],
      t0 + 20 * 60_000,
      60_000,
      ROUTE_STALE_MS,
    );
    expect(sStaleRestart[key]).toEqual({
      ok: 1,
      firstAt: t0 + 20 * 60_000,
      lastAt: t0 + 20 * 60_000,
    });
  });

  test("restorableEmails verifies fresh current OK, streak threshold, and rejects project ambiguity or expired streak", () => {
    const now = 2_000_000_000;
    const model = DEFAULT_MODEL_WIRE;

    const state: HealthState = {
      schemaVersion: 2,
      excluded: ["alpha@ex.com", "beta@ex.com", "ambiguous@ex.com"],
      pending: [],
    };

    const keyAlpha = routeKey({
      provider: "google-antigravity",
      email: "alpha@ex.com",
      project: "p1",
      model,
    });
    const keyBeta = routeKey({
      provider: "google-antigravity",
      email: "beta@ex.com",
      project: "p1",
      model,
    });
    const keyAmb1 = routeKey({
      provider: "google-antigravity",
      email: "ambiguous@ex.com",
      project: "proj-1",
      model,
    });

    const streaks: StreakState = {
      [keyAlpha]: { ok: 3, firstAt: now - 180_000, lastAt: now - 10_000 },
      [keyBeta]: { ok: 3, firstAt: now - 3600_000, lastAt: now - 1800_000 }, // Expired streak
      [keyAmb1]: { ok: 3, firstAt: now - 180_000, lastAt: now - 10_000 },
    };

    const snapshot: HealthSnapshot = {
      schemaVersion: 2,
      probeModel: model,
      sweepStartedAt: now - 20_000,
      checkedAt: now - 10_000,
      results: [
        // Alpha: fresh OK
        {
          provider: "google-antigravity",
          email: "alpha@ex.com",
          project: "p1",
          model,
          status: "ok",
          ms: 50,
          startedAt: now - 20_000,
          checkedAt: now - 10_000,
          failureKind: null,
          confirmed: false,
        },
        // Beta: fresh OK, but streak expired
        {
          provider: "google-antigravity",
          email: "beta@ex.com",
          project: "p1",
          model,
          status: "ok",
          ms: 50,
          startedAt: now - 20_000,
          checkedAt: now - 10_000,
          failureKind: null,
          confirmed: false,
        },
        // Ambiguous: two accounts with same email on different projects
        {
          provider: "google-antigravity",
          email: "ambiguous@ex.com",
          project: "proj-1",
          model,
          status: "ok",
          ms: 50,
          startedAt: now - 20_000,
          checkedAt: now - 10_000,
          failureKind: null,
          confirmed: false,
        },
        {
          provider: "google-antigravity",
          email: "ambiguous@ex.com",
          project: "proj-2",
          model,
          status: "ok",
          ms: 50,
          startedAt: now - 20_000,
          checkedAt: now - 10_000,
          failureKind: null,
          confirmed: false,
        },
      ],
      streaks,
    };

    const restorable = restorableEmails(state, streaks, 3, snapshot, model, now);
    expect(restorable).toEqual(["alpha@ex.com"]);
  });

  test("excludedEmails extracts accounts with reservePct >= 100 for Antigravity only", () => {
    const policies: Policy[] = [
      { provider: "google-antigravity", account: { email: "full@ex.com" }, reservePct: 100 },
      { provider: "google-antigravity", account: { email: "partial@ex.com" }, reservePct: 50 },
      { provider: "openai-codex", account: { email: "other@ex.com" }, reservePct: 100 },
    ];
    const emails = excludedEmails(policies);
    expect([...emails]).toEqual(["full@ex.com"]);
  });
});
