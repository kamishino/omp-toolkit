import { afterEach, describe, expect, test } from "bun:test";
import type { GatewayActionResult, PanelState } from "../ipc";
import { DEFAULT_DESKTOP_SETTINGS } from "../settings";
import { createGatewayView } from "./gateway-view";

interface MockNode {
  tagName: string;
  id: string;
  className: string;
  textContent: string;
  hidden: boolean;
  disabled: boolean;
  value: string;
  dataset: Record<string, string>;
  attributes: Record<string, string>;
  children: MockNode[];
  focused: boolean;
  appendChild(child: MockNode): MockNode;
  replaceChildren(...children: MockNode[]): void;
  setAttribute(key: string, value: string): void;
  addEventListener(type: string, handler: () => void): void;
  click(): void;
  focus(): void;
  remove(): void;
  classList: {
    add(name: string): void;
    remove(name: string): void;
    toggle(name: string, force?: boolean): void;
  };
}

function makeNode(tag: string): MockNode {
  const listeners = new Map<string, Array<() => void>>();
  const node: MockNode = {
    tagName: tag,
    id: "",
    className: "",
    textContent: "",
    hidden: false,
    disabled: false,
    value: "",
    dataset: {},
    attributes: {},
    children: [],
    focused: false,
    appendChild(child) {
      node.children.push(child);
      return child;
    },
    replaceChildren(...children) {
      node.children = children;
    },
    setAttribute(key, value) {
      node.attributes[key] = value;
    },
    addEventListener(type, handler) {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    click() {
      for (const handler of listeners.get("click") ?? []) handler();
    },
    focus() {
      node.focused = true;
    },
    remove() {
      node.children = [];
    },
    classList: {
      add(name) {
        const set = new Set(node.className.split(" ").filter(Boolean));
        set.add(name);
        node.className = [...set].join(" ");
      },
      remove(name) {
        const set = new Set(node.className.split(" ").filter(Boolean));
        set.delete(name);
        node.className = [...set].join(" ");
      },
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

function findById(node: MockNode, id: string): MockNode | undefined {
  if (node.id === id) return node;
  for (const child of node.children) {
    const hit = findById(child, id);
    if (hit) return hit;
  }
  return undefined;
}

const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
const originalNavigator = globalThis.navigator;
const originalLocalStorage = globalThis.localStorage;

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
  globalThis.window = {} as unknown as Window & typeof globalThis;
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
  } as unknown as Storage;
}

afterEach(() => {
  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
  globalThis.navigator = originalNavigator;
  globalThis.localStorage = originalLocalStorage;
});

function state(state: "active" | "off" | "error" | "unknown"): PanelState {
  return {
    status: "ready",
    data: {
      fetchedAt: 1000,
      providers: [],
      summary: {
        providers: 0,
        accounts: 0,
        above80: 0,
        maxed: 0,
        aboveThreshold: 0.8,
        tightest: null,
      },
      health: null,
      balance: null,
      tooltip: "",
      iconLevel: "ok",
    },
    intervalSeconds: 300,
    warmup: { running: false, message: null },
    settings: DEFAULT_DESKTOP_SETTINGS,
    gateway:
      state === "unknown"
        ? undefined
        : {
            state,
            label: state === "active" ? "Gateway: Active (:4000)" : `Gateway: ${state}`,
            endpoint: "127.0.0.1:4000",
            modelCount: 4,
            antigravityModelCount: 2,
            clientCount: 1,
            checkedAt: 1000,
          },
  };
}

describe("createGatewayView", () => {
  test("unknown status is reported as not checked, not perpetually probing", () => {
    installDom();
    const controller = createGatewayView(state("unknown"), () => {});
    const label = findByClass(controller.element as unknown as MockNode, "gw-state");
    expect(label?.textContent).toBe("Not checked");
  });

  test("stop requires confirmation and cancel dispatches nothing", () => {
    installDom();
    const calls: string[] = [];
    (globalThis.window as unknown as { omp: unknown }).omp = {
      gatewayAction: async (action: string) => {
        calls.push(action);
        return { success: true, message: "" } satisfies GatewayActionResult;
      },
    };
    const controller = createGatewayView(state("active"), () => {});
    const root = controller.element as unknown as MockNode;
    const stopButtons = collect(root).filter((node) => node.dataset.action === "stop");
    expect(stopButtons).toHaveLength(1);
    stopButtons[0].click();
    const confirmation = findByClass(root, "gw-confirmation");
    expect(confirmation?.hidden).toBe(false);
    expect(collect(root).find((node) => node.textContent === "Cancel")?.focused).toBe(true);
    expect(calls).toEqual([]);

    collect(root)
      .find((node) => node.textContent === "Cancel")
      ?.click();
    expect(confirmation?.hidden).toBe(true);
    expect(calls).toEqual([]);
  });

  test("confirm dispatches one lifecycle action even with repeated clicks", async () => {
    installDom();
    let resolveAction: (result: GatewayActionResult) => void = () => {};
    let calls = 0;
    (globalThis.window as unknown as { omp: unknown }).omp = {
      gatewayAction: (action: string) => {
        calls += 1;
        expect(action).toBe("restart");
        return new Promise<GatewayActionResult>((resolve) => {
          resolveAction = resolve;
        });
      },
    };
    const controller = createGatewayView(state("active"), () => {});
    const root = controller.element as unknown as MockNode;

    collect(root)
      .find((node) => node.dataset.action === "restart")
      ?.click();
    const confirm = collect(root).find((node) => node.textContent === "Restart gateway");
    confirm?.click();
    confirm?.click();

    expect(calls).toBe(1);
    resolveAction({ success: true, message: "" });
    for (
      let tick = 0;
      tick < 10 && collect(root).some((node) => node.dataset.action === "restart" && node.disabled);
      tick += 1
    ) {
      await Promise.resolve();
    }
    expect(findByClass(root, "gw-confirmation")?.hidden).toBe(true);
    expect(
      collect(root)
        .filter((node) => node.dataset.action === "restart")
        .every((node) => !node.disabled),
    ).toBe(true);
  });

  test("failure permits a deliberate retry after pending clears", async () => {
    installDom();
    let calls = 0;
    (globalThis.window as unknown as { omp: unknown }).omp = {
      gatewayAction: async () => {
        calls += 1;
        return { success: false, message: "not running" };
      },
    };
    const controller = createGatewayView(state("active"), () => {});
    const root = controller.element as unknown as MockNode;

    collect(root)
      .find((node) => node.dataset.action === "stop")
      ?.click();
    collect(root)
      .find((node) => node.textContent === "Stop gateway")
      ?.click();
    for (
      let tick = 0;
      tick < 10 && collect(root).some((node) => node.dataset.action === "stop" && node.disabled);
      tick += 1
    ) {
      await Promise.resolve();
    }

    collect(root)
      .find((node) => node.dataset.action === "stop")
      ?.click();
    collect(root)
      .find((node) => node.textContent === "Stop gateway")
      ?.click();
    expect(calls).toBe(2);
  });

  test("keeps drawer state and recipe selection across updates", () => {
    installDom();
    const controller = createGatewayView(state("active"), () => {});
    const root = controller.element as unknown as MockNode;
    findByClass(root, "gw-toggle-btn")?.click();
    const select = findById(root, "gw-recipe-select");
    if (!select) throw new Error("recipe select missing");
    select.value = "cursor";
    expect(findByClass(root, "gw-drawer")?.hidden).toBe(false);
    expect(select.attributes.id ?? select.id).toBe("gw-recipe-select");

    controller.update(state("off"));
    expect(findById(root, "gw-recipe-select")).toBe(select);
    expect(select.value).toBe("cursor");
    expect(findByClass(root, "gw-drawer")?.hidden).toBe(false);
  });
});

function collect(root: MockNode): MockNode[] {
  return [root, ...root.children.flatMap((child) => collect(child))];
}
