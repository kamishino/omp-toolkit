import { describe, expect, test } from "bun:test";
import { renderLimitCell } from "./limit-cell";

describe("renderer limit-cell module", () => {
  const originalDoc = globalThis.document;

  function mockDoc() {
    globalThis.document = {
      createElement: (tag: string) => {
        const el: Record<string, unknown> = {
          tagName: tag,
          className: "",
          appendChild: (c: unknown) => c,
          setAttribute: (k: string, v: string) => {
            el[k] = v;
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
    } finally {
      restoreDoc();
    }
  });
});
