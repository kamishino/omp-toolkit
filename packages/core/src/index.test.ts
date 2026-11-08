import { describe, expect, test } from "bun:test";
import {
  columnsFor,
  deepSeekUsageReport,
  excludedEmails,
  type HealthResult,
  pickDeepSeekBalance,
  providerName,
  routeFreshness,
  routeKey,
  sectionsFor,
  type UsageReport,
  usedPercent,
} from ".";

const reports: UsageReport[] = [
  {
    provider: "google-antigravity",
    metadata: { email: "alpha@example.com", projectId: "alpha" },
    limits: [
      {
        id: "google-antigravity:google:default:gemini-weekly",
        label: "Gemini",
        window: { label: "Weekly", resetsAt: 1_800_000_000_000 },
        amount: { usedFraction: 0.7 },
      },
      {
        id: "google-antigravity:google:default:gemini-5h",
        label: "Gemini",
        window: { label: "5 Hour", resetsAt: 1_800_000_000_000 },
        amount: { usedFraction: 0.2 },
      },
      {
        id: "google-antigravity:anthropic:default:3p-weekly",
        label: "Claude & GPT (shared)",
        window: { label: "Weekly", resetsAt: 1_800_000_000_000 },
        amount: { usedFraction: 1 },
      },
    ],
  },
  {
    provider: "google-antigravity",
    metadata: { email: "hang@example.com", projectId: "hang" },
    limits: [
      {
        id: "google-antigravity:google:default:gemini-weekly",
        label: "Gemini",
        window: { label: "Weekly", resetsAt: 1_800_000_000_000 },
        amount: { usedFraction: 0.1 },
      },
    ],
  },
  {
    provider: "muse-code",
    metadata: { email: "muse@example.com" },
    limits: [
      {
        label: "5 Hours",
        window: { label: "5 Hours" },
        amount: { usedFraction: 0 },
      },
      {
        label: "Weekly",
        window: { label: "Weekly", resetsAt: 1_800_000_000_000 },
        amount: { usedFraction: 1 },
      },
    ],
  },
];

describe("usage columns", () => {
  test("keeps Gemini limits and drops shared 3P limits for Antigravity", () => {
    const columns = columnsFor("google-antigravity", reports.slice(0, 2));
    expect(columns.map((column) => column.key)).toEqual(["Gemini|5 Hour", "Gemini|Weekly"]);
  });

  test("clamps used fractions", () => {
    expect(usedPercent({ amount: { usedFraction: -1 } })).toBe(0);
    expect(usedPercent({ amount: { usedFraction: 2 } })).toBe(1);
    expect(usedPercent({ amount: { usedFraction: 0.25 } })).toBe(0.25);
    expect(usedPercent({})).toBeUndefined();
  });
});

