import { describe, expect, test } from "bun:test";
import type { WeeklyPacing } from "@omp-toolkit/core";
import { DEFAULT_DESKTOP_SETTINGS } from "../settings";
import { isProviderCollapsed, renderProviderCard, setProviderCollapsed } from "./card";
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
      expect(card?.className).toBe("provider-card");
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
      expect(findByClass(cardObj, "account")?.title).toContain("alpha@example.com");
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

  test("provider collapsing toggles class, aria attributes, and persists to localStorage", () => {
    const memStorage = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => memStorage.get(k) ?? null,
      setItem: (k: string, v: string) => memStorage.set(k, v),
      removeItem: (k: string) => memStorage.delete(k),
      clear: () => memStorage.clear(),
      length: 0,
      key: () => null,
    } as unknown as Storage;

    expect(isProviderCollapsed("test-p")).toBe(false);
    setProviderCollapsed("test-p", true);
    expect(isProviderCollapsed("test-p")).toBe(true);
    setProviderCollapsed("test-p", false);
    expect(isProviderCollapsed("test-p")).toBe(false);
  });

  test("renderProviderCard returns null when filterScope excludes all rows", () => {
    mockDoc();
    try {
      const card = renderProviderCard(
        {
          id: "google-antigravity",
          name: "GOOGLE ANTIGRAVITY",
          suffix: "",
          accounts: 1,
          columns: [{ key: "c1", label: "Weekly" }],
          rows: [
            {
              account: "ok@example.com",
              displayAccount: "ok",
              health: "ok",
              maxUsed: 0.2,
              level: "ok",
              route: { text: "OK", level: "ok" },
              limits: [],
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
        "issues", // Filter for issues, but account is OK
      );
      expect(card).toBeNull();
    } finally {
      restoreDoc();
    }
  });

  test("renderProviderCard includes copy icon and clickable account class", () => {
    mockDoc();
    try {
      const card = renderProviderCard(
        {
          id: "google-antigravity",
          name: "GOOGLE ANTIGRAVITY",
          suffix: "",
          accounts: 1,
          columns: [{ key: "c1", label: "Weekly" }],
          rows: [
            {
              account: "dev@example.com",
              displayAccount: "dev",
              health: null,
              maxUsed: 0.1,
              level: "ok",
              route: { text: "—", level: "ok" },
              limits: [],
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
        "all",
      );
      interface MockElNode {
        className?: string;
        children?: MockElNode[];
      }
      const cardNode = card as unknown as MockElNode;
      const findByClass = (node: MockElNode | undefined, cls: string): MockElNode | undefined => {
        if (!node) return undefined;
        if (node.className?.split(" ").includes(cls)) return node;
        for (const child of node.children ?? []) {
          const hit = findByClass(child, cls);
          if (hit) return hit;
        }
        return undefined;
      };
      const accountCell = findByClass(cardNode, "account-clickable");
      expect(accountCell).toBeDefined();
      expect(findByClass(accountCell, "account-copy-icon")).toBeDefined();
    } finally {
      restoreDoc();
    }
  });

  test("renderProviderCard does not render red badge-danger in collapsed preview on non-Antigravity provider", () => {
    mockDoc();
    try {
      const card = renderProviderCard(
        {
          id: "deepseek",
          name: "DEEPSEEK",
          suffix: " · CNY",
          accounts: 1,
          columns: [{ key: "c1", label: "Balance" }],
          rows: [
            {
              account: "key@example.com",
              displayAccount: "key",
              health: null,
              maxUsed: 0,
              level: "ok",
              route: { text: "—", level: "unknown" },
              limits: [{ label: "Balance", low: false, level: "ok", remaining: 10, unit: "cny" }],
            },
          ],
        },
        true, // hasAnyRoute is true because another provider has route data
        0,
        {
          status: "loading",
          data: null,
          intervalSeconds: 300,
          warmup: { running: false, message: null },
          settings: DEFAULT_DESKTOP_SETTINGS,
        },
      );

      interface MockElNode {
        className?: string;
        children?: MockElNode[];
      }
      const cardNode = card as unknown as MockElNode;
      const findByClass = (node: MockElNode | undefined, cls: string): MockElNode | undefined => {
        if (!node) return undefined;
        if (node.className?.split(" ").includes(cls)) return node;
        for (const child of node.children ?? []) {
          const hit = findByClass(child, cls);
          if (hit) return hit;
        }
        return undefined;
      };

      // Neutral providers with no route data MUST NOT render badge-danger
      const dangerBadge = findByClass(cardNode, "badge-danger");
      expect(dangerBadge).toBeUndefined();
    } finally {
      restoreDoc();
    }
  });
});
