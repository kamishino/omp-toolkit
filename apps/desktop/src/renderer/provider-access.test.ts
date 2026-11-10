import { afterEach, describe, expect, test } from "bun:test";
import { OMP_VERSION_CHECKPOINT, type OmpBuildView, type PanelState } from "../ipc";
import { DEFAULT_DESKTOP_SETTINGS } from "../settings";
import { buildProviderAccessSection, providerAccessSummary } from "./provider-access";

interface MockNode {
  tagName: string;
  id: string;
  className: string;
  textContent: string;
  open: boolean;
  tabIndex: number;
  focused: boolean;
  attributes: Record<string, string>;
  children: MockNode[];
  appendChild(child: MockNode): MockNode;
  setAttribute(key: string, value: string): void;
  addEventListener(type: string, handler: () => void): void;
  dispatch(type: string): void;
  focus(): void;
  classList: { add(name: string): void; remove(name: string): void };
}

function makeNode(tag: string): MockNode {
  const listeners = new Map<string, Array<() => void>>();
  const node: MockNode = {
    tagName: tag,
    id: "",
    className: "",
    textContent: "",
    open: false,
    tabIndex: 0,
    focused: false,
    attributes: {},
    children: [],
    appendChild(child) {
      node.children.push(child);
      return child;
    },
    setAttribute(key, value) {
      node.attributes[key] = value;
    },
    dispatch(type) {
      for (const handler of listeners.get(type) ?? []) handler();
    },
    addEventListener(type, handler) {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    focus() {
      node.focused = true;
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
    },
  };
  return node;
}

function findAll(node: MockNode, className: string): MockNode[] {
  const matches: MockNode[] = [];
  const visit = (candidate: MockNode) => {
    if (candidate.className.split(" ").includes(className)) matches.push(candidate);
    for (const child of candidate.children) visit(child);
  };
  visit(node);
  return matches;
}

function find(node: MockNode, className: string): MockNode | undefined {
  return findAll(node, className)[0];
}

const originalDocument = globalThis.document;

afterEach(() => {
  globalThis.document = originalDocument;
});

function installDom(): void {
  globalThis.document = {
    createElement: (tag: string) => makeNode(tag),
    createTextNode: (text: string) => {
      const node = makeNode("#text");
      node.textContent = text;
      return node;
    },
  } as unknown as Document;
}

function build(policy: "documented-pause" | "unverified"): OmpBuildView {
  return {
    version: policy === "documented-pause" ? "18.18.6" : "18.18.7",
    sha256: policy === "documented-pause" ? OMP_VERSION_CHECKPOINT.sha256 : "0".repeat(64),
    comparison: policy === "documented-pause" ? "same" : "changed",
    builtInAntigravityPolicy: policy,
    healthProbesEnabled: false,
    inspectionError: null,
  };
}

function state(ompBuild?: OmpBuildView): PanelState {
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
    ompBuild,
  };
}

describe("provider access", () => {
  test("summarizes the known and unverified build states distinctly", () => {
    expect(providerAccessSummary(build("documented-pause"))).toContain("safety pause");
    expect(providerAccessSummary(build("unverified"))).toContain("unverified");
    expect(providerAccessSummary(undefined)).toContain("unavailable");
  });

  test("keeps the checkpoint, reason, and manual setup read-only for the documented build", () => {
    installDom();
    const section = buildProviderAccessSection(state(build("documented-pause")), false, () => {});
    const text = JSON.stringify(section);
    expect(text).toContain("Paused by this OMP build");
    expect(text).toContain(OMP_VERSION_CHECKPOINT.reason);
    expect(text).toContain(OMP_VERSION_CHECKPOINT.sha256);
    expect(text).toContain("google-gemini-cli");
    expect(text).toContain("GEMINI_HEALTH_ENABLED=1");
    expect(text).toContain("Not implemented here");
    expect(text).not.toContain("Run");
  });

  test("does not present a changed build as definitely paused", () => {
    installDom();
    const section = buildProviderAccessSection(state(build("unverified")), false, () => {});
    const text = JSON.stringify(section);
    expect(text).toContain("Unverified for this OMP build");
    expect(text).not.toContain("Paused by this OMP build");
    expect(text).toContain("Changed since checkpoint");
  });

  test("reports unavailable build evidence without inventing a policy", () => {
    installDom();
    const section = buildProviderAccessSection(state(undefined), false, () => {});
    expect(find(section as unknown as MockNode, "provider-access-summary")?.textContent).toContain(
      "unavailable",
    );
    expect(JSON.stringify(section)).not.toContain("Paused by this OMP build");
  });

  test("reports disclosure changes", () => {
    installDom();
    const changes: boolean[] = [];
    const section = buildProviderAccessSection(state(build("documented-pause")), false, (open) =>
      changes.push(open),
    );
    const details = find(section as unknown as MockNode, "provider-access-details");
    if (!details) throw new Error("details missing");
    expect(details.open).toBe(false);
    details.open = true;
    details.dispatch("toggle");
    expect(changes).toEqual([true]);
  });
});
