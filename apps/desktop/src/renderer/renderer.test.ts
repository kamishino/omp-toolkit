import { describe, expect, test } from "bun:test";
import { DEFAULT_DESKTOP_SETTINGS } from "../settings";

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
  addEventListener: () => void;
}

function makeNode(tag: string): MockNode {
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
    addEventListener: () => {},
  };
  return el;
}

function mockDoc(): void {
  globalThis.document = {
    documentElement: { dataset: {}, style: { setProperty: () => {} } },
    createElement: (tag: string) => makeNode(tag) as unknown as HTMLElement,
    createElementNS: (_ns: string, tag: string) => makeNode(tag) as unknown as HTMLElement,
    createTextNode: (txt: string) => ({ textContent: txt }) as unknown as Text,
    querySelector: () => null,
  } as unknown as Document;
}

function findByClass(node: MockNode, cls: string): MockNode | undefined {
  if (node.className?.split(" ").includes(cls)) return node;
  for (const child of node.children ?? []) {
    const hit = findByClass(child as MockNode, cls);
    if (hit) return hit;
  }
  return undefined;
}

function dashboardWith(overrides: Record<string, unknown>): never {
  return {
    fetchedAt: Date.now(),
    providers: [
      {
        id: "google-antigravity",
        name: "GOOGLE ANTIGRAVITY",
        suffix: " · Gemini",
        accounts: 0,
        columns: [],
        rows: [],
      },
    ],
    summary: {
      providers: 1,
      accounts: 0,
      above80: 0,
      maxed: 0,
      aboveThreshold: 0.8,
      tightest: null,
    },
    health: null,
    balance: null,
    tooltip: "OMP: no usage data",
    iconLevel: "unknown",
    ...overrides,
  } as never;
}

describe("renderer panel", () => {
  test("fresh incident is announced in the panel; stale incident is not", async () => {
    mockDoc();
    const { buildPanel } = await import("./renderer");
    const now = Date.now();
    const fresh = buildPanel({
      status: "ready",
      data: dashboardWith({
        health: {
          checkedAt: now - 600_000,
          ageMs: 600_000,
          stale: false,
          incident: {
            id: "inc-1",
            at: now - 600_000,
            kind: "all-failed",
            detail: "all accounts failed to respond",
          },
        },
      }),
      intervalSeconds: 300,
      warmup: { running: false, message: null },
      settings: DEFAULT_DESKTOP_SETTINGS,
    } as never) as unknown as MockNode;

    const banner = findByClass(fresh, "incident-banner");
    expect(banner).toBeDefined();
    expect(banner?.attributes.role).toBe("alert");
    expect(banner?.textContent ?? banner?.children.map((c) => c.textContent).join(" ")).toContain(
      "all-failed",
    );

    const stale = buildPanel({
      status: "ready",
      data: dashboardWith({
        health: {
          checkedAt: now - 25 * 3_600_000,
          ageMs: 25 * 3_600_000,
          stale: true,
          incident: { id: "inc-old", at: now - 25 * 3_600_000, kind: "all-failed", detail: "old" },
        },
      }),
      intervalSeconds: 300,
      warmup: { running: false, message: null },
      settings: DEFAULT_DESKTOP_SETTINGS,
    } as never) as unknown as MockNode;
    expect(findByClass(stale, "incident-banner")).toBeUndefined();
  });

  test("zero providers shows guidance instead of a blank panel", async () => {
    mockDoc();
    const { buildPanel } = await import("./renderer");
    const panel = buildPanel({
      status: "ready",
      data: dashboardWith({ providers: [] }),
      intervalSeconds: 300,
      warmup: { running: false, message: null },
      settings: DEFAULT_DESKTOP_SETTINGS,
    } as never) as unknown as MockNode;
    const empty = findByClass(panel, "empty-message");
    expect(empty?.textContent).toContain("No providers");
  });
});
