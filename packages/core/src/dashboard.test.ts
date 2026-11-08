import { describe, expect, test } from "bun:test";
import {
  assembleDashboard,
  buildDashboard,
  DashboardEngine,
  isDashboard,
  isLowBalance,
  routeFor,
  summaryText,
  usageLevel,
} from "./dashboard/index";
import type { HealthResult, HealthSnapshot, UsageReport } from "./types";
import { sectionsFor } from "./usage";

const thresholds = { warm: 0.4, hot: 0.7, critical: 0.85, above: 0.8 };

describe("usageLevel and routeFor", () => {
  test("classifies usage levels according to thresholds", () => {
    expect(usageLevel(undefined, thresholds)).toBe("unknown");
    expect(usageLevel(0.1, thresholds)).toBe("ok");
    expect(usageLevel(0.39, thresholds)).toBe("ok");
    expect(usageLevel(0.4, thresholds)).toBe("warn");
    expect(usageLevel(0.69, thresholds)).toBe("warn");
    expect(usageLevel(0.7, thresholds)).toBe("hot");
    expect(usageLevel(0.849, thresholds)).toBe("hot");
    expect(usageLevel(0.85, thresholds)).toBe("critical");
    expect(usageLevel(1.0, thresholds)).toBe("critical");
  });

  test("maps route health status to tag and usage level", () => {
    const now = 20_000_000;
    const base = {
      provider: "google-antigravity" as const,
      project: "p1",
      model: "gemini-3.8-flash-high",
      startedAt: now - 100,
      checkedAt: now,
      confirmed: false,
    };
    expect(routeFor(undefined, now)).toEqual({
      text: "—",
      level: "unknown",
      model: null,
      checkedAt: null,
      lastStatus: null,
      detail: null,
    });
    expect(
      routeFor({ ...base, email: "a@x.com", status: "ok", ms: 100, failureKind: null }, now),
    ).toEqual({
      text: "OK",
      level: "ok",
      model: "gemini-3.8-flash-high",
      checkedAt: now,
      lastStatus: "ok",
      detail: null,
    });
    expect(
      routeFor(
        {
          ...base,
          email: "b@x.com",
          status: "hang",
          ms: 15000,
          failureKind: "timeout",
          confirmed: true,
        },
        now,
      ),
    ).toEqual({
      text: "HANG",
      level: "critical",
      model: "gemini-3.8-flash-high",
      checkedAt: now,
      lastStatus: "hang",
      detail: null,
    });
    expect(
      routeFor(
        { ...base, email: "c@x.com", status: "error", ms: 200, failureKind: "transient" },
        now,
      ),
    ).toEqual({
      text: "ERR",
      level: "critical",
      model: "gemini-3.8-flash-high",
      checkedAt: now,
      lastStatus: "error",
      detail: null,
    });
    expect(
      routeFor({ ...base, email: "d@x.com", status: "auth", ms: 50, failureKind: "auth" }, now),
    ).toEqual({
      text: "AUTH",
      level: "warn",
      model: "gemini-3.8-flash-high",
      checkedAt: now,
      lastStatus: "auth",
      detail: null,
    });
    expect(
      routeFor(
        { ...base, email: "e@x.com", status: "model-error", ms: 80, failureKind: "model" },
        now,
      ),
    ).toEqual({
      text: "MODEL",
      level: "warn",
      model: "gemini-3.8-flash-high",
      checkedAt: now,
      lastStatus: "model-error",
      detail: null,
    });
    // Stale (> 15 minutes)
    expect(
      routeFor(
        {
          ...base,
          email: "s@x.com",
          status: "ok",
          ms: 100,
          checkedAt: now - 20 * 60_000,
          failureKind: null,
        },
        now,
      ),
    ).toEqual({
      text: "STALE",
      level: "unknown",
      model: "gemini-3.8-flash-high",
      checkedAt: now - 20 * 60_000,
      lastStatus: "ok",
      detail: null,
    });
  });
});

describe("isLowBalance", () => {
  test("identifies low balances accurately", () => {
    const alert = { cny: 10, usd: 5 };
    expect(isLowBalance(undefined, alert)).toBe(false);
    expect(
      isLowBalance({ id: "deepseek:granted", amount: { remaining: 1, unit: "cny" } }, alert),
    ).toBe(false);
    expect(
      isLowBalance({ id: "deepseek:balance", amount: { remaining: 10, unit: "cny" } }, alert),
    ).toBe(true);
    expect(
      isLowBalance({ id: "deepseek:balance", amount: { remaining: 10.01, unit: "cny" } }, alert),
    ).toBe(false);
    expect(
      isLowBalance({ id: "deepseek:balance", amount: { remaining: 5, unit: "usd" } }, alert),
    ).toBe(true);
    expect(
      isLowBalance({ id: "deepseek:balance", amount: { remaining: 5.5, unit: "usd" } }, alert),
    ).toBe(false);
  });
});

