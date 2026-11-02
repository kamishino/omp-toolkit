import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { recordLaunchFailure } from "../../apps/desktop/src/launch-failure";
import { DESKTOP_DIST_ARTIFACTS, desktopWatchPaths } from "../../packages/core/src/desktop-build";
import { resolveAgentDir } from "../../packages/core/src/environment";
import { buildDesktop } from "../build/build";

const root = path.resolve(import.meta.dir, "../..");
const appDir = path.join(root, "apps", "desktop");
const distDir = path.join(appDir, "dist");
const distMain = path.join(distDir, "main.cjs");
const requiredArtifacts = DESKTOP_DIST_ARTIFACTS.map((file) => path.join(distDir, file));

function getNewestMtime(entry: string): number {
  if (!fs.existsSync(entry)) return 0;
  const stat = fs.statSync(entry);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let max = stat.mtimeMs;
  for (const child of fs.readdirSync(entry)) {
    const childMtime = getNewestMtime(path.join(entry, child));
    if (childMtime > max) max = childMtime;
  }
  return max;
}

export async function buildIfNeeded(): Promise<void> {
  const watchPaths = desktopWatchPaths(root);

  let newest = 0;
  for (const p of watchPaths) {
    const mtime = getNewestMtime(p);
    if (mtime > newest) newest = mtime;
  }

  const allArtifactsExist = requiredArtifacts.every((file) => fs.existsSync(file));
  if (!allArtifactsExist || fs.statSync(distMain).mtimeMs < newest) {
    await buildDesktop();
  }
}

export function findElectron(): string {
  const req = createRequire(path.join(appDir, "package.json"));
  let electronExecutable: unknown;
  try {
    electronExecutable = req("electron");
  } catch {
    electronExecutable = null;
  }

  if (typeof electronExecutable !== "string" || !fs.existsSync(electronExecutable)) {
    throw new Error("Electron is not installed. Run 'bun install' in the project root.");
  }

  return electronExecutable;
}

type SpawnFn = typeof spawn;

/**
 * Launch Electron detached so the launcher can exit immediately:
 * no console host, no signal forwarding, tray survives terminal close.
 * Resolves once the child has spawned; rejects if it fails to start.
 */
export async function launchDetached(
  spawnFn: SpawnFn,
  electronBin: string,
  appDir: string,
  argv: string[],
): Promise<void> {
  const child = spawnFn(electronBin, [appDir, ...argv], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  await new Promise<void>((resolve, reject) => {
    child.on("spawn", resolve);
    child.on("error", reject);
  });
  child.unref();
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (argv.includes("--once")) {
    const child = spawn(process.execPath, [path.join(appDir, "src", "once.ts"), ...argv], {
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      process.exit(code ?? 1);
    });
    return;
  }

  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    const message =
      "The desktop widget needs a graphical session; use bun run monitor in a terminal.";
    recordLaunchFailure(resolveAgentDir(), new Error(message));
    console.error(message);
    process.exit(1);
  }

  await buildIfNeeded();
  const electronBin = findElectron();

  await launchDetached(spawn, electronBin, appDir, argv);
}

if (import.meta.main) {
  main().catch((err) => {
    recordLaunchFailure(resolveAgentDir(), err);
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
