import { describe, expect, test } from "bun:test";
import type { HealthResult, Policy } from "@omp-toolkit/core";
import {
  healthLines,
  publish,
  setWidgetEnabled,
  statusTag,
  summary,
  table,
  type WidgetContext,
  widgetEnabled,
  widgetStatePath,
} from "./widget";

describe("widget presentation module", () => {
  test("statusTag returns consistent padded labels", () => {
    expect(statusTag({ email: "a@b.com", status: "ok", ms: 100 })).toBe("OK  ");
    expect(statusTag({ email: "a@b.com", status: "hang", ms: 100 })).toBe("HANG");
    expect(statusTag({ email: "a@b.com", status: "auth", ms: 100 })).toBe("AUTH");
    expect(statusTag({ email: "a@b.com", status: "model-error", ms: 100 })).toBe("MODEL");
    expect(statusTag({ email: "a@b.com", status: "error", ms: 100 })).toBe("ERR ");
  });

  test("summary formats ok and hang counts accurately", () => {
    const results: HealthResult[] = [
      { email: "a@b.com", status: "ok", ms: 100 },
      { email: "c@d.com", status: "hang", ms: 15000 },
    ];
    expect(summary(results)).toBe("Gemini 3.8: 1/2 ok · 1 hang");

    const allOk: HealthResult[] = [{ email: "a@b.com", status: "ok", ms: 100 }];
    expect(summary(allOk)).toBe("Gemini 3.8: 1/1 ok");
  });

  test("healthLines and table handle empty accounts list", () => {
    expect(healthLines([], [])).toEqual(["Gemini health: no Antigravity accounts found"]);
    expect(table([], [])).toBe("Gemini health: no Antigravity accounts found");
  });

  test("healthLines formats excluded accounts and details", () => {
    const results: HealthResult[] = [
      {
        email: "excluded@example.com",
        status: "ok",
        ms: 1200,
        detail: "recovered",
      },
    ];
    const policies: Policy[] = [
      {
        provider: "google-antigravity",
        account: { email: "excluded@example.com" },
        reservePct: 100,
      },
    ];
    const lines = healthLines(results, policies);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("Gemini 3.8 route health");
    expect(lines[1]).toContain("excluded@example.com");
    expect(lines[1]).toContain("[excluded]");
    expect(lines[1]).toContain("recovered");
  });

  test("widgetStatePath resolves expected file name", () => {
    expect(widgetStatePath()).toContain("gemini-health-widget.json");
  });

  test("widgetEnabled and setWidgetEnabled persist toggle", () => {
    const original = widgetEnabled();
    try {
      setWidgetEnabled(!original);
      expect(widgetEnabled()).toBe(!original);
    } finally {
      setWidgetEnabled(original);
    }
  });

  test("publish updates status and widget on active UI", () => {
    const statuses: Array<[string, string | undefined]> = [];
    const widgets: Array<[string, string[] | undefined]> = [];
    const ctx: WidgetContext = {
      hasUI: true,
      mode: "tui",
      ui: {
        setStatus: (key, text) => statuses.push([key, text]),
        setWidget: (key, lines) => widgets.push([key, lines]),
      },
    };

    const results: HealthResult[] = [{ email: "a@b.com", status: "ok", ms: 250 }];
    publish(ctx, results, []);

    expect(statuses.length).toBe(1);
    expect(statuses[0]?.[0]).toBe("gemini-health");
    expect(statuses[0]?.[1]).toBe("Gemini 3.8: 1/1 ok");
    expect(widgets.length).toBe(1);
    expect(widgets[0]?.[0]).toBe("gemini-health");
  });

  test("publish gracefully swallows UI errors", () => {
    const ctx: WidgetContext = {
      hasUI: true,
      mode: "tui",
      ui: {
        setStatus: () => {
          throw new Error("UI crashed");
        },
        setWidget: () => {},
      },
    };

    expect(() => publish(ctx, [], [])).not.toThrow();
  });
});