describe("buildDashboard", () => {
  const reports: UsageReport[] = [
    {
      provider: "google-antigravity",
      metadata: { email: "alpha@example.com" },
      limits: [
        {
          id: "gemini-weekly",
          label: "Gemini",
          window: { label: "Weekly", resetsAt: 2000 },
          amount: { usedFraction: 0.85 },
        },
      ],
    },
    {
      provider: "google-antigravity",
      metadata: { email: "bravo@example.com" },
      limits: [
        {
          id: "gemini-weekly",
          label: "Gemini",
          window: { label: "Weekly", resetsAt: 3000 },
          amount: { usedFraction: 0.1 },
        },
      ],
    },
    {
      provider: "deepseek",
      metadata: {
        email: "key@example.com",
        balance: { currency: "CNY", total: 8, granted: 0, toppedUp: 8 },
      },
      limits: [
        {
          id: "deepseek:balance",
          label: "Balance",
          amount: { remaining: 8, unit: "cny" },
        },
      ],
    },
  ];

  const health = new Map<string, HealthResult>([
    [
      "bravo@example.com",
      {
        provider: "google-antigravity",
        email: "bravo@example.com",
        project: "p1",
        model: "gemini-3.8-flash-high",
        status: "hang",
        ms: 15_000,
        startedAt: 1_700_000_000_000 - 15000,
        checkedAt: 1_700_000_000_000 - 5000,
        failureKind: "timeout",
        confirmed: true,
      },
    ],
  ]);

  test("constructs dashboard with provider suffix, rows, levels, and tooltip", () => {
    const sections = sectionsFor(reports, health);
    const now = 1_700_000_000_000;
    const dashboard = buildDashboard(sections, {
      fetchedAt: now,
      now,
      showHealth: true,
      checkedAt: now - 5000,
      thresholds,
      staleMinutes: 15,
      balanceAlert: { cny: 10, usd: 10 },
    });

    expect(dashboard.fetchedAt).toBe(now);
    expect(dashboard.providers.length).toBe(2);

    const ag = dashboard.providers.find((p) => p.id === "google-antigravity");
    expect(ag).toBeDefined();
    expect(ag?.name).toBe("GOOGLE ANTIGRAVITY");
    expect(ag?.suffix).toBe(" · Gemini");
    expect(ag?.accounts).toBe(2);
    expect(ag?.rows.length).toBe(2);

    const bravoRow = ag?.rows.find((r) => r.displayAccount === "bravo");
    expect(bravoRow?.route.text).toBe("HANG");
    expect(bravoRow?.route.level).toBe("critical");
    expect(bravoRow?.health).toBe("hang");

    const alphaRow = ag?.rows.find((r) => r.displayAccount === "alpha");
    expect(alphaRow?.level).toBe("critical");
    expect(alphaRow?.limits[0].level).toBe("critical");

    const ds = dashboard.providers.find((p) => p.id === "deepseek");
    expect(ds?.suffix).toBe(" · CNY");
    expect(ds?.rows[0].limits[0].low).toBe(true);
    expect(ds?.rows[0].limits[0].level).toBe("critical");
    expect(ds?.timeWindow).toBeDefined();
    expect(typeof ds?.timeWindow?.isPeak).toBe("boolean");
    expect(ds?.timeWindow?.provider).toBe("deepseek");
    expect(ds?.timeWindow?.badgeText).toContain(ds?.timeWindow?.isPeak ? "PEAK" : "OFF-PEAK");
    expect(dashboard.summary.providers).toBe(2);
    expect(dashboard.summary.accounts).toBe(3);
    expect(dashboard.summary.above80).toBe(1);
    expect(dashboard.summary.maxed).toBe(0);
    expect(dashboard.summary.tightest).toEqual({
      provider: "antigravity",
      account: "alpha",
      usedFraction: 0.85,
    });

    expect(dashboard.health).toEqual({
      checkedAt: now - 5000,
      ageMs: 5000,
      stale: false,
      incident: null,
    });

    expect(dashboard.balance).toEqual({
      unit: "cny",
      remaining: 8,
      low: true,
    });

    expect(dashboard.iconLevel).toBe("critical");
    expect(dashboard.tooltip).toContain("alpha 85%");
    expect(dashboard.tooltip).toContain("1 HANG");
    expect(dashboard.tooltip).toContain("¥8.00");
    expect(dashboard.tooltip).toMatch(/(Off-Peak|Peak)/);
    expect(summaryText(dashboard.summary)).toBe(
      "2 providers · 3 accounts · 1 ≥80% · 0 maxed · tightest antigravity:alpha 85%",
    );

    expect(isDashboard(dashboard)).toBe(true);
  });

  test("handles empty rows and omitted health gracefully", () => {
    const dashboard = buildDashboard([], {
      fetchedAt: 100,
      now: 100,
      showHealth: false,
      thresholds,
      staleMinutes: 15,
      balanceAlert: { cny: 10, usd: 10 },
    });

    expect(dashboard.providers).toEqual([]);
    expect(dashboard.iconLevel).toBe("unknown");
    expect(dashboard.health).toBeNull();
    expect(dashboard.balance).toBeNull();
    expect(dashboard.tooltip).toBe("OMP: no usage data");
    expect(summaryText(dashboard.summary)).toBe(
      "0 providers · 0 accounts · 0 ≥80% · 0 maxed · no usage data",
    );
    expect(isDashboard(dashboard)).toBe(true);
  });
});
describe("assembleDashboard high-leverage entry point", () => {
  test("assembles dashboard in one call with defaults", () => {
    const reports: UsageReport[] = [
      {
        provider: "google-antigravity",
        metadata: { email: "user@example.com" },
        limits: [
          {
            id: "gemini-weekly",
            label: "Gemini",
            amount: { usedFraction: 0.3 },
            window: { resetsAt: Date.now() + 1000 },
          },
        ],
      },
    ];
    const snapshot: HealthSnapshot = {
      schemaVersion: 2,
      probeModel: "gemini-3.8-flash-high",
      sweepStartedAt: null,
      checkedAt: Date.now() - 5000,
      results: [
        {
          provider: "google-antigravity",
          email: "user@example.com",
          project: "p1",
          model: "gemini-3.8-flash-high",
          status: "ok",
          ms: 80,
          startedAt: Date.now() - 5080,
          checkedAt: Date.now() - 5000,
          failureKind: null,
          confirmed: false,
        },
      ],
      streaks: {},
    };

    const dashboard = assembleDashboard(reports, snapshot);
    expect(dashboard.providers.length).toBe(1);
    expect(dashboard.providers[0].name).toBe("GOOGLE ANTIGRAVITY");
    expect(dashboard.providers[0].rows[0].health).toBe("ok");
    expect(dashboard.providers[0].rows[0].route.text).toBe("OK");
    expect(dashboard.health?.checkedAt).toBe(snapshot.checkedAt);
    expect(dashboard.iconLevel).toBe("ok");
    expect(isDashboard(dashboard)).toBe(true);
  });
  test("propagates snapshot incident to dashboard.health.incident or sets null", () => {
    const reports: UsageReport[] = [
      {
        provider: "google-antigravity",
        metadata: { email: "user@example.com" },
        limits: [{ id: "l1", label: "Gemini", amount: { usedFraction: 0.1 } }],
      },
    ];
    const snapshotWithIncident: HealthSnapshot = {
      schemaVersion: 2,
      probeModel: "gemini-3.8-flash-high",
      sweepStartedAt: null,
      checkedAt: 1_700_000_000_000,
      results: [
        {
          provider: "google-antigravity",
          email: "user@example.com",
          project: "p1",
          model: "gemini-3.8-flash-high",
          status: "hang",
          ms: 12000,
          startedAt: 1_700_000_000_000 - 12000,
          checkedAt: 1_700_000_000_000,
          failureKind: "timeout",
          confirmed: true,
        },
      ],
      streaks: {},
      incident: {
        id: "inc-99",
        at: 1_700_000_000_000,
        kind: "all-failed",
        detail: "hang detected",
      },
    };

    const withInc = assembleDashboard(reports, snapshotWithIncident);
    expect(withInc.health?.incident).toEqual(snapshotWithIncident.incident);
    expect(isDashboard(withInc)).toBe(true);

    const snapshotWithout: HealthSnapshot = {
      schemaVersion: 2,
      probeModel: "gemini-3.8-flash-high",
      sweepStartedAt: null,
      checkedAt: 1_700_000_000_000,
      results: [
        {
          provider: "google-antigravity",
          email: "user@example.com",
          project: "p1",
          model: "gemini-3.8-flash-high",
          status: "ok",
          ms: 50,
          startedAt: 1_700_000_000_000 - 50,
          checkedAt: 1_700_000_000_000,
          failureKind: null,
          confirmed: false,
        },
      ],
      streaks: {},
    };
    const withoutInc = assembleDashboard(reports, snapshotWithout);
    expect(withoutInc.health?.incident).toBeNull();
    expect(isDashboard(withoutInc)).toBe(true);
  });
});

