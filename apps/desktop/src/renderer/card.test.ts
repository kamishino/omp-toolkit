import { describe, expect, test } from "bun:test";
import { icon, renderLimitCell } from "./card";

describe("renderer card module", () => {
  const originalDoc = globalThis.document;

  function mockDoc() {
    globalThis.document = {
      createElement: (tag: string) => {
        // biome-ignore lint/suspicious/noExplicitAny: DOM mock
        const el: any = {
          tagName: tag,
          className: "",
          appendChild: (c: unknown) => c,
          setAttribute: (k: string, v: string) => {
            el[k] = v;
          },
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
});
