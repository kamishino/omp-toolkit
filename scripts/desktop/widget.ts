import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { buildDesktop } from "../build/build";

const root = path.resolve(import.meta.dir, "../..");
const appDir = path.join(root, "apps", "desktop");
const distDir = path.join(appDir, "dist");
const distMain = path.join(distDir, "main.cjs");
const distHtml = path.join(distDir, "index.html");
const distPreload = path.join(distDir, "preload.cjs");
const distRenderer = path.join(distDir, "renderer.js");
const distStyles = path.join(distDir, "styles.css");
const requiredArtifacts = [distMain, distHtml, distPreload, distRenderer, distStyles];

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
  const watchPaths = [
    path.join(appDir, "src"),
    path.join(root, "packages", "core", "src"),
    path.join(root, "design", "tokens.json"),
    path.join(root, "scripts", "build", "build.ts"),
    path.join(root, "scripts", "build", "build-tray-icons.ts"),
    path.join(root, "scripts", "tokens", "color.ts"),
    path.join(root, "scripts", "build.ts"),
  ];

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
    console.error(
      "The desktop widget needs a graphical session; use bun run monitor in a terminal.",
    );
    process.exit(1);
  }

  await buildIfNeeded();
  const electronBin = findElectron();

  const child = spawn(electronBin, [appDir, ...argv], { stdio: "inherit" });

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      child.kill(sig);
    });
  }

  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
