import { describe, expect, test } from "bun:test";
import {
  columnsFor,
  deepSeekUsageReport,
  excludedEmails,
  type HealthResult,
  nextStreaks,
  pickDeepSeekBalance,
  providerName,
  restorableEmails,
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
      ["hang@example.com", { email: "hang@example.com", status: "hang", ms: 15_000 }],
      ["alpha@example.com", { email: "alpha@example.com", status: "ok", ms: 2_000 }],
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

  test("sorts accounts primarily by 5-hour usage, breaking ties by weekly usage and name", () => {
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

    // 1. busy-5h floats to top because 5-hour is 60%
    expect(rows[0].account).toBe("busy-5h@example.com");
    expect(rows[0].primary).toBe(0.6);
    expect(rows[0].max).toBe(0.6);

    // 2. zero-high floats above zero-low because 5-hour tied at 0%, and weekly breaks tie (90% > 10%)
    expect(rows[1].account).toBe("zero-high@example.com");
    expect(rows[1].primary).toBe(0);
    expect(rows[1].max).toBe(0.9);

    // 3. zero-low is last
    expect(rows[2].account).toBe("zero-low@example.com");
    expect(rows[2].primary).toBe(0);
    expect(rows[2].max).toBe(0.1);
  });
});

describe("health domain", () => {
  test("records spaced healthy streaks and resets on failure", () => {
    let streaks = nextStreaks(
      {},
      [{ index: 1, email: "a@example.com", project: "a", status: "ok", ms: 1 }],
      1_000,
      500,
    );
    expect(streaks["a@example.com"]).toEqual({ ok: 1, lastAt: 1_000 });

    streaks = nextStreaks(
      streaks,
      [{ index: 1, email: "a@example.com", project: "a", status: "ok", ms: 1 }],
      1_200,
      500,
    );
    expect(streaks["a@example.com"]?.ok).toBe(1);

    streaks = nextStreaks(
      streaks,
      [{ index: 1, email: "a@example.com", project: "a", status: "ok", ms: 1 }],
      1_600,
      500,
    );
    expect(streaks["a@example.com"]?.ok).toBe(2);

    streaks = nextStreaks(
      streaks,
      [{ index: 1, email: "a@example.com", project: "a", status: "hang", ms: 15_000 }],
      1_700,
      500,
    );
    expect(streaks["a@example.com"]).toEqual({ ok: 0, lastAt: 0 });
  });

  test("selects only managed accounts at the restore threshold", () => {
    const state = { excluded: ["a@example.com", "b@example.com"] };
    const streaks = {
      "a@example.com": { ok: 3, lastAt: 0 },
      "b@example.com": { ok: 2, lastAt: 0 },
    };
    expect(restorableEmails(state, streaks, 3)).toEqual(["a@example.com"]);
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

  test("attaches route health to any provider by account email", () => {
    const report: UsageReport = {
      provider: "openai-codex",
      metadata: { email: "codex@example.com" },
      limits: [{ label: "30 days", amount: { usedFraction: 0.5 } }],
    };
    const health = new Map<string, HealthResult>([
      ["codex@example.com", { email: "codex@example.com", status: "hang", ms: 15_000 }],
    ]);
    const sections = sectionsFor([report], health);
    expect(sections[0]?.rows[0]?.health?.status).toBe("hang");
  });
});