describe("provider sections", () => {
  test("groups providers and sorts a HANG account first", () => {
    const health = new Map<string, HealthResult>([
      [
        "hang@example.com",
        {
          provider: "google-antigravity",
          email: "hang@example.com",
          project: "hang",
          model: "gemini-3.8-flash-high",
          status: "hang",
          ms: 15_000,
          startedAt: Date.now() - 15_000,
          checkedAt: Date.now(),
          failureKind: "timeout",
          confirmed: true,
        },
      ],
      [
        "alpha@example.com",
        {
          provider: "google-antigravity",
          email: "alpha@example.com",
          project: "alpha",
          model: "gemini-3.8-flash-high",
          status: "ok",
          ms: 2_000,
          startedAt: Date.now() - 2_000,
          checkedAt: Date.now(),
          failureKind: null,
          confirmed: false,
        },
      ],
    ]);
    const sections = sectionsFor(reports, health);
    expect(sections.map((section) => section.provider)).toEqual([
      "google-antigravity",
      "muse-code",
    ]);
    expect(sections[0]?.rows[0]?.account).toBe("hang@example.com");
    expect(sections[0]?.rows[0]?.health?.status).toBe("hang");
    expect(sections[1]?.rows[0]?.account).toBe("muse@example.com");
    expect(sections[1]?.columns.map((column) => column.label)).toEqual(["5 Hours", "Weekly"]);
  });

  test("sorts accounts primarily by weekly usage, breaking ties by 5-hour usage and name", () => {
    const testReports: UsageReport[] = [
      {
        provider: "google-antigravity",
        metadata: { email: "zero-low@example.com" },
        limits: [
          { label: "Gemini", window: { label: "5 Hour" }, amount: { usedFraction: 0 } },
          { label: "Gemini", window: { label: "Weekly" }, amount: { usedFraction: 0.1 } },
        ],
      },
      {
        provider: "google-antigravity",
        metadata: { email: "zero-high@example.com" },
        limits: [
          { label: "Gemini", window: { label: "5 Hour" }, amount: { usedFraction: 0 } },
          { label: "Gemini", window: { label: "Weekly" }, amount: { usedFraction: 0.9 } },
        ],
      },
      {
        provider: "google-antigravity",
        metadata: { email: "busy-5h@example.com" },
        limits: [
          { label: "Gemini", window: { label: "5 Hour" }, amount: { usedFraction: 0.6 } },
          { label: "Gemini", window: { label: "Weekly" }, amount: { usedFraction: 0.4 } },
        ],
      },
    ];

    const sections = sectionsFor(testReports, new Map());
    const agySection = sections.find((s) => s.provider === "google-antigravity");
    expect(agySection).toBeDefined();

    const rows = agySection?.rows ?? [];
    expect(rows.length).toBe(3);

    // 1. zero-high floats to top because weekly is 90% (highest)
    expect(rows[0].account).toBe("zero-high@example.com");
    expect(rows[0].primary).toBe(0.9);
    expect(rows[0].secondary).toBe(0);
    expect(rows[0].max).toBe(0.9);

    // 2. busy-5h is second because weekly is 40% (middle)
    expect(rows[1].account).toBe("busy-5h@example.com");
    expect(rows[1].primary).toBe(0.4);
    expect(rows[1].secondary).toBe(0.6);
    expect(rows[1].max).toBe(0.6);

    // 3. zero-low is last because weekly is 10% (lowest)
    expect(rows[2].account).toBe("zero-low@example.com");
    expect(rows[2].primary).toBe(0.1);
    expect(rows[2].secondary).toBe(0);
    expect(rows[2].max).toBe(0.1);
  });

  test("breaks ties on identical weekly usage using 5-hour usage descending", () => {
    const testReports: UsageReport[] = [
      {
        provider: "google-antigravity",
        metadata: { email: "tied-low-5h@example.com" },
        limits: [
          { label: "Gemini", window: { label: "5 Hour" }, amount: { usedFraction: 0.1 } },
          { label: "Gemini", window: { label: "Weekly" }, amount: { usedFraction: 0.5 } },
        ],
      },
      {
        provider: "google-antigravity",
        metadata: { email: "tied-high-5h@example.com" },
        limits: [
          { label: "Gemini", window: { label: "5 Hour" }, amount: { usedFraction: 0.8 } },
          { label: "Gemini", window: { label: "Weekly" }, amount: { usedFraction: 0.5 } },
        ],
      },
    ];

    const sections = sectionsFor(testReports, new Map());
    const agySection = sections.find((s) => s.provider === "google-antigravity");
    const rows = agySection?.rows ?? [];
    expect(rows.length).toBe(2);

    expect(rows[0].account).toBe("tied-high-5h@example.com");
    expect(rows[0].primary).toBe(0.5);
    expect(rows[0].secondary).toBe(0.8);

    expect(rows[1].account).toBe("tied-low-5h@example.com");
    expect(rows[1].primary).toBe(0.5);
    expect(rows[1].secondary).toBe(0.1);
  });
});

describe("health domain", () => {
  test("routeKey normalizes email while preserving project and model", () => {
    const key = routeKey({
      provider: "google-antigravity",
      email: "  User@Example.com  ",
      project: "proj-1",
      model: "gemini-3.8-flash-high",
    });
    expect(key).toBe(
      JSON.stringify(["google-antigravity", "user@example.com", "proj-1", "gemini-3.8-flash-high"]),
    );
  });

  test("routeFreshness detects fresh and stale observations", () => {
    const now = 20_000_000;
    const observation: HealthResult = {
      provider: "google-antigravity",
      email: "u@ex.com",
      project: "p1",
      model: "gemini-3.8-flash-high",
      status: "ok",
      ms: 100,
      startedAt: now - 100,
      checkedAt: now,
      failureKind: null,
      confirmed: false,
    };
    expect(routeFreshness(observation, now)).toBe("fresh");
    expect(routeFreshness({ ...observation, checkedAt: now - 20 * 60_000 }, now)).toBe("stale");
    expect(routeFreshness(undefined, now)).toBe("unknown");
  });
  test("finds reservePct exclusions only for Antigravity", () => {
    const emails = excludedEmails([
      {
        provider: "google-antigravity",
        account: { email: "a@example.com" },
        reservePct: 100,
      },
      {
        provider: "google-antigravity",
        account: { email: "b@example.com" },
        reservePct: 10,
      },
      {
        provider: "openai-codex",
        account: { email: "c@example.com" },
        reservePct: 100,
      },
    ]);
    expect([...emails]).toEqual(["a@example.com"]);
  });
});

