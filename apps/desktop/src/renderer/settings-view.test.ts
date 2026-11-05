import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_DESKTOP_SETTINGS, type DesktopSettings } from "../settings";
import { renderSettingsView } from "./settings-view";

interface MockElement {
  tagName: string;
  id: string;
  className: string;
  textContent: string;
  style: Record<string, string>;
  value: string;
  checked: boolean;
  disabled: boolean;
  htmlFor: string;
  children: MockElement[];
  appendChild(child: MockElement): MockElement;
  setAttribute(key: string, value: string): void;
  addEventListener(type: string, handler: (event: unknown) => void): void;
  removeEventListener(type: string, handler: (event: unknown) => void): void;
  dispatch(type: string, event: unknown): void;
}

function createMockElement(tagName: string): MockElement {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const el: MockElement = {
    tagName,
    id: "",
    className: "",
    textContent: "",
    style: {},
    value: "",
    checked: false,
    disabled: false,
    htmlFor: "",
    children: [],
    appendChild(child) {
      el.children.push(child);
      return child;
    },
    setAttribute() {},
    addEventListener(type, handler) {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    removeEventListener(type, handler) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((candidate) => candidate !== handler),
      );
    },
    dispatch(type, event) {
      for (const handler of listeners.get(type) ?? []) handler(event);
    },
  };
  return el;
}

function findByTag(root: MockElement, tagName: string): MockElement | undefined {
  if (root.tagName === tagName) return root;
  for (const child of root.children) {
    const found = findByTag(child, tagName);
    if (found) return found;
  }
  return undefined;
}

function findById(root: MockElement, id: string): MockElement | undefined {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findById(child, id);
    if (found) return found;
  }
  return undefined;
}

describe("renderSettingsView account ordering", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  function installDom(): void {
    globalThis.document = {
      createElement: (tag: string) => createMockElement(tag),
      documentElement: { dataset: {}, style: { setProperty() {} } },
    } as unknown as Document;
    globalThis.window = {
      addEventListener() {},
      removeEventListener() {},
    } as unknown as Window & typeof globalThis;
  }

  afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  });

  test("renders both sort options and reflects the current setting", () => {
    installDom();
    const controller = renderSettingsView(
      DEFAULT_DESKTOP_SETTINGS,
      () => {},
      () => {},
    );

    const select = findById(controller.element as unknown as MockElement, "setting-account-sort");
    expect(select?.tagName).toBe("select");
    expect(select?.value).toBe("weekly-reset");
    expect(select?.children.map((option) => option.value)).toEqual([
      "weekly-reset",
      "weekly-usage",
    ]);
    expect(select?.children[1]?.textContent).toBe("Weekly Quota Usage (highest first)");
  });

  test("submits the chosen order", () => {
    installDom();
    let saved: DesktopSettings | undefined;
    const controller = renderSettingsView(
      DEFAULT_DESKTOP_SETTINGS,
      (settings) => {
        saved = settings;
      },
      () => {},
    );

    const root = controller.element as unknown as MockElement;
    const select = findById(root, "setting-account-sort");
    const form = findByTag(root, "form");
    if (!select || !form) throw new Error("settings form not rendered");

    select.value = "weekly-usage";
    form.dispatch("submit", { preventDefault() {} });

    expect(saved?.accountSort).toBe("weekly-usage");
  });
});