describe("DashboardEngine unified domain engine", () => {
  test("compiles dashboard via static method with snapshot and options", () => {
    const reports: UsageReport[] = [
      {
        provider: "google-antigravity",
        metadata: { email: "alice@example.com" },
        limits: [{ id: "l1", label: "Gemini", amount: { usedFraction: 0.2 } }],
      },
    ];
    const snapshot: HealthSnapshot = {
      schemaVersion: 2,
      probeModel: "gemini-3.8-flash-high",
      sweepStartedAt: null,
      checkedAt: 1_700_000_000_000,
      results: [
        {
          provider: "google-antigravity",
          email: "alice@example.com",
          project: "p1",
          model: "gemini-3.8-flash-high",
          status: "ok",
          ms: 50,
          startedAt: 1_700_000_000_000 - 50,
          checkedAt: 1_700_000_000_000,
          failureKind: null,
          confirmed: false,
        },
      ],
      streaks: {},
    };

    const dashboard = DashboardEngine.compile(reports, snapshot, {
      now: 1_700_000_005_000,
      showHealth: true,
    });
    expect(dashboard.providers.length).toBe(1);
    expect(dashboard.providers[0].rows[0].health).toBe("ok");
    expect(dashboard.health?.ageMs).toBe(5000);
  });

  test("compiles dashboard via instance with preconfigured default options", () => {
    const engine = new DashboardEngine({ showHealth: true, now: 1_700_000_000_000 });
    const dashboard = engine.compile([]);
    expect(dashboard.providers).toEqual([]);
    expect(dashboard.health).toBeDefined();
  });
});

