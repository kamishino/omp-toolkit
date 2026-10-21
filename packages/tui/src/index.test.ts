import { describe, expect, test } from "bun:test";
import { type HealthResult, sectionsFor, type UsageReport } from "@omp-toolkit/core";
import {
  ANSI,
  bar,
  colorFor,
  healthAge,
  money,
  padVisible,
  percent,
  renderProviderUsage,
  stripAnsi,
} from ".";

process.env.NO_COLOR = "1";

const reports: UsageReport[] = [
  {
    provider: "google-antigravity",
    metadata: { email: "hang@example.com", projectId: "hang" },
    limits: [
      {
        id: "gemini-weekly",
        label: "Gemini",
        window: { label: "Weekly", resetsAt: Date.now() + 3_600_000 },
        amount: { usedFraction: 0.2 },
      },
      {
        id: "gemini-5h",
        label: "Gemini",
        window: { label: "5 Hour", resetsAt: Date.now() + 1_800_000 },
        amount: { usedFraction: 0.1 },
      },
    ],
  },
  {
    provider: "muse-code",
    metadata: { email: "muse@example.com" },
    limits: [
      {
        label: "Weekly",
        window: { label: "Weekly", resetsAt: Date.now() + 86_400_000 },
        amount: { usedFraction: 1 },
      },
    ],
  },
];

describe("terminal formatting", () => {
  test("renders a fixed-width bar", () => {
    expect(bar(0.5, 10)).toBe("█████░░░░░");
    expect(bar(undefined, 4)).toBe("░░░░");
  });

  test("formats percentages and visible padding", () => {
    expect(percent(0.5)).toBe(" 50.0%");
    expect(percent(undefined)).toBe("     —");
    expect(stripAnsi(`${ANSI.red}x${ANSI.reset}`)).toBe("x");
    expect(padVisible(`${ANSI.red}x${ANSI.reset}`, 3)).toBe(`${ANSI.red}x${ANSI.reset}  `);
  });

  test("maps usage to semantic colors and snapshot age", () => {
    expect(colorFor(0.9)).toBe(ANSI.red);
    expect(colorFor(0.75)).toBe(ANSI.orange);
    expect(colorFor(0.5)).toBe(ANSI.yellow);
    expect(colorFor(0.1)).toBe(ANSI.green);
    expect(healthAge(undefined)).toBe("no snapshot");
    expect(healthAge(Date.now())).toMatch(/^\d+s ago$/);
  });

  test("formats money amounts with currency symbols", () => {
    expect(money(110, "cny")).toBe("¥110.00");
    expect(money(25.5, "usd")).toBe("$25.50");
    expect(money(undefined, "cny")).toBe("—");
    expect(money(Number.NaN, "cny")).toBe("—");
  });
});

describe("provider usage view", () => {
  test("shows providers, route health, and stale snapshots", () => {
    const health = new Map<string, HealthResult>([
      ["hang@example.com", { email: "hang@example.com", status: "hang", ms: 15_000 }],
    ]);
    const sections = sectionsFor(reports, health);
    const view = renderProviderUsage(sections, {
      interval: 300,
      watch: true,
      showHealth: true,
      checkedAt: Date.now() - 20 * 60_000,
    });

    expect(view).toContain("OMP Provider Usage");
    expect(view).toContain("GOOGLE ANTIGRAVITY");
    expect(view).toContain("MUSE CODE");
    expect(view).toContain("HANG");
    expect(view).toContain("(stale)");
    expect(view).toContain("refresh 300s");
  });

  test("renders DeepSeek balance in CNY and ignores non-percentage rows for tightest", () => {
    const deepSeekReport: UsageReport = {
      provider: "deepseek",
      metadata: {
        email: "user@example.com",
        balance: {
          currency: "CNY",
          total: 110,
          granted: 10,
          toppedUp: 100,
          available: true,
        },
      },
      limits: [
        {
          id: "deepseek:balance",
          label: "Balance",
          amount: { remaining: 110, unit: "cny" },
          status: "ok",
        },
        {
          id: "deepseek:granted",
          label: "Granted",
          amount: { remaining: 10, unit: "cny" },
          status: "ok",
        },
      ],
    };

    const sections = sectionsFor([...reports, deepSeekReport], new Map());
    const view = renderProviderUsage(sections, {
      interval: 300,
      watch: false,
      showHealth: false,
    });

    expect(view).toContain("DEEPSEEK");
    expect(view).toContain("· CNY");
    expect(view).toContain("BALANCE");
    expect(view).toContain("GRANTED");
    expect(view).toContain("¥110.00");
    expect(view).toContain("¥10.00");
    expect(view).toContain("tightest muse:muse 100%");

    // When only DeepSeek exists, tightest must fall back to "no usage data"
    const balanceOnlySections = sectionsFor([deepSeekReport], new Map());
    const balanceOnlyView = renderProviderUsage(balanceOnlySections, {
      interval: 300,
      watch: false,
      showHealth: false,
    });
    expect(balanceOnlyView).toContain("no usage data");
  });
});
