import { describe, expect, test } from "bun:test";
import path from "node:path";
import { DESKTOP_DIST_ARTIFACTS, DESKTOP_WATCH_SOURCES, desktopWatchPaths } from "./desktop-build";

describe("desktop build freshness knowledge", () => {
  test("watch set covers sources, tokens, and build inputs; no dead paths", () => {
    expect(DESKTOP_WATCH_SOURCES).toContain("apps/desktop/src");
    expect(DESKTOP_WATCH_SOURCES).toContain("packages/core/src");
    expect(DESKTOP_WATCH_SOURCES).toContain("design/tokens.json");
    expect(DESKTOP_WATCH_SOURCES).not.toContain("scripts/build.ts");
  });

  test("provider-usage sources invalidate the widget build", () => {
    const paths = desktopWatchPaths("/repo");
    expect(paths).toContain(path.join("/repo", "apps", "provider-usage", "src"));
  });

  test("watch paths join under the checkout root", () => {
    const paths = desktopWatchPaths("/repo");
    expect(paths).toHaveLength(DESKTOP_WATCH_SOURCES.length);
    expect(paths[0]).toBe(path.join("/repo", "apps", "desktop", "src"));
  });

  test("dist artifacts are the five launch-required files", () => {
    expect([...DESKTOP_DIST_ARTIFACTS].sort()).toEqual(
      ["index.html", "main.cjs", "preload.cjs", "renderer.js", "styles.css"].sort(),
    );
  });
});
