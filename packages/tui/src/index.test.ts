import { describe, expect, test } from "bun:test";
import {
  buildDashboard,
  DEEPSEEK_POLICY,
  type HealthResult,
  sectionsFor,
  type UsageReport,
} from "@omp-toolkit/core";
import {
  ANSI,
  bar,
  colorFor,
  colorForLevel,
  createStdoutBackend,
  createTerminal,
  createTestBackend,
  createTestBackendState,
  drawProviderUsage,
  drawScheduleView,
  padVisible,
  percent,
  renderProviderUsage,
  stripAnsi,
  terminalDraw,
  testBackendToString,
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

  test("maps usage to semantic colors", () => {
    expect(colorFor(0.9)).toBe(ANSI.red);
    expect(colorFor(0.75)).toBe(ANSI.orange);
    expect(colorFor(0.5)).toBe(ANSI.yellow);
    expect(colorFor(0.1)).toBe(ANSI.green);
    expect(colorForLevel("critical")).toBe(ANSI.red);
    expect(colorForLevel("hot")).toBe(ANSI.orange);
    expect(colorForLevel("warn")).toBe(ANSI.yellow);
    expect(colorForLevel("ok")).toBe(ANSI.green);
    expect(colorForLevel("unknown")).toBe(ANSI.muted);
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

  test("renders LOW for a low DeepSeek balance and keeps the frame width", () => {
    const report: UsageReport = {
      provider: "deepseek",
      metadata: { email: "user@example.com", balance: { currency: "CNY", total: 9.5 } },
      limits: [
        { id: "deepseek:balance", label: "Balance", amount: { remaining: 9.5, unit: "cny" } },
        { id: "deepseek:granted", label: "Granted", amount: { remaining: 0, unit: "cny" } },
      ],
    };
    const view = renderProviderUsage(sectionsFor([report], new Map()), {
      interval: 300,
      watch: false,
      showHealth: false,
      balanceAlert: { cny: 10, usd: 10 },
    });
    expect(view).toContain("LOW");
    expect(view).toContain("¥9.50");
    expect(view).toMatch(/\[(OFF-PEAK|PEAK):/);
    for (const line of view.split("\n")) {
      expect(stripAnsi(line).length).toBeLessThanOrEqual(86);
    }
  });

  test("shows ROUTE for every provider and keeps columns inside 86", () => {
    const codex: UsageReport = {
      provider: "openai-codex",
      metadata: { email: "codex@example.com" },
      limits: [
        { label: "Weekly", window: { label: "Weekly" }, amount: { usedFraction: 0.2 } },
        { label: "5 Hour", window: { label: "5 Hour" }, amount: { usedFraction: 0.3 } },
        { label: "30 days", window: { label: "30 days" }, amount: { usedFraction: 0.4 } },
      ],
    };
    const health = new Map<string, HealthResult>([
      ["codex@example.com", { email: "codex@example.com", status: "hang", ms: 15_000 }],
    ]);
    const view = renderProviderUsage(sectionsFor([...reports, codex], health), {
      interval: 300,
      watch: false,
      showHealth: true,
    });
    const headers = view.split("\n").filter((line) => line.includes("ACCOUNT"));
    expect(headers.length).toBe(3);
    for (const header of headers) {
      expect(header).toContain("ROUTE");
    }
    for (const line of view.split("\n")) {
      expect(stripAnsi(line).length).toBeLessThanOrEqual(86);
    }
  });
  test("drawProviderUsage draws onto terminui terminal buffer via test backend", () => {
    const state = createTestBackendState(86, 20);
    const terminal = createTerminal(createTestBackend(state));
    const dashboard = buildDashboard(sectionsFor(reports, new Map()), {
      fetchedAt: Date.now(),
      now: Date.now(),
      showHealth: false,
      thresholds: { warm: 0.4, hot: 0.7, critical: 0.85, above: 0.8 },
      staleMinutes: 15,
      balanceAlert: { cny: 10, usd: 10 },
    });

    terminalDraw(terminal, (frame) => {
      drawProviderUsage(frame, dashboard, {
        interval: 300,
        watch: false,
        showHealth: false,
      });
    });

    const output = testBackendToString(state);
    expect(output).toContain("OMP Provider Usage");
    expect(output).toContain("GOOGLE ANTIGRAVITY");
    expect(output).toContain("MUSE CODE");
  });

  test("drawScheduleView draws onto terminui terminal buffer via test backend", () => {
    const state = createTestBackendState(86, 30);
    const terminal = createTerminal(createTestBackend(state));

    terminalDraw(terminal, (frame) => {
      drawScheduleView(frame, [DEEPSEEK_POLICY]);
    });

    const output = testBackendToString(state);
    expect(output).toContain("Provider Pricing Schedules");
    expect(output).toContain("DeepSeek API Time-of-Day Pricing");
    expect(output).toContain("Monday");
  });

  test("createStdoutBackend adheres to terminui backend contract", () => {
    const writes: string[] = [];
    const mockStream = {
      columns: 86,
      rows: 30,
      write: (data: string) => {
        writes.push(data);
        return true;
      },
    } as unknown as NodeJS.WriteStream;

    const backend = createStdoutBackend(mockStream);
    expect(backend.size()).toEqual({ width: 86, height: 30 });
    backend.hideCursor();
    expect(writes).toContain("\x1b[?25l");
    backend.showCursor();
    expect(writes).toContain("\x1b[?25h");
  });
});
