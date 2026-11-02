import fs from "node:fs";
import path from "node:path";

function newestMtime(entry: string): { mtimeMs: number; file: string } {
  if (!fs.existsSync(entry)) return { mtimeMs: 0, file: entry };
  const stat = fs.statSync(entry);
  if (!stat.isDirectory()) return { mtimeMs: stat.mtimeMs, file: entry };
  // Files only: directory mtimes change on any child add/remove and would
  // mask the actual newest source file.
  let best = { mtimeMs: 0, file: entry };
  for (const child of fs.readdirSync(entry)) {
    const candidate = newestMtime(path.join(entry, child));
    if (candidate.mtimeMs > best.mtimeMs) best = candidate;
  }
  return best;
}

/**
 * Dist-freshness guard (roadmap D02): returns the offending source file when
 * the built dist is missing or older than the newest watched source, else
 * null. Mirrors the launcher's buildIfNeeded watch set so any entry point
 * (direct Electron, shortcut, login item) refuses silent stale UI. When no
 * source path exists (bundled install without a checkout), returns null.
 */
export function findStaleDist(distMainPath: string, sourcePaths: string[]): string | null {
  const existingSources = sourcePaths.filter((p) => fs.existsSync(p));
  if (existingSources.length === 0) return null;

  if (!fs.existsSync(distMainPath)) return distMainPath;

  const distMtime = fs.statSync(distMainPath).mtimeMs;
  let newest = { mtimeMs: 0, file: "" };
  for (const source of existingSources) {
    const candidate = newestMtime(source);
    if (candidate.mtimeMs > newest.mtimeMs) newest = candidate;
  }
  return newest.mtimeMs > distMtime ? newest.file : null;
}

/** Source paths the desktop dist is built from, relative to the checkout. */
export function desktopSourcePaths(appPath: string, checkoutRoot: string): string[] {
  return [
    path.join(appPath, "src"),
    path.join(checkoutRoot, "packages", "core", "src"),
    path.join(checkoutRoot, "design", "tokens.json"),
  ];
}
