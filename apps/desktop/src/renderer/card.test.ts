import { describe, expect, test } from "bun:test";
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
          appendChild: (c: unknown) => c,
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
});
