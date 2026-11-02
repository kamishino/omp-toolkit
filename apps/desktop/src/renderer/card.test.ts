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
          style: {},
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

  test("account cell reveals the full account and route badge explains itself", () => {
    mockDoc();
    try {
      const card = renderProviderCard(
        {
          id: "google-antigravity",
          name: "GOOGLE ANTIGRAVITY",
          suffix: " · Gemini",
          accounts: 1,
          columns: [{ key: "c1", label: "Weekly" }],
          rows: [
            {
              account: "alpha@example.com",
              displayAccount: "alpha",
              health: "hang",
              maxUsed: 0.2,
              level: "ok",
              route: { text: "HANG", level: "critical" },
              limits: [{ label: "Weekly", low: false, level: "ok", usedFraction: 0.2 }],
            },
          ],
        },
        true,
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
        title?: string;
        children: MockNode[];
      }
      const findByClass = (node: MockNode, cls: string): MockNode | undefined => {
        if (node.className?.split(" ").includes(cls)) return node;
        for (const child of node.children ?? []) {
          const hit = findByClass(child, cls);
          if (hit) return hit;
        }
        return undefined;
      };
      const cardObj = card as unknown as MockNode;
      expect(findByClass(cardObj, "account")?.title).toBe("alpha@example.com");
      expect(findByClass(cardObj, "route")?.title).toContain("stalled");
    } finally {
      restoreDoc();
    }
  });

  test("unknown provider renders a letter badge instead of an empty slot", () => {
    mockDoc();
    try {
      const card = renderProviderCard(
        {
          id: "unknown-provider",
          name: "UNKNOWN PROVIDER",
          suffix: "",
          accounts: 1,
          columns: [{ key: "c1", label: "Weekly" }],
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
      interface MockNode {
        tagName: string;
        className: string;
        textContent?: string;
        children: MockNode[];
      }
      const find = (node: MockNode, cls: string): MockNode | undefined => {
        if (node.className?.split(" ").includes(cls)) return node;
        for (const child of node.children ?? []) {
          const hit = find(child, cls);
          if (hit) return hit;
        }
        return undefined;
      };
      const badge = find(card as unknown as MockNode, "provider-logo-fallback");
      expect(badge).toBeDefined();
      expect(badge?.textContent).toBe("U");
    } finally {
      restoreDoc();
    }
  });

  test("renderProviderCard renders single row without sub-row when limit carries pacing", () => {
    mockDoc();
    try {
      const pacingStub: WeeklyPacing = {
        dayIndex: 1,
        todayCeilingFraction: 2 / 7,
        headroomFraction: 2 / 7 - 0.2,
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
      // Exactly 1 row — no pacing sub-row
      expect(rows.length).toBe(1);
      expect(rows.some((r) => r.className.includes("pacing-row"))).toBe(false);
    } finally {
      restoreDoc();
    }
  });
});
