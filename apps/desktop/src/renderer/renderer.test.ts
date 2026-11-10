import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { createContext, runInContext, SourceTextModule } from "node:vm";
import type { Dashboard } from "@omp-toolkit/core";
import type { PanelState } from "../ipc";
import { DEFAULT_DESKTOP_SETTINGS } from "../settings";
import { mountPanel } from "./renderer";

type MockEvent = { key?: string; preventDefault?: () => void };

interface MockNode {
  tagName: string;
  id: string;
  className: string;
  textContent: string;
  title?: string;
  hidden: boolean;
  disabled: boolean;
  value: string;
  checked: boolean;
  open: boolean;
  tabIndex: number;
  focused: boolean;
  dataset: Record<string, string>;
  attributes: Record<string, string>;
  style: Record<string, string> & { setProperty?: (name: string, value: string) => void };
  children: MockNode[];
  appendChild(child: MockNode): MockNode;
  replaceChildren(...children: MockNode[]): void;
  remove(): void;
  setAttribute(key: string, value: string): void;
  removeAttribute(key: string): void;
  addEventListener(type: string, handler: (event: MockEvent) => void): void;
  dispatch(type: string, event?: MockEvent): void;
  click(): void;
  focus(): void;
  scrollIntoView(): void;
  querySelector(selector: string): MockNode | null;
  querySelectorAll(selector: string): MockNode[];
  classList: { toggle(name: string, force?: boolean): void };
}