describe("deepseek balance domain", () => {
  test("prefers CNY when both CNY and USD entries exist", () => {
    const payload = {
      is_available: true,
      balance_infos: [
        {
          currency: "USD",
          total_balance: "15.00",
          granted_balance: "0.00",
          topped_up_balance: "15.00",
        },
        {
          currency: "CNY",
          total_balance: "110.00",
          granted_balance: "10.00",
          topped_up_balance: "100.00",
        },
      ],
    };
    expect(pickDeepSeekBalance(payload)).toEqual({
      currency: "CNY",
      total: 110,
      granted: 10,
      toppedUp: 100,
    });
  });

  test("falls back to USD when CNY is absent", () => {
    const payload = {
      is_available: true,
      balance_infos: [
        {
          currency: "USD",
          total_balance: "25.50",
          granted_balance: "5.00",
          topped_up_balance: "20.50",
        },
      ],
    };
    expect(pickDeepSeekBalance(payload)).toEqual({
      currency: "USD",
      total: 25.5,
      granted: 5,
      toppedUp: 20.5,
    });
  });

  test("returns null on malformed or empty payloads", () => {
    expect(pickDeepSeekBalance(null)).toBeNull();
    expect(pickDeepSeekBalance({})).toBeNull();
    expect(pickDeepSeekBalance({ balance_infos: [] })).toBeNull();
    expect(pickDeepSeekBalance({ balance_infos: [{ currency: "EUR" }] })).toBeNull();
  });

  test("falls back to granted + toppedUp when total_balance is missing", () => {
    const payload = {
      is_available: true,
      balance_infos: [{ currency: "CNY", granted_balance: "12.00", topped_up_balance: "88.00" }],
    };
    expect(pickDeepSeekBalance(payload)).toEqual({
      currency: "CNY",
      total: 100,
      granted: 12,
      toppedUp: 88,
    });
  });

  test("builds usage report with exhausted status when is_available is false", () => {
    const payload = {
      is_available: false,
      balance_infos: [
        {
          currency: "CNY",
          total_balance: "0.00",
          granted_balance: "0.00",
          topped_up_balance: "0.00",
        },
      ],
    };
    const report = deepSeekUsageReport(payload, 1_700_000_000);
    expect(report).not.toBeNull();
    expect(report?.provider).toBe("deepseek");
    expect(report?.fetchedAt).toBe(1_700_000_000);
    expect(report?.metadata?.balance?.available).toBe(false);
    expect(report?.limits?.[0].status).toBe("exhausted");
    expect(report?.limits?.[0].amount?.unit).toBe("cny");
    expect(report?.limits?.[0].amount?.remaining).toBe(0);
    expect(report?.limits?.[1].amount?.remaining).toBe(0);
  });

  test("resolves providerName for deepseek", () => {
    expect(providerName("deepseek")).toBe("DEEPSEEK");
  });

  test("does not attach route health to non-Antigravity providers", () => {
    const report: UsageReport = {
      provider: "openai-codex",
      metadata: { email: "codex@example.com" },
      limits: [{ label: "30 days", amount: { usedFraction: 0.5 } }],
    };
    const health = new Map<string, HealthResult>([
      [
        "codex@example.com",
        {
          provider: "google-antigravity",
          email: "codex@example.com",
          project: "p1",
          model: "gemini-3.8-flash-high",
          status: "hang",
          ms: 15_000,
          startedAt: 1000,
          checkedAt: 2000,
          failureKind: "timeout",
          confirmed: true,
        },
      ],
    ]);
    const sections = sectionsFor([report], health);
    expect(sections[0]?.rows[0]?.health).toBeUndefined();
  });
});
