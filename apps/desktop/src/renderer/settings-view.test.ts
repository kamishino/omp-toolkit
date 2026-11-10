import { afterEach, describe, expect, test } from "bun:test";
import type { SettingsSaveResult } from "../ipc";
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
  hidden: boolean;
  htmlFor: string;
  name: string;
  type: string;
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
    hidden: false,
    htmlFor: "",
    name: "",
    type: "",
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

function findClass(root: MockElement, className: string): MockElement | undefined {
  if (root.className.split(" ").includes(className)) return root;
  for (const child of root.children) {
    const found = findClass(child, className);
    if (found) return found;
  }
  return undefined;
}

function findRadio(root: MockElement, value: string): MockElement | undefined {
  if (root.type === "radio" && root.value === value) return root;
  for (const child of root.children) {
    const found = findRadio(child, value);
    if (found) return found;
  }
  return undefined;
}

describe("renderSettingsView", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  function installDom(): { dataset: Record<string, string> } {
    const documentElement = {
      dataset: {} as Record<string, string>,
      style: { setProperty() {} },
    };
    globalThis.document = {
      createElement: (tag: string) => createMockElement(tag),
      documentElement,
    } as unknown as Document;
    globalThis.window = {
      addEventListener() {},
      removeEventListener() {},
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    } as unknown as Window & typeof globalThis;
    return documentElement;
  }

  afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  });

  test("renders the account-order options", () => {
    installDom();
    const controller = renderSettingsView(
      DEFAULT_DESKTOP_SETTINGS,
      async () => ({ valid: true, errors: [] }),
      () => {},
    );
    const select = findById(controller.element as unknown as MockElement, "setting-account-sort");
    expect(select?.value).toBe("weekly-reset");
    expect(select?.children.map((option) => option.value)).toEqual([
      "weekly-reset",
      "weekly-usage",
    ]);
  });

  test("keeps dirty edits while untouched fields follow persisted updates", () => {
    const documentElement = installDom();
    let settings: DesktopSettings = DEFAULT_DESKTOP_SETTINGS;
    const controller = renderSettingsView(
      settings,
      async () => ({ valid: true, errors: [] }),
      () => {},
    );
    const root = controller.element as unknown as MockElement;
    const interval = findById(root, "setting-interval");
    if (!interval) throw new Error("interval input missing");

    interval.value = "45";
    interval.dispatch("input", {});
    const darkRadio = findRadio(root, "dark");
    if (!darkRadio) throw new Error("dark theme radio missing");
    darkRadio.checked = true;
    darkRadio.dispatch("change", {});
    expect(documentElement.dataset.theme).toBe("dark");

    settings = { ...settings, intervalSeconds: 120, theme: "light" };
    controller.syncSettings(settings);

    expect(interval.value).toBe("45");
    expect(findRadio(root, "dark")?.checked).toBe(true);
    expect(documentElement.dataset.theme).toBe("dark");
  });

  test("awaits save acknowledgment and reports invalid results without closing", async () => {
    installDom();
    let resolveSave: (result: SettingsSaveResult) => void = () => {};
    let savePromise: Promise<SettingsSaveResult> = Promise.resolve({ valid: true, errors: [] });
    let closed = 0;
    const controller = renderSettingsView(
      DEFAULT_DESKTOP_SETTINGS,
      () => {
        savePromise = new Promise<SettingsSaveResult>((resolve) => {
          resolveSave = resolve;
        });
        return savePromise;
      },
      () => {
        closed += 1;
      },
    );
    const root = controller.element as unknown as MockElement;
    const form = findByTag(root, "form");
    const interval = findById(root, "setting-interval");
    if (!form || !interval) throw new Error("settings form missing");
    interval.value = "120";
    interval.dispatch("input", {});
    form.dispatch("submit", { preventDefault() {} });

    expect(interval.disabled).toBe(true);
    expect(closed).toBe(0);

    resolveSave({ valid: false, errors: ["Nope"] });
    await savePromise;
    for (let tick = 0; tick < 10 && interval.disabled; tick += 1) {
      await Promise.resolve();
    }

    expect(interval.disabled).toBe(false);
    expect(closed).toBe(0);
    expect(findClass(root, "form-errors")?.hidden).toBe(false);
  });

  test("closes only after a valid acknowledged save", async () => {
    installDom();
    let closed = 0;
    let saved: DesktopSettings | undefined;
    let savePromise: Promise<SettingsSaveResult> = Promise.resolve({ valid: true, errors: [] });
    const controller = renderSettingsView(
      DEFAULT_DESKTOP_SETTINGS,
      (settings) => {
        saved = settings;
        savePromise = Promise.resolve({ valid: true, errors: [] });
        return savePromise;
      },
      () => {
        closed += 1;
      },
    );
    const root = controller.element as unknown as MockElement;
    const form = findByTag(root, "form");
    const interval = findById(root, "setting-interval");
    if (!form || !interval) throw new Error("settings form missing");
    interval.value = "120";
    interval.dispatch("input", {});
    form.dispatch("submit", { preventDefault() {} });

    await savePromise;
    for (let tick = 0; tick < 10 && closed === 0; tick += 1) {
      await Promise.resolve();
    }

    expect(saved?.intervalSeconds).toBe(120);
    expect(closed).toBe(1);
  });

  test("cancel restores the latest persisted theme", () => {
    const documentElement = installDom();
    let closed = 0;
    const controller = renderSettingsView(
      { ...DEFAULT_DESKTOP_SETTINGS, theme: "dark" },
      async () => ({ valid: true, errors: [] }),
      () => {
        closed += 1;
      },
    );
    documentElement.dataset.theme = "dark";
    const lightRadio = findRadio(controller.element as unknown as MockElement, "light");
    if (!lightRadio) throw new Error("light theme radio missing");
    lightRadio.checked = true;
    lightRadio.dispatch("change", {});
    expect(documentElement.dataset.theme).toBe("light");

    const actions = controller.actions as unknown as MockElement;
    actions.children.find((child) => child.textContent === "Cancel")?.dispatch("click", {});

    expect(documentElement.dataset.theme).toBe("dark");
    expect(closed).toBe(1);
  });
});
