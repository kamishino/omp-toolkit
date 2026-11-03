import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  checkoutProbePath,
  compareTemplateToLive,
  isValidTemplateName,
  resolveCheckoutCandidates,
  resolveTemplatesDir,
  TEMPLATE_LIVE_FILES,
  templateFileName,
  templateMatchesLive,
} from "./templates";

describe("core templates module", () => {
  test("isValidTemplateName validates slug names strictly", () => {
    // Valid slugs: 1-64 chars [a-z0-9-_], starting with letter or digit
    expect(isValidTemplateName("work")).toBe(true);
    expect(isValidTemplateName("deepseek-1")).toBe(true);
    expect(isValidTemplateName("a_b")).toBe(true);
    expect(isValidTemplateName("1")).toBe(true);
    expect(isValidTemplateName("a".repeat(64))).toBe(true);

    // Invalid names
    expect(isValidTemplateName("")).toBe(false);
    expect(isValidTemplateName("Work")).toBe(false);
    expect(isValidTemplateName("-x")).toBe(false);
    expect(isValidTemplateName("_x")).toBe(false);
    expect(isValidTemplateName("a b")).toBe(false);
    expect(isValidTemplateName("../x")).toBe(false);
    expect(isValidTemplateName("a/b")).toBe(false);
    expect(isValidTemplateName("a\\b")).toBe(false);
    expect(isValidTemplateName("a".repeat(65))).toBe(false);
  });

  test("templateFileName maps live file names to inert template file names", () => {
    expect(templateFileName("AGENTS.md")).toBe("AGENTS.template.md");
    expect(templateFileName("RULES.md")).toBe("RULES.template.md");
  });

  test("resolveTemplatesDir constructs expected path", () => {
    const root = path.join("fake", "repo");
    expect(resolveTemplatesDir(root)).toBe(path.join(root, "templates"));
  });

  test("checkoutProbePath points to scripts/monitor/orca-monitor.ts", () => {
    const root = path.join("fake", "repo");
    expect(checkoutProbePath(root)).toBe(path.join(root, "scripts", "monitor", "orca-monitor.ts"));
  });

  test("resolveCheckoutCandidates orders env, cwd ancestors, and home clone without duplicates", () => {
    const fakeHome = path.resolve(path.join("fake", "home"));
    const fakeEnv = path.resolve(path.join("fake", "custom", "env-toolkit"));
    const cwd = path.resolve(path.join("fake", "work", "nested", "subproject"));

    const candidates = resolveCheckoutCandidates({ OMP_TOOLKIT_HOME: fakeEnv }, cwd, fakeHome);

    // 1st: OMP_TOOLKIT_HOME
    expect(candidates[0]).toBe(fakeEnv);

    // 2nd...: cwd ancestors nearest-first
    expect(candidates[1]).toBe(cwd);
    expect(candidates[2]).toBe(path.dirname(cwd));
    expect(candidates[3]).toBe(path.dirname(path.dirname(cwd)));

    // Last: fakeHome/.omp/omp-toolkit
    const expectedHomeClone = path.resolve(path.join(fakeHome, ".omp", "omp-toolkit"));
    expect(candidates[candidates.length - 1]).toBe(expectedHomeClone);
  });

  test("resolveCheckoutCandidates skips blank env and de-duplicates home clone if cwd hits it", () => {
    const fakeHome = path.resolve(path.join("fake", "home"));
    const homeClone = path.resolve(path.join(fakeHome, ".omp", "omp-toolkit"));

    const candidates = resolveCheckoutCandidates({ OMP_TOOLKIT_HOME: "   " }, homeClone, fakeHome);

    // Blank env skipped
    expect(candidates.includes("   ")).toBe(false);

    // homeClone is the cwd, so when candidates walk up and then append homeClone,
    // homeClone should only appear ONCE in the de-duplicated array.
    const occurrences = candidates.filter((c) => c === homeClone).length;
    expect(occurrences).toBe(1);
  });

  test("compareTemplateToLive covers all 4 combinations and matchesLive behavior", () => {
    expect(TEMPLATE_LIVE_FILES).toEqual(["AGENTS.md", "RULES.md"]);

    // Both identical (both present with equal contents)
    const t1 = { "AGENTS.md": "a", "RULES.md": "r" };
    const l1 = { "AGENTS.md": "a", "RULES.md": "r" };
    const comp1 = compareTemplateToLive(t1, l1);
    expect(comp1).toEqual([
      { file: "AGENTS.md", inTemplate: true, liveExists: true, identical: true },
      { file: "RULES.md", inTemplate: true, liveExists: true, identical: true },
    ]);
    expect(templateMatchesLive(t1, l1)).toBe(true);

    // Both missing => identical is true
    const tEmpty = {};
    const lEmpty = {};
    const compEmpty = compareTemplateToLive(tEmpty, lEmpty);
    expect(compEmpty).toEqual([
      { file: "AGENTS.md", inTemplate: false, liveExists: false, identical: true },
      { file: "RULES.md", inTemplate: false, liveExists: false, identical: true },
    ]);
    expect(templateMatchesLive(tEmpty, lEmpty)).toBe(true);

    // One in template missing live, one present both differing
    const t2 = { "AGENTS.md": "a-temp", "RULES.md": "r-same" };
    const l2 = { "RULES.md": "r-diff" };
    const comp2 = compareTemplateToLive(t2, l2);
    expect(comp2).toEqual([
      { file: "AGENTS.md", inTemplate: true, liveExists: false, identical: false },
      { file: "RULES.md", inTemplate: true, liveExists: true, identical: false },
    ]);
    expect(templateMatchesLive(t2, l2)).toBe(false);

    // One missing in template but present live
    const t3 = { "RULES.md": "r" };
    const l3 = { "AGENTS.md": "live-only", "RULES.md": "r" };
    const comp3 = compareTemplateToLive(t3, l3);
    expect(comp3).toEqual([
      { file: "AGENTS.md", inTemplate: false, liveExists: true, identical: false },
      { file: "RULES.md", inTemplate: true, liveExists: true, identical: true },
    ]);
    expect(templateMatchesLive(t3, l3)).toBe(false);
  });
});
