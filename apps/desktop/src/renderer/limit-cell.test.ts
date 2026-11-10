import { afterEach, describe, expect, test } from "bun:test";
import type { WeeklyPacing } from "@omp-toolkit/core";
import { renderLimitCell } from "./limit-cell";

interface MockNode {
  tagName: string;
  className: string;
  textContent: string;
  title?: string;
  attributes: Record<string, string>;
  style: Record<string, string>;
  children: MockNode[];
  appendChild: (child: MockNode) => MockNode;
  setAttribute: (key: string, value: string) => void;
}

function node(tag: string): MockNode {
  const created: MockNode = {
    tagName: tag,
    className: "",
    textContent: "",
    attributes: {},
    style: {},
    children: [],
    appendChild: (child) => {
      created.children.push(child);
      return child;
    },
    setAttribute: (key, value) => {
      created.attributes[key] = value;
    },
  };
  return created;
}

const originalDocument = globalThis.document;

function installDom(): void {
  globalThis.document = {
    createElement: (tag: string) => node(tag),
  } as unknown as Document;
}

afterEach(() => {
  globalThis.document = originalDocument;
});

function findAll(root: MockNode, className: string): MockNode[] {
  const matches: MockNode[] = [];
  const visit = (candidate: MockNode) => {
    if (candidate.className.split(" ").includes(className)) matches.push(candidate);
    for (const child of candidate.children) visit(child);
  };
  visit(root);
  return matches;
}

function findByTag(root: MockNode, tagName: string): MockNode | undefined {
  if (root.tagName === tagName) return root;
  for (const child of root.children) {
    const match = findByTag(child, tagName);
    if (match) return match;
  }
  return undefined;
}

describe("renderLimitCell", () => {
  test("currency limits state that the amount is remaining balance", () => {
    installDom();
    const cell = renderLimitCell({
      label: "Balance",
      unit: "usd",
      remaining: 4.5,
      low: true,
      level: "critical",
    }) as unknown as MockNode;

    expect(findAll(cell, "money")[0]?.textContent).toBe("$4.50");
    expect(findAll(cell, "limit-context")[0]?.textContent).toBe("remaining");
    expect(findAll(cell, "low")[0]?.textContent).toBe("LOW");
  });

  test("fraction limits label used percentage and reset countdown", () => {
    installDom();
    const cell = renderLimitCell({
      label: "Weekly",
      low: false,
      level: "hot",
      usedFraction: 0.75,
      resetsAt: Date.now() + 3_600_000,
    }) as unknown as MockNode;

    expect(findAll(cell, "percent")[0]?.textContent).toBe("75% used");
    expect(findAll(cell, "reset")[0]?.textContent).toStartWith("resets ");
    const progress = findByTag(cell, "progress");
    expect(progress?.attributes["aria-label"]).toContain("75.0% used");
  });

  test("pacing labels the used share and today's ceiling separately", () => {
    installDom();
    const pacing: WeeklyPacing = {
      dayIndex: 1,
      todayCeilingFraction: 0.43,
      headroomFraction: 0.13,
    };
    const cell = renderLimitCell({
      label: "Weekly",
      low: false,
      level: "ok",
      usedFraction: 0.3,
      resetsAt: Date.now() + 2 * 86_400_000,
      pacing,
    }) as unknown as MockNode;

    expect(findAll(cell, "percent")[0]?.textContent).toBe("30% used");
    expect(findAll(cell, "limit-context")[0]?.textContent).toBe("43% max today");
    expect(findAll(cell, "reset")[0]?.textContent).toStartWith("resets ");
    expect(findAll(cell, "limit-bar-fill")[0]?.style.width).toBe("30%");
    expect(findAll(cell, "limit-bar-tick")).toHaveLength(1);
  });

  test("over-ceiling pacing retains the overfill segment", () => {
    installDom();
    const pacing: WeeklyPacing = {
      dayIndex: 3,
      todayCeilingFraction: 0.4,
      headroomFraction: -0.1,
    };
    const cell = renderLimitCell({
      label: "Weekly",
      low: false,
      level: "hot",
      usedFraction: 0.5,
      pacing,
    }) as unknown as MockNode;

    expect(findAll(cell, "limit-bar-over")).toHaveLength(1);
    expect(findAll(cell, "limit-bar-tick")).toHaveLength(1);
  });

  test("unknown limits remain an explicit dash", () => {
    installDom();
    const cell = renderLimitCell({
      label: "Weekly",
      low: false,
      level: "unknown",
    }) as unknown as MockNode;
    expect(findAll(cell, "level-unknown")[0]?.textContent).toBe("—");
  });
});
