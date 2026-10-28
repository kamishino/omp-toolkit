import { describe, expect, test } from "bun:test";
import type { WeeklyPacing } from "@omp-toolkit/core";
import { renderPacingRow } from "./pacing-row";

describe("renderer pacing-row module", () => {
  const originalDoc = globalThis.document;

  function mockDoc() {
    globalThis.document = {
      createElement: (tag: string) => {
        const el: Record<string, unknown> = {
          tagName: tag,
          className: "",
          textContent: "",
          title: "",
          attributes: {} as Record<string, string>,
          children: [] as unknown[],
          appendChild: (c: unknown) => {
            (el.children as unknown[]).push(c);
            return c;
          },
          setAttribute: (k: string, v: string) => {
            (el.attributes as Record<string, string>)[k] = v;
          },
        };
        return el as unknown as HTMLElement;
      },
    } as unknown as Document;
  }

  function restoreDoc() {
    globalThis.document = originalDoc;
  }

  test("renderPacingRow renders 7 chips, lowerBound marker, future budget, and unobserved span", () => {
    mockDoc();
    try {
      const mockPacing: WeeklyPacing = {
        windowStartAt: 1000,
        resetsAt: 2000,
        dayIndex: 1,
        usedFraction: 0.3,
        remainingFraction: 0.7,
        idealUsedFraction: 0.28,
        paceDeltaFraction: 0.02,
        status: "over",
        level: "warn",
        fixedDailyFraction: 1 / 7,
        adaptiveDailyFraction: 0.14,
        safeLeftTodayFraction: 0.07,
        todayUsedFraction: 0.15,
        todayLowerBound: true,
        unobservedFraction: 0.1,
        projectedExhaustionAt: 1900,
        slices: [
          {
            index: 0,
            startAt: 1000,
            endAt: 1142,
            state: "past",
            usedFraction: 0.15,
            lowerBound: false,
            budgetFraction: null,
          },
          {
            index: 1,
            startAt: 1142,
            endAt: 1285,
            state: "current",
            usedFraction: 0.15,
            lowerBound: true,
            budgetFraction: null,
          },
          {
            index: 2,
            startAt: 1285,
            endAt: 1428,
            state: "future",
            usedFraction: null,
            lowerBound: false,
            budgetFraction: 0.14,
          },
          {
            index: 3,
            startAt: 1428,
            endAt: 1571,
            state: "future",
            usedFraction: null,
            lowerBound: false,
            budgetFraction: 0.14,
          },
          {
            index: 4,
            startAt: 1571,
            endAt: 1714,
            state: "future",
            usedFraction: null,
            lowerBound: false,
            budgetFraction: 0.14,
          },
          {
            index: 5,
            startAt: 1714,
            endAt: 1857,
            state: "future",
            usedFraction: null,
            lowerBound: false,
            budgetFraction: 0.14,
          },
          {
            index: 6,
            startAt: 1857,
            endAt: 2000,
            state: "future",
            usedFraction: null,
            lowerBound: false,
            budgetFraction: 0.14,
          },
        ],
      };

      const row = renderPacingRow(mockPacing, 4);
      expect(row.className).toBe("pacing-row");

      const rowObj = row as unknown as {
        children: Array<{
          attributes: Record<string, string>;
          children: Array<{ children: unknown[] }>;
        }>;
      };
      const td = rowObj.children[0];
      expect(td.attributes.colspan).toBe("4");

      const container = td.children[0];
      const metricsDiv = container.children[0] as unknown as {
        className: string;
        children: Array<{ textContent: string }>;
      };
      expect(metricsDiv.className).toContain("level-warn");
      expect(metricsDiv.children[1].textContent).toContain("today ≥15.0%");
      expect(metricsDiv.children[1].textContent).toContain("safe left 7.0%");

      const slicesDiv = container.children[1] as unknown as {
        children: Array<{ children: Array<{ textContent: string }> }>;
      };
      // 7 slices + 1 unobserved span
      expect(slicesDiv.children.length).toBe(8);

      // Current slice (index 1) has lowerBound value
      const currentChip = slicesDiv.children[1];
      expect(currentChip.children[2].textContent).toBe("≥15%");

      // Future slice (index 2) has bracketed budget
      const futureChip = slicesDiv.children[2];
      expect(futureChip.children[2].textContent).toBe("[14%]");

      // Unobserved span
      const unobs = slicesDiv.children[7];
      expect(unobs.children).toBeDefined();
    } finally {
      restoreDoc();
    }
  });
});
