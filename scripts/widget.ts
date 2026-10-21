import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { buildDesktop } from "./build-desktop";

const root = path.resolve(import.meta.dir, "..");
const appDir = path.join(root, "apps", "desktop");
const distMain = path.join(appDir, "dist", "main.cjs");

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

async function buildIfNeeded(): Promise<void> {
  const watchPaths = [
    path.join(appDir, "src"),
    path.join(root, "packages", "core", "src"),
    path.join(root, "design", "tokens.json"),
    path.join(root, "scripts", "build-desktop.ts"),
    path.join(root, "scripts", "build-tray-icons.ts"),
    path.join(root, "scripts", "oklch.ts"),
  ];

  let newest = 0;
  for (const p of watchPaths) {
    const mtime = getNewestMtime(p);
    if (mtime > newest) newest = mtime;
  }

  if (!fs.existsSync(distMain) || fs.statSync(distMain).mtimeMs < newest) {
    await buildDesktop();
  }
}

function findElectron(): string {
  const req = createRequire(path.join(appDir, "package.json"));
  let electronExecutable: unknown;
  try {
    electronExecutable = req("electron");
  } catch {
    console.error('Electron is not installed. Run "bun install".');
    process.exit(1);
  }

  if (typeof electronExecutable !== "string" || !fs.existsSync(electronExecutable)) {
    console.error(
      'Electron binary is missing. Run "bun install" without ELECTRON_SKIP_BINARY_DOWNLOAD.',
    );
    process.exit(1);
  }

  return electronExecutable;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--once")) {
    const child = spawn(process.execPath, [path.join(appDir, "src", "once.ts"), ...args], {
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

  const child = spawn(electronBin, [appDir, ...args], { stdio: "inherit" });

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
