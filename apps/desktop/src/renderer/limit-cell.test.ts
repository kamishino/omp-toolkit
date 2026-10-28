import { describe, expect, test } from "bun:test";
import type { WeeklyPacing } from "@omp-toolkit/core";
import { renderLimitCell } from "./limit-cell";

describe("renderer limit-cell module", () => {
  const originalDoc = globalThis.document;

  interface MockNode {
    tagName: string;
    className: string;
    textContent?: string;
    title?: string;
    attributes: Record<string, string>;
    style: Record<string, string>;
    children: MockNode[];
    appendChild: (c: unknown) => unknown;
    setAttribute: (k: string, v: string) => void;
  }

  function mockDoc() {
    globalThis.document = {
      createElement: (tag: string) => {
        const el: MockNode = {
          tagName: tag,
          className: "",
          attributes: {},
          style: {},
          children: [],
          appendChild: (c: unknown) => {
            el.children.push(c as MockNode);
            return c;
          },
          setAttribute: (k: string, v: string) => {
            el.attributes[k] = v;
          },
        };
        return el as unknown as HTMLElement;
      },
    } as unknown as Document;
  }

  function restoreDoc() {
    globalThis.document = originalDoc;
  }

  test("renderLimitCell creates cell with currency", () => {
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

  test("renderLimitCell creates cell with percentage and progress bar", () => {
    mockDoc();
    try {
      const cell = renderLimitCell({
        label: "Weekly",
        usedFraction: 0.75,
        resetsAt: Date.now() + 10000,
        low: false,
        level: "hot",
      });
      expect(cell).toBeDefined();
      expect(cell.className).toBe("col-limit");
    } finally {
      restoreDoc();
    }
  });

  test("renderLimitCell creates empty cell when usedFraction is undefined", () => {
    mockDoc();
    try {
      const cell = renderLimitCell({
        label: "Custom",
        low: false,
        level: "unknown",
      });
      expect(cell).toBeDefined();
      expect(cell.className).toBe("col-limit");
      const cellNode = cell as unknown as MockNode;
      const container = cellNode.children[0];
      const emptySpan = container.children.find((c) => c.className === "level-unknown");
      expect(emptySpan).toBeDefined();
      expect(emptySpan?.textContent).toBe("—");
    } finally {
      restoreDoc();
    }
  });

  test("renderLimitCell renders custom bar with tick and 30/43% for pacing limit", () => {
    mockDoc();
    try {
      const cell = renderLimitCell({
        label: "Weekly",
        usedFraction: 0.3,
        resetsAt: Date.now() + 10000,
        low: false,
        level: "ok",
        pacing: {
          dayIndex: 2,
          todayCeilingFraction: 3 / 7,
          headroomFraction: 3 / 7 - 0.3,
        } as unknown as WeeklyPacing,
      });

      const cellNode = cell as unknown as MockNode;
      const container = cellNode.children[0];

      // Native progress must not be rendered
      expect(container.children.some((c) => c.tagName === "progress")).toBe(false);

      // Custom bar wrapper
      const barWrap = container.children.find((c) => c.className.includes("limit-bar-wrap"));
      expect(barWrap).toBeDefined();
      expect(barWrap?.attributes.role).toBe("progressbar");
      expect(barWrap?.attributes["aria-valuenow"]).toBe("30");

      // Tick present at ceiling (3/7 ≈ 42.857%)
      const tick = barWrap?.children.find((c) => c.className === "limit-bar-tick");
      expect(tick).toBeDefined();
      expect(tick?.style.left).toContain("42.857");

      // Percent span formatted as used/ceiling%
      const pctSpan = container.children.find((c) => c.className.includes("percent"));
      expect(pctSpan?.textContent).toBe("30/43%");

      // No stray empty dash child
      expect(container.children.some((c) => c.textContent === "—")).toBe(false);
    } finally {
      restoreDoc();
    }
  });

  test("renderLimitCell renders over-ceiling fill segment when used > ceiling", () => {
    mockDoc();
    try {
      const cell = renderLimitCell({
        label: "Weekly",
        usedFraction: 0.3,
        resetsAt: Date.now() + 10000,
        low: false,
        level: "critical",
        pacing: {
          dayIndex: 0,
          todayCeilingFraction: 1 / 7,
          headroomFraction: 1 / 7 - 0.3,
        } as unknown as WeeklyPacing,
      });

      const cellNode = cell as unknown as MockNode;
      const container = cellNode.children[0];
      const barWrap = container.children.find((c) => c.className.includes("limit-bar-wrap"));
      const track = barWrap?.children.find((c) => c.className === "limit-bar-track");
      const overFill = track?.children.find((c) => c.className === "limit-bar-over");
      expect(overFill).toBeDefined();
      expect(overFill?.style.left).toContain("14.285");
      expect(overFill?.style.width).toContain("15.714");
    } finally {
      restoreDoc();
    }
  });

  test("renderLimitCell omits tick on Day 7 when ceiling is 100%", () => {
    mockDoc();
    try {
      const cell = renderLimitCell({
        label: "Weekly",
        usedFraction: 0.92,
        resetsAt: Date.now() + 10000,
        low: false,
        level: "ok",
        pacing: {
          dayIndex: 6,
          todayCeilingFraction: 1.0,
          headroomFraction: 0.08,
        } as unknown as WeeklyPacing,
      });

      const cellNode = cell as unknown as MockNode;
      const container = cellNode.children[0];
      const barWrap = container.children.find((c) => c.className.includes("limit-bar-wrap"));
      const tick = barWrap?.children.find((c) => c.className === "limit-bar-tick");
      expect(tick).toBeUndefined();

      const pctSpan = container.children.find((c) => c.className.includes("percent"));
      expect(pctSpan?.textContent).toBe("92/100%");
    } finally {
      restoreDoc();
    }
  });
});