describe("isDashboard validator", () => {
  test("rejects malformed dashboard payloads", () => {
    expect(isDashboard(null)).toBe(false);
    expect(isDashboard({})).toBe(false);
    expect(isDashboard({ fetchedAt: "invalid" })).toBe(false);
    expect(
      isDashboard({
        fetchedAt: 123,
        providers: [
          {
            id: "p1",
            name: "P1",
            suffix: "",
            accounts: 1,
            columns: [{ key: "k1", label: "L1" }],
            rows: [
              {
                account: "a@x.com",
                displayAccount: "a",
                health: null,
                maxUsed: 0.5,
                level: "ok",
                route: { text: "OK", level: "ok" },
                limits: [], // Mismatch: 0 limits for 1 column
              },
            ],
          },
        ],
        summary: {
          providers: 1,
          accounts: 1,
          above80: 0,
          maxed: 0,
          aboveThreshold: 0.8,
          tightest: null,
        },
        health: null,
        balance: null,
        tooltip: "OMP: test",
        iconLevel: "ok",
      }),
    ).toBe(false);
  });

  test("accepts valid pacing and rejects malformed pacing on DashboardLimit", () => {
    const now = 1_000_000_000_000;
    const resetsAt = now + 400_000_000;
    const reports: UsageReport[] = [
      {
        provider: "muse-code",
        metadata: { email: "muse@example.com" },
        limits: [
          {
            label: "Weekly",
            window: { label: "Weekly", resetsAt },
            amount: { usedFraction: 0.35 },
          },
        ],
      },
      {
        provider: "google-antigravity",
        metadata: { email: "anti@example.com" },
        limits: [
          {
            label: "Gemini",
            window: { label: "Weekly", resetsAt },
            amount: { usedFraction: 0.4 },
          },
        ],
      },
    ];

    const dashboard = DashboardEngine.compile(reports, null, { now });

    expect(isDashboard(dashboard)).toBe(true);

    const museProvider = dashboard.providers.find((p) => p.id === "muse-code");
    const museWeekly = museProvider?.rows[0].limits.find((l) => l.label === "Weekly");
    expect(museWeekly?.pacing).toEqual({
      dayIndex: 2,
      todayCeilingFraction: 3 / 7,
      headroomFraction: 3 / 7 - 0.35,
    });

    const antiProvider = dashboard.providers.find((p) => p.id === "google-antigravity");
    const antiWeekly = antiProvider?.rows[0].limits.find((l) => l.label === "Weekly");
    expect(antiWeekly?.pacing).toEqual({
      dayIndex: 2,
      todayCeilingFraction: 3 / 7,
      headroomFraction: 3 / 7 - 0.4,
    });

    // Mutate pacing to be malformed (slices length 6) -> isDashboard must reject
    const malformed = JSON.parse(JSON.stringify(dashboard));
    const malformedMuseWeekly = malformed.providers[0].rows[0].limits[0];
    malformedMuseWeekly.pacing.dayIndex = 7;
    expect(isDashboard(malformed)).toBe(false);
  });

  test("includes pacing per account when a provider has multiple accounts", () => {
    const now = 1_000_000_000_000;
    const resetsAt = now + 400_000_000;
    const reports: UsageReport[] = [
      {
        provider: "muse-code",
        metadata: { email: "muse1@example.com" },
        limits: [
          {
            label: "Weekly",
            window: { label: "Weekly", resetsAt },
            amount: { usedFraction: 0.3 },
          },
        ],
      },
      {
        provider: "muse-code",
        metadata: { email: "muse2@example.com" },
        limits: [
          {
            label: "Weekly",
            window: { label: "Weekly", resetsAt },
            amount: { usedFraction: 0.3 },
          },
        ],
      },
    ];

    const dashboard = DashboardEngine.compile(reports, null, { now });
    const museProvider = dashboard.providers.find((p) => p.id === "muse-code");
    expect(museProvider?.rows.length).toBe(2);
    for (const row of museProvider?.rows ?? []) {
      const weekly = row.limits.find((l) => l.label === "Weekly");
      expect(weekly?.pacing).toBeDefined();
      expect(weekly?.pacing?.todayCeilingFraction).toBeGreaterThan(0);
    }
  });
});

