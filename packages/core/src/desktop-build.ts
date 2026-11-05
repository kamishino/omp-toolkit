import path from "node:path";

/**
 * Single owner of desktop build freshness knowledge (pure path data, no I/O):
 * every module that decides "is the built widget stale" — the Bun launcher's
 * rebuild check and Electron's stale refusal — watches exactly this set.
 * Repo-relative, forward slashes; join with the checkout root.
 */
export const DESKTOP_WATCH_SOURCES: readonly string[] = [
  "apps/desktop/src",
  "apps/provider-usage/src",
  "packages/core/src",
  "design/tokens.json",
  "scripts/build/build.ts",
  "scripts/build/build-tray-icons.ts",
  "scripts/tokens/color.ts",
] as const;

export function desktopWatchPaths(checkoutRoot: string): string[] {
  return DESKTOP_WATCH_SOURCES.map((rel) => path.join(checkoutRoot, ...rel.split("/")));
}

/** Files under apps/desktop/dist that every launch path requires. */
export const DESKTOP_DIST_ARTIFACTS: readonly string[] = [
  "main.cjs",
  "index.html",
  "preload.cjs",
  "renderer.js",
  "styles.css",
] as const;
