import { describe, expect, test } from "bun:test";
import type { WeeklyPacing } from "@omp-toolkit/core";
import { DEFAULT_DESKTOP_SETTINGS } from "../settings";
import { renderProviderCard } from "./card";
import { icon } from "./icon";
import { renderLimitCell } from "./limit-cell";

describe("renderer card module", () => {
  const originalDoc = globalThis.document;

  function mockDoc() {
    globalThis.document = {
      createElement: (tag: string) => {
        // biome-ignore lint/suspicious/noExplicitAny: DOM mock
        const el: any = {
          tagName: tag,
          className: "",
          children: [] as unknown[],
          appendChild: (c: unknown) => {
            el.children.push(c);
            return c;
          },
          setAttribute: (k: string, v: string) => {
            el[k] = v;
          },
          addEventListener: () => {},
        };
        return el;
      },
      createElementNS: (_ns: string, tag: string) => {
        // biome-ignore lint/suspicious/noExplicitAny: DOM mock
        const el: any = {
          tagName: tag,
          appendChild: (c: unknown) => c,
          setAttribute: (k: string, v: string) => {
            el[k] = v;
          },
        };
        return el;
      },
      createTextNode: (txt: string) => ({ textContent: txt }),
    } as unknown as Document;
  }

  function restoreDoc() {
    globalThis.document = originalDoc;
  }

  test("icon creates SVG element with path and attributes", () => {
    mockDoc();
    try {
      const svg = icon("M10 10");
      expect(svg).toBeDefined();
      expect(svg.tagName).toBe("svg");
    } finally {
      restoreDoc();
    }
  });

  test("renderLimitCell creates cell with currency and formatting", () => {
    mockDoc();
    try {
      const cell = renderLimitCell({
        label: "Balance",
        unit: "cny",
        remaining: 50,
        low: false,
        level: "ok",
      });
      expect(cell).toBeDefined();
      expect(cell.className).toBe("col-limit");
    } finally {
      restoreDoc();
    }
  });

  test("renderProviderCard constructs provider card section", () => {
    mockDoc();
    try {
      const card = renderProviderCard(
        {
          id: "google-antigravity",
          name: "GOOGLE ANTIGRAVITY",
          suffix: "",
          accounts: 1,
          columns: [{ key: "c1", label: "Gemini" }],
          rows: [],
        },
        false,
        0,
        {
          status: "loading",
          data: null,
          intervalSeconds: 300,
          warmup: { running: false, message: null },
          settings: DEFAULT_DESKTOP_SETTINGS,
        },
      );
      expect(card).toBeDefined();
      expect(card.className).toBe("provider-card");
    } finally {
      restoreDoc();
    }
  });

  test("renderProviderCard renders pacing row when limit carries pacing", () => {
    mockDoc();
    try {
      const pacingStub: WeeklyPacing = {
        windowStartAt: 1000,
        resetsAt: 2000,
        dayIndex: 1,
        usedFraction: 0.2,
        remainingFraction: 0.8,
        idealUsedFraction: 0.25,
        paceDeltaFraction: -0.05,
        status: "under",
        level: "ok",
        fixedDailyFraction: 1 / 7,
        adaptiveDailyFraction: 0.15,
        safeLeftTodayFraction: 0.08,
        todayUsedFraction: 0.1,
        todayLowerBound: false,
        unobservedFraction: 0,
        projectedExhaustionAt: null,
        slices: Array.from({ length: 7 }, (_, i) => ({
          index: i,
          startAt: 1000 + i * 100,
          endAt: 1100 + i * 100,
          state: i === 1 ? "current" : i < 1 ? "past" : "future",
          usedFraction: i <= 1 ? 0.1 : null,
          lowerBound: false,
          budgetFraction: i > 1 ? 0.15 : null,
        })),
      };

      const card = renderProviderCard(
        {
          id: "muse-code",
          name: "MUSE CODE",
          suffix: "",
          accounts: 1,
          columns: [{ key: "c1", label: "Weekly" }],
          rows: [
            {
              account: "muse@example.com",
              displayAccount: "muse",
              health: null,
              maxUsed: 0.2,
              level: "ok",
              route: { text: "—", level: "ok" },
              limits: [
                {
                  label: "Weekly",
                  low: false,
                  level: "ok",
                  usedFraction: 0.2,
                  pacing: pacingStub,
                },
              ],
            },
          ],
        },
        false,
        0,
        {
          status: "loading",
          data: null,
          intervalSeconds: 300,
          warmup: { running: false, message: null },
          settings: DEFAULT_DESKTOP_SETTINGS,
        },
      );

      interface MockNode {
        tagName: string;
        className: string;
        children: MockNode[];
      }
      const cardObj = card as unknown as MockNode;
      const table = cardObj.children.find((c) => c.tagName === "table");
      const tbody = table?.children.find((c) => c.tagName === "tbody");
      const rows = tbody?.children ?? [];
      // Primary row + Pacing row
      expect(rows.length).toBe(2);
      expect(rows[1].className).toBe("pacing-row");
    } finally {
      restoreDoc();
    }
  });
});
