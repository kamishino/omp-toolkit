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

  test("footer offers a visible Settings action from first paint", async () => {
    mockDoc();
    const { buildPanel } = await import("./renderer");
    const panel = buildPanel({
      status: "ready",
      data: dashboardWith({}),
      intervalSeconds: 300,
      warmup: { running: false, message: null },
      settings: DEFAULT_DESKTOP_SETTINGS,
    } as never) as unknown as MockNode;
    const action = findByClass(panel, "footer-settings");
    expect(action).toBeDefined();
    expect(action?.textContent).toBe("Settings");
  });

  test("settings shortcut is Ctrl/Cmd+comma only", async () => {
    mockDoc();
    const { isSettingsShortcut } = await import("./renderer");
    expect(isSettingsShortcut({ key: ",", ctrlKey: true })).toBe(true);
    expect(isSettingsShortcut({ key: ",", metaKey: true })).toBe(true);
    expect(isSettingsShortcut({ key: "," })).toBe(false);
    expect(isSettingsShortcut({ key: ".", ctrlKey: true })).toBe(false);
  });

  test("gateway strip shows active state with model, client, and pool figures", async () => {
    mockDoc();
    const { buildGatewayStrip } = await import("./renderer");
    const strip = buildGatewayStrip({
      status: "ready",
      data: dashboardWith({
        providers: [
          {
            id: "google-antigravity",
            name: "GOOGLE ANTIGRAVITY",
            suffix: "",
            accounts: 2,
            columns: [],
            rows: [{}, {}],
          },
        ],
      }),
      intervalSeconds: 300,
      warmup: { running: false, message: null },
      settings: DEFAULT_DESKTOP_SETTINGS,
      gateway: {
        state: "active",
        label: "Gateway: Active (:4000)",
        endpoint: "127.0.0.1:4000",
        modelCount: 25,
        antigravityModelCount: 12,
        clientCount: 2,
        checkedAt: 1,
      },
    } as never) as unknown as MockNode;
    expect(strip.attributes["data-state"]).toBe("active");
    expect(findByClass(strip, "gw-state")?.textContent).toBe("Active");
    expect(findByClass(strip, "gw-meta")?.textContent).toContain("25 models · 12 Antigravity");
    expect(findByClass(strip, "gw-meta")?.textContent).toContain("2 clients");
    expect(findByClass(strip, "gw-pool-num")?.textContent).toBe("2/2");
  });

  test("gateway strip off state tells the operator how to start it", async () => {
    mockDoc();
    const { buildGatewayStrip } = await import("./renderer");
    const strip = buildGatewayStrip({
      status: "ready",
      data: dashboardWith({}),
      intervalSeconds: 300,
      warmup: { running: false, message: null },
      settings: DEFAULT_DESKTOP_SETTINGS,
      gateway: {
        state: "off",
        label: "Gateway: Off",
        endpoint: "127.0.0.1:4000",
        modelCount: null,
        antigravityModelCount: null,
        clientCount: null,
        checkedAt: 1,
      },
    } as never) as unknown as MockNode;
    expect(findByClass(strip, "gw-state")?.textContent).toBe("Off");
    expect(findByClass(strip, "gw-meta")?.textContent).toContain("gateway:ctl start");
    expect(findByClass(strip, "gw-pool")).toBeUndefined();
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

  test("header renders interactive summary metric chips for active dashboard", async () => {
    mockDoc();
    // Dynamic import required: renderer.ts initializes themeManager on document at module evaluation time
    const { buildPanel } = await import("./renderer");
    const panel = buildPanel({
      status: "ready",
      data: dashboardWith({
        providers: [
          {
            id: "google-antigravity",
            name: "GOOGLE ANTIGRAVITY",
            suffix: "",
            accounts: 2,
            columns: [],
            rows: [
              {
                account: "a@x.com",
                displayAccount: "a",
                health: "ok",
                maxUsed: 0.1,
                level: "ok",
                route: { text: "OK", level: "ok" },
                limits: [],
              },
              {
                account: "b@x.com",
                displayAccount: "b",
                health: "hang",
                maxUsed: 0.9,
                level: "hot",
                route: { text: "HANG", level: "danger" },
                limits: [],
              },
            ],
          },
        ],
      }),
      intervalSeconds: 300,
      warmup: { running: false, message: null },
      settings: DEFAULT_DESKTOP_SETTINGS,
    } as never) as unknown as MockNode;

    const chips = findByClass(panel, "summary-chips");
    expect(chips).toBeDefined();
    expect(chips?.attributes.role).toBe("toolbar");
    const metricChips = chips?.children.filter((c) => c.className?.includes("metric-chip")) ?? [];
    expect(metricChips.length).toBe(4);
  });

  test("gateway strip renders action controls and supports drawer persistence", async () => {
    mockDoc();
    // Dynamic import required: renderer.ts initializes themeManager on document at module evaluation time
    const { buildGatewayStrip, isGatewayDrawerOpen, setGatewayDrawerOpen } = await import(
      "./renderer"
    );

    const memStorage = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => memStorage.get(k) ?? null,
      setItem: (k: string, v: string) => memStorage.set(k, v),
      removeItem: (k: string) => memStorage.delete(k),
      clear: () => memStorage.clear(),
      length: 0,
      key: () => null,
    } as unknown as Storage;

    expect(isGatewayDrawerOpen()).toBe(false);
    setGatewayDrawerOpen(true);
    expect(isGatewayDrawerOpen()).toBe(true);
    setGatewayDrawerOpen(false);

    const strip = buildGatewayStrip({
      status: "ready",
      data: dashboardWith({}),
      intervalSeconds: 300,
      warmup: { running: false, message: null },
      settings: DEFAULT_DESKTOP_SETTINGS,
      gateway: {
        state: "off",
        label: "Gateway: Off",
        endpoint: "127.0.0.1:4000",
        modelCount: null,
        antigravityModelCount: null,
        clientCount: null,
        checkedAt: 1,
      },
    } as never) as unknown as MockNode;

    const controls = findByClass(strip, "gw-controls");
    expect(controls).toBeDefined();
    expect(findByClass(controls as MockNode, "gw-action-btn")).toBeDefined();
    expect(findByClass(controls as MockNode, "gw-toggle-btn")).toBeDefined();
  });
});
