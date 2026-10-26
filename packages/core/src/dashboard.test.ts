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
} from "./dashboard";
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
    expect(routeFor(undefined)).toEqual({ text: "—", level: "unknown" });
    expect(routeFor({ email: "a@x.com", status: "ok", ms: 100 })).toEqual({
      text: "OK",
      level: "ok",
    });
    expect(routeFor({ email: "b@x.com", status: "hang", ms: 15000 })).toEqual({
      text: "HANG",
      level: "critical",
    });
    expect(routeFor({ email: "c@x.com", status: "error", ms: 200 })).toEqual({
      text: "ERR",
      level: "critical",
    });
    expect(routeFor({ email: "d@x.com", status: "auth", ms: 50 })).toEqual({
      text: "AUTH",
      level: "warn",
    });
    expect(routeFor({ email: "e@x.com", status: "model-error", ms: 80 })).toEqual({
      text: "MODEL",
      level: "warn",
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
    ["bravo@example.com", { email: "bravo@example.com", status: "hang", ms: 15_000 }],
  ]);

  test("constructs dashboard with provider suffix, rows, levels, and tooltip", () => {
    const sections = sectionsFor(reports, health);
    const now = 1_700_000_000_000;
    const dashboard = buildDashboard(sections, {
      fetchedAt: now,
      now,
      showHealth: true,
      checkedAt: now - 20 * 60_000,
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
    expect(bravoRow?.route).toEqual({ text: "HANG", level: "critical" });
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
      checkedAt: now - 20 * 60_000,
      ageMs: 20 * 60_000,
      stale: true,
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
      checkedAt: Date.now() - 5000,
      results: [{ email: "user@example.com", status: "ok", ms: 80 }],
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
      checkedAt: 1_700_000_000_000,
      results: [{ email: "alice@example.com", status: "ok", ms: 50 }],
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
});