describe("account sort ordering", () => {
  const now = 1_700_000_000_000;
  const hour = 3_600_000;
  const day = 86_400_000;

  function weeklyReport(email: string, resetsAt: number, usedFraction: number): UsageReport {
    return {
      provider: "muse-code",
      metadata: { email },
      limits: [
        {
          label: "Weekly",
          window: { label: "Weekly", resetsAt },
          amount: { usedFraction },
        },
      ],
    };
  }

  const reports: UsageReport[] = [
    weeklyReport("far@example.com", now + 4 * day, 0.1),
    weeklyReport("soon@example.com", now + 2 * hour, 0.2),
    weeklyReport("mid@example.com", now + 1 * day, 0.9),
    weeklyReport("expired@example.com", now - hour, 0.5),
  ];

  function rowAccounts(accountSort?: "weekly-reset" | "weekly-usage"): string[] {
    const dashboard = DashboardEngine.compile(reports, null, { now, accountSort });
    return (dashboard.providers[0]?.rows ?? []).map((row) => row.account);
  }

  test("weekly-reset orders accounts by soonest weekly reset, expired last", () => {
    expect(rowAccounts("weekly-reset")).toEqual([
      "soon@example.com",
      "mid@example.com",
      "far@example.com",
      "expired@example.com",
    ]);
  });

  test("weekly-reset is the default order", () => {
    expect(rowAccounts()).toEqual([
      "soon@example.com",
      "mid@example.com",
      "far@example.com",
      "expired@example.com",
    ]);
  });

  test("weekly-usage orders accounts by highest quota usage", () => {
    expect(rowAccounts("weekly-usage")).toEqual([
      "mid@example.com",
      "expired@example.com",
      "soon@example.com",
      "far@example.com",
    ]);
  });

  test("unhealthy routes stay first under both sort orders", () => {
    function agReport(email: string, resetsAt: number, usedFraction: number): UsageReport {
      return {
        provider: "google-antigravity",
        metadata: { email, projectId: "p1" },
        limits: [
          {
            label: "Weekly",
            window: { label: "Weekly", resetsAt },
            amount: { usedFraction },
          },
        ],
      };
    }
    const agReports: UsageReport[] = [
      agReport("far@example.com", now + 4 * day, 0.1),
      agReport("soon@example.com", now + 2 * hour, 0.2),
      agReport("mid@example.com", now + 1 * day, 0.9),
      agReport("expired@example.com", now - hour, 0.5),
    ];

    const snapshot: HealthSnapshot = {
      schemaVersion: 2,
      probeModel: "gemini-3.8-flash-high",
      sweepStartedAt: null,
      checkedAt: now,
      results: [
        {
          provider: "google-antigravity",
          email: "far@example.com",
          project: "p1",
          model: "gemini-3.8-flash-high",
          status: "hang",
          ms: 15_000,
          startedAt: now - 15000,
          checkedAt: now,
          failureKind: "timeout",
          confirmed: true,
        },
      ],
      streaks: {},
    };
    for (const accountSort of ["weekly-reset", "weekly-usage"] as const) {
      const dashboard = DashboardEngine.compile(agReports, snapshot, {
        now,
        accountSort,
        showHealth: true,
      });
      expect(dashboard.providers[0]?.rows[0]?.account).toBe("far@example.com");
    }
  });
});
