import { afterEach, describe, expect, test } from "bun:test";
import type { DashboardProvider, DashboardRow } from "@omp-toolkit/core";
import type { PanelState } from "../ipc";
import { DEFAULT_DESKTOP_SETTINGS } from "../settings";
import {
  isProviderCollapsed,
  matchesFilter,
  renderProviderCard,
  setProviderCollapsed,
} from "./card";

interface MockNode {
  tagName: string;
  className: string;
  textContent: string;
  title?: string;
  hidden?: boolean;
  disabled?: boolean;
  dataset: Record<string, string>;
  attributes: Record<string, string>;
  children: MockNode[];
  appendChild: (child: MockNode) => MockNode;
  replaceChildren: (...children: MockNode[]) => void;
  setAttribute: (key: string, value: string) => void;
  addEventListener: (type: string, handler: () => void) => void;
  click: () => void;
  querySelectorAll: (selector: string) => MockNode[];
  classList: { toggle(name: string, force?: boolean): void };
}

function makeNode(tag: string): MockNode {
  const listeners = new Map<string, Array<() => void>>();
  const node: MockNode = {
    tagName: tag,
    className: "",
    textContent: "",
    dataset: {},
    attributes: {},
    children: [],
    appendChild: (child) => {
      node.children.push(child);
      return child;
    },
    replaceChildren: (...children) => {
      node.children = children;
    },
    setAttribute: (key, value) => {
      node.attributes[key] = value;
    },
    addEventListener: (type, handler) => {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    click: () => {
      for (const handler of listeners.get("click") ?? []) handler();
    },
    querySelectorAll: (selector) => {
      const className = selector.replace(/^\./, "");
      const matches: MockNode[] = [];
      const visit = (candidate: MockNode) => {
        if (candidate.className.split(" ").includes(className)) matches.push(candidate);
        for (const child of candidate.children) visit(child);
      };
      visit(node);
      return matches;
    },
    classList: {
      toggle(name, force) {
        const set = new Set(node.className.split(" ").filter(Boolean));
        const shouldAdd = force ?? !set.has(name);
        if (shouldAdd) set.add(name);
        else set.delete(name);
        node.className = [...set].join(" ");
      },
    },
  };
  return node;
}

function findByClass(node: MockNode, className: string): MockNode | undefined {
  if (node.className.split(" ").includes(className)) return node;
  for (const child of node.children) {
    const hit = findByClass(child, className);
    if (hit) return hit;
  }
  return undefined;
}

function findByTag(node: MockNode, tagName: string): MockNode | undefined {
  if (node.tagName === tagName) return node;
  for (const child of node.children) {
    const hit = findByTag(child, tagName);
    if (hit) return hit;
  }
  return undefined;
}

const originalDocument = globalThis.document;
const originalNavigator = globalThis.navigator;

function installDom(): void {
  globalThis.document = {
    createElement: (tag: string) => makeNode(tag),
    createElementNS: (_ns: string, tag: string) => makeNode(tag),
    createTextNode: (text: string) => {
      const node = makeNode("#text");
      node.textContent = text;
      return node;
    },
  } as unknown as Document;
}

afterEach(() => {
  globalThis.document = originalDocument;
  globalThis.navigator = originalNavigator;
});

function row(overrides: Partial<DashboardRow> = {}): DashboardRow {
  return {
    account: "alpha@example.com",
    displayAccount: "alpha",
    health: null,
    maxUsed: 0.2,
    level: "ok",
    route: { text: "—", level: "unknown" },
    limits: [],
    ...overrides,
  };
}

function provider(rows: DashboardRow[]): DashboardProvider {
  return {
    id: "google-antigravity",
    name: "GOOGLE ANTIGRAVITY",
    suffix: " · Gemini",
    accounts: rows.length,
    columns: [{ key: "weekly", label: "Weekly" }],
    rows,
  };
}

function state(): PanelState {
  return {
    status: "loading",
    data: null,
    intervalSeconds: 300,
    warmup: { running: false, message: null },
    settings: DEFAULT_DESKTOP_SETTINGS,
  };
}

describe("renderer filter predicate", () => {
  test("high usage follows the configured threshold, not the severity color", () => {
    const hotButUnder = row({ maxUsed: 0.75, level: "hot" });
    const atThreshold = row({ maxUsed: 0.8, level: "hot" });
    expect(matchesFilter(hotButUnder, "high-usage", 0.8)).toBe(false);
    expect(matchesFilter(atThreshold, "high-usage", 0.8)).toBe(true);
    expect(matchesFilter(hotButUnder, "attention", 0.8)).toBe(false);
  });

  test("attention includes critical quota, low balance, and non-OK route evidence", () => {
    expect(matchesFilter(row({ level: "critical" }), "attention", 0.8)).toBe(true);
    expect(
      matchesFilter(
        row({ limits: [{ label: "Balance", remaining: 2, unit: "usd", low: true, level: "ok" }] }),
        "attention",
        0.8,
      ),
    ).toBe(true);
    expect(matchesFilter(row({ health: "stale" }), "attention", 0.8)).toBe(true);
    expect(matchesFilter(row({ health: "ok" }), "attention", 0.8)).toBe(false);
  });
});

describe("renderProviderCard", () => {
  test("keeps all-row summaries visible and shows filtered visibility", () => {
    installDom();
    const rows = [row({ maxUsed: 0.2 }), row({ account: "beta@example.com", maxUsed: 0.95 })];
    const card = renderProviderCard(provider(rows), 0.8, 0, state(), "high-usage");
    if (!card) throw new Error("card missing");

    const cardNode = card as unknown as MockNode;
    const summary = findByClass(cardNode, "provider-summary");
    expect(summary?.children.map((child) => child.textContent)).toEqual([
      "2 accounts",
      "95.0% max",
      "showing 1 of 2",
    ]);
    expect(findByClass(cardNode, "provider-title")?.textContent).toBe(
      "GOOGLE ANTIGRAVITY · Gemini",
    );
    const tbody = findByTag(cardNode, "tbody");
    expect(tbody?.children).toHaveLength(1);
  });

  test("adds a route column only when that provider has route evidence", () => {
    installDom();
    const withRoute = renderProviderCard(
      provider([row({ health: "ok", route: { text: "OK", level: "ok" } })]),
      0.8,
      0,
      state(),
    );
    const withoutRoute = renderProviderCard(
      provider([row({ health: null, route: { text: "—", level: "unknown" } })]),
      0.8,
      1,
      state(),
    );
    expect(findByClass(withRoute as unknown as MockNode, "col-route")).toBeDefined();
    expect(findByClass(withoutRoute as unknown as MockNode, "col-route")).toBeUndefined();
  });

  test("collapsing keeps a keyboard-operable disclosure state and hides the table", () => {
    installDom();
    const card = renderProviderCard(provider([row()]), 0.8, 0, state());
    if (!card) throw new Error("card missing");
    const cardNode = card as unknown as MockNode;
    const toggle = findByClass(cardNode, "card-toggle-btn");
    const table = findByTag(cardNode, "table");
    expect(toggle?.attributes["aria-expanded"]).toBe("true");
    expect(table?.hidden).toBe(false);

    toggle?.click();
    expect(toggle?.attributes["aria-expanded"]).toBe("false");
    expect(table?.hidden).toBe(true);
  });

  test("copy control is labeled and reports completion", async () => {
    installDom();
    const written: string[] = [];
    globalThis.navigator = {
      clipboard: {
        writeText: async (text: string) => {
          written.push(text);
        },
      },
    } as unknown as Navigator;
    const card = renderProviderCard(provider([row()]), 0.8, 0, state());
    if (!card) throw new Error("card missing");
    const cardNode = card as unknown as MockNode;
    const copy = findByClass(cardNode, "account-copy");
    expect(copy?.attributes["aria-label"]).toBe("Copy account alpha@example.com");
    copy?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(written).toEqual(["alpha@example.com"]);
  });

  test("bulk warm-up describes all provider rows even under an active filter", () => {
    installDom();
    const rows = [row({ maxUsed: 0.9 }), row({ account: "beta@example.com", maxUsed: 0.1 })];
    const card = renderProviderCard(provider(rows), 0.8, 0, state(), "high-usage");
    if (!card) throw new Error("card missing");
    const warmAll = findByClass(card as unknown as MockNode, "provider-action");
    expect(warmAll?.title).toContain("2 eligible");
    expect(warmAll?.title).toContain("all accounts");
  });

  test("returns null only when an active filter excludes every row", () => {
    installDom();
    expect(
      renderProviderCard(provider([row({ maxUsed: 0.1 })]), 0.8, 0, state(), "high-usage"),
    ).toBe(null);
    expect(renderProviderCard(provider([row()]), 0.8, 0, state())).not.toBeNull();
  });

  test("collapse preference round-trips through local storage", () => {
    const storage = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    } as unknown as Storage;
    expect(isProviderCollapsed("p1")).toBe(false);
    setProviderCollapsed("p1", true);
    expect(isProviderCollapsed("p1")).toBe(true);
    setProviderCollapsed("p1", false);
    expect(isProviderCollapsed("p1")).toBe(false);
  });
});