function makeNode(tag: string): MockNode {
  const listeners = new Map<string, Array<(event: MockEvent) => void>>();
  const node: MockNode = {
    tagName: tag,
    id: "",
    className: "",
    textContent: "",
    hidden: false,
    disabled: false,
    value: "",
    checked: false,
    open: false,
    tabIndex: 0,
    focused: false,
    dataset: {},
    attributes: {},
    style: {},
    children: [],
    appendChild(child) {
      node.children.push(child);
      return child;
    },
    replaceChildren(...children) {
      node.children = children;
    },
    remove() {
      node.children = [];
    },
    setAttribute(key, value) {
      node.attributes[key] = value;
      if (key === "aria-expanded") node.open = value === "true";
    },
    removeAttribute(key) {
      delete node.attributes[key];
    },
    addEventListener(type, handler) {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    dispatch(type, event = {}) {
      for (const handler of listeners.get(type) ?? []) handler(event);
    },
    click() {
      node.dispatch("click");
    },
    focus() {
      node.focused = true;
      (globalThis.document as unknown as { activeElement: MockNode }).activeElement = node;
    },
    scrollIntoView() {},
    querySelector(selector) {
      return node.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      const matches: MockNode[] = [];
      const visit = (candidate: MockNode) => {
        if (selector === "details" && candidate.tagName === "details") matches.push(candidate);
        else if (selector.startsWith("#") && candidate.id === selector.slice(1)) {
          matches.push(candidate);
        } else if (selector === "[data-provider]" && candidate.dataset.provider) {
          matches.push(candidate);
        } else if (
          selector.startsWith(".") &&
          candidate.className.split(" ").includes(selector.slice(1))
        ) {
          matches.push(candidate);
        }
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

const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
const originalResizeObserver = globalThis.ResizeObserver;

afterEach(() => {
  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
  globalThis.ResizeObserver = originalResizeObserver;
});

function installDom(): MockNode {
  const documentElement = makeNode("html");
  documentElement.style.setProperty = () => {};
  globalThis.document = {
    createElement: (tag: string) => makeNode(tag),
    createElementNS: (_ns: string, tag: string) => makeNode(tag),
    createTextNode: (text: string) => {
      const node = makeNode("#text");
      node.textContent = text;
      return node;
    },
    documentElement,
    activeElement: null,
    querySelector: () => null,
    addEventListener: () => {},
  } as unknown as Document;
  globalThis.window = {
    omp: {
      refresh: () => {},
      hide: () => {},
      warmup: () => {},
      resize: () => {},
      saveSettings: async () => ({ valid: true, errors: [] }),
      onState: () => () => {},
      onOpenSettings: () => () => {},
      gatewayAction: async () => ({ success: true, message: "" }),
      gatewayConnect: async () => ({ success: false, message: "unavailable" }),
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({ paddingTop: "16", paddingBottom: "16", rowGap: "12" }),
  } as unknown as Window & typeof globalThis;
  globalThis.ResizeObserver = undefined as unknown as typeof ResizeObserver;
  return documentElement;
}

function dashboard(): Dashboard {
  return {
    fetchedAt: 1_000_000,
    providers: [
      {
        id: "google-antigravity",
        name: "GOOGLE ANTIGRAVITY",
        suffix: " · Gemini",
        accounts: 3,
        columns: [{ key: "weekly", label: "Weekly" }],
        rows: [
          {
            account: "hot@example.com",
            displayAccount: "hot",
            health: "ok",
            maxUsed: 0.75,
            level: "hot",
            route: { text: "OK", level: "ok" },
            limits: [
              {
                label: "Weekly",
                usedFraction: 0.75,
                low: false,
                level: "hot",
                resetsAt: 2_000_000,
              },
            ],
          },
          {
            account: "edge@example.com",
            displayAccount: "edge",
            health: "ok",
            maxUsed: 0.8,
            level: "hot",
            route: { text: "OK", level: "ok" },
            limits: [{ label: "Weekly", usedFraction: 0.8, low: false, level: "hot" }],
          },
          {
            account: "stale@example.com",
            displayAccount: "stale",
            health: "stale",
            maxUsed: 0.2,
            level: "ok",
            route: { text: "STALE", level: "unknown" },
            limits: [{ label: "Weekly", usedFraction: 0.2, low: false, level: "ok" }],
          },
        ],
      },
      {
        id: "deepseek",
        name: "DEEPSEEK",
        suffix: " · USD",
        accounts: 1,
        columns: [{ key: "balance", label: "Balance" }],
        rows: [
          {
            account: "low@example.com",
            displayAccount: "low",
            health: null,
            maxUsed: 0,
            level: "ok",
            route: { text: "—", level: "unknown" },
            limits: [{ label: "Balance", remaining: 2, unit: "usd", low: true, level: "critical" }],
          },
        ],
      },
    ],
    summary: {
      providers: 2,
      accounts: 4,
      above80: 1,
      maxed: 0,
      aboveThreshold: 0.8,
      tightest: {
        provider: "google-antigravity",
        account: "edge@example.com",
        usedFraction: 0.8,
      },
    },
    health: null,
    balance: null,
    tooltip: "",
    iconLevel: "hot",
  };
}

function readyState(): PanelState {
  return {
    status: "ready",
    data: dashboard(),
    intervalSeconds: 300,
    warmup: { running: false, message: null },
    settings: DEFAULT_DESKTOP_SETTINGS,
    ompBuild: {
      version: "18.18.6",
      sha256: "dfb15c27cb2ea192a94761c26aa5cd4eed54b1e0a5a85c02938ab07d769bc8f7",
      comparison: "same",
      builtInAntigravityPolicy: "documented-pause",
      healthProbesEnabled: false,
      inspectionError: null,
    },
  };
}

function mountForTest(app: MockNode, state: PanelState) {
  // Mock DOM nodes stand in for HTMLElement in this unit harness.
  return mountPanel(app as unknown as HTMLElement, state);
}

function findByClass(node: MockNode, className: string): MockNode | undefined {
  if (node.className.split(" ").includes(className)) return node;
  for (const child of node.children) {
    const hit = findByClass(child, className);
    if (hit) return hit;
  }
  return undefined;
}

function findAllByClass(node: MockNode, className: string): MockNode[] {
  const matches: MockNode[] = [];
  if (node.className.split(" ").includes(className)) matches.push(node);
  for (const child of node.children) matches.push(...findAllByClass(child, className));
  return matches;
}

describe("panel renderer", () => {
  test("mounts a tabbed, status-first shell with no gateway controls in Usage", () => {
    installDom();
    const app = makeNode("main");
    const renderer = mountForTest(app, readyState());
    const panel = findByClass(app, "panel");
    expect(panel).toBeDefined();
    expect(findByClass(app, "title")?.textContent).toBe("Provider usage");
    expect(findAllByClass(app, "panel-tab").map((tab) => tab.textContent)).toEqual([
      "Usage",
      "Gateway",
      "Settings",
    ]);
    const usagePanel = app.querySelector("#panel-view-usage");
    expect(usagePanel?.querySelector(".gw-controls")).toBeNull();
    expect(usagePanel?.querySelector(".provider-access")).toBeNull();
    expect(
      app.querySelector("#panel-view-settings")?.querySelector(".provider-access"),
    ).not.toBeNull();
    expect(findByClass(app, "footer-link")?.textContent).toBe("Provider access");
    renderer.destroy();
  });

  test("filters use one threshold and triage predicate", () => {
    installDom();
    const app = makeNode("main");
    const renderer = mountForTest(app, readyState());
    const chips = findAllByClass(app, "metric-chip");
    const labels = chips.map((chip) => ({
      label: chip.children.find((child) => child.className === "chip-label")?.textContent,
      count: chip.children.find((child) => child.className === "chip-count")?.textContent,
    }));
    expect(labels).toEqual([
      { label: "All", count: "(4)" },
      { label: "High usage", count: "(1)" },
      { label: "Needs attention", count: "(2)" },
    ]);

    const highUsage = chips.find(
      (chip) =>
        chip.children.find((child) => child.className === "chip-label")?.textContent ===
        "High usage",
    );
    highUsage?.click();
    const accountNames = findAllByClass(app, "account-name").map((node) => node.textContent);
    expect(accountNames).toEqual(["edge"]);
    renderer.destroy();
  });

  test("tab keyboard navigation selects Gateway and keeps hidden views hidden", () => {
    installDom();
    const app = makeNode("main");
    const renderer = mountForTest(app, readyState());
    const usageTab = findAllByClass(app, "panel-tab")[0];
    usageTab.dispatch("keydown", {
      key: "ArrowRight",
      preventDefault: () => {},
    });
    expect(usageTab.attributes["aria-selected"]).toBe("false");
    const gatewayPanel = app.querySelector("#panel-view-gateway");
    const usagePanel = app.querySelector("#panel-view-usage");
    expect(gatewayPanel?.hidden).toBe(false);
    expect(usagePanel?.hidden).toBe(true);
    renderer.destroy();
  });

  test("provider access entry opens Settings and expands the read-only guide", () => {
    installDom();
    const app = makeNode("main");
    const renderer = mountForTest(app, readyState());
    findByClass(app, "footer-link")?.click();
    const settingsTab = findAllByClass(app, "panel-tab")[2];
    expect(settingsTab.attributes["aria-selected"]).toBe("true");
    const details = app.querySelector("details");
    expect(details?.open).toBe(true);
    expect(findByClass(app, "provider-access-title")?.focused).toBe(true);
    expect(findByClass(app, "provider-access-body")).toBeDefined();
    renderer.destroy();
  });

  test("background state updates preserve an edited Settings draft", () => {
    installDom();
    const app = makeNode("main");
    const renderer = mountForTest(app, readyState());
    findAllByClass(app, "panel-tab")[2].click();
    const interval = app.querySelector("#setting-interval");
    if (!interval) throw new Error("interval input missing");
    interval.value = "45";
    interval.dispatch("input", {});

    const next = readyState();
    next.settings = { ...DEFAULT_DESKTOP_SETTINGS, intervalSeconds: 120 };
    renderer.update(next);

    expect(interval.value).toBe("45");
    renderer.destroy();
  });
});

describe("browser bundle", () => {
  test("mounts the tabbed shell and applies state without Node globals", async () => {
    const buildConfig = {
      entrypoints: [path.join(import.meta.dir, "renderer.ts")],
      target: "browser" as const,
      format: "esm" as const,
      write: false,
    };
    const build = await Bun.build(buildConfig);
    if (!build.success) {
      throw new Error(build.logs.map((log) => log.message).join("\n"));
    }
    const artifact = build.outputs.find((output) => output.path.endsWith(".js"));
    if (!artifact) throw new Error("renderer build produced no JavaScript output");

    const app = makeNode("main");
    const documentElement = makeNode("html");
    documentElement.style.setProperty = () => {};
    const stateListeners: Array<(state: unknown) => void> = [];
    const context = createContext({
      document: {
        documentElement,
        createElement: (tag: string) => makeNode(tag),
        createElementNS: (_ns: string, tag: string) => makeNode(tag),
        createTextNode: (text: string) => {
          const node = makeNode("#text");
          node.textContent = text;
          return node;
        },
        querySelector: (selector: string) => (selector === "#app" ? app : null),
        addEventListener: () => {},
        activeElement: null,
      },
      window: {
        matchMedia: () => ({ matches: false, addEventListener: () => {} }),
        addEventListener: () => {},
        removeEventListener: () => {},
        setTimeout: () => 0,
        clearTimeout: () => {},
        getComputedStyle: () => ({ paddingTop: "16", paddingBottom: "16", rowGap: "12" }),
        omp: {
          onState: (callback: (state: unknown) => void) => {
            stateListeners.push(callback);
            return () => {};
          },
          onOpenSettings: () => () => {},
          resize: () => {},
        },
      },
      crypto: globalThis.crypto,
      console,
      localStorage: { getItem: () => null, setItem: () => {} },
    });

    expect(runInContext("typeof Buffer", context)).toBe("undefined");
    expect(runInContext("typeof process", context)).toBe("undefined");
    const module = new SourceTextModule(await artifact.text(), {
      context,
      identifier: "renderer.js",
    });
    await module.link(() => {
      throw new Error("renderer bundle must not import");
    });
    await module.evaluate({ timeout: 2_000 });

    expect(findAllByClass(app, "panel-tab")).toHaveLength(3);
    expect(stateListeners).toHaveLength(1);
    stateListeners[0](readyState());
    expect(findAllByClass(app, "metric-chip")).toHaveLength(3);
    expect(app.querySelector("#panel-view-usage")?.querySelector(".provider-access")).toBeNull();
  });
});
