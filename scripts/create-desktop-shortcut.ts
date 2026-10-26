import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface CreateShortcutOptions {
  platform?: NodeJS.Platform;
  home?: string;
  repoRoot?: string;
  dryRun?: boolean;
  silent?: boolean;
}

export interface ShortcutResult {
  path: string;
  platform: NodeJS.Platform;
  type: "lnk" | "app" | "command" | "desktop";
}

export function resolveDesktopDir(home = os.homedir()): string {
  return path.join(home, "Desktop");
}

export function generateLinuxDesktopEntry(options: {
  repoRoot: string;
  launcherPath: string;
  iconPath?: string;
}): string {
  const iconLine =
    options.iconPath && fs.existsSync(options.iconPath) ? `Icon=${options.iconPath}\n` : "";
  return `[Desktop Entry]
Type=Application
Name=OMP Provider Usage
Comment=Open the OMP provider usage panel
Exec="${options.launcherPath}"
Path=${options.repoRoot}
${iconLine}Terminal=false
Categories=Utility;System;
`;
}

export function generateMacCommandScript(options: {
  repoRoot: string;
  launcherPath: string;
}): string {
  return `#!/bin/sh
cd "${options.repoRoot}" && exec "${options.launcherPath}"
`;
}

export function createDesktopShortcut(options: CreateShortcutOptions = {}): ShortcutResult {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  const repoRoot = options.repoRoot ?? path.resolve(import.meta.dir, "..");
  const desktopDir = resolveDesktopDir(home);

  if (!fs.existsSync(desktopDir) && !options.dryRun) {
    fs.mkdirSync(desktopDir, { recursive: true });
  }

  if (platform === "win32") {
    const launcher = path.join(repoRoot, "omp-widget.cmd");
    if (!fs.existsSync(launcher) && !options.dryRun) {
      throw new Error(`Launcher not found: ${launcher}`);
    }
    const shortcutPath = path.join(desktopDir, "OMP Provider Usage.lnk");
    if (options.dryRun) {
      return { path: shortcutPath, platform, type: "lnk" };
    }

    if (fs.existsSync(shortcutPath)) {
      try {
        fs.unlinkSync(shortcutPath);
      } catch {
        // Best-effort removal
      }
    }

    const psScript = path.join(repoRoot, "scripts", "create-desktop-shortcut.ps1");
    execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psScript], {
      stdio: options.silent ? "ignore" : "inherit",
    });
    return { path: shortcutPath, platform, type: "lnk" };
  }

  if (platform === "darwin") {
    const launcher = path.join(repoRoot, "omp-widget.sh");
    if (!fs.existsSync(launcher) && !options.dryRun) {
      throw new Error(`Launcher not found: ${launcher}`);
    }

    const appPath = path.join(desktopDir, "OMP Provider Usage.app");
    if (options.dryRun) {
      return { path: appPath, platform, type: "app" };
    }

    try {
      const appleScript = `do shell script "cd \\"${repoRoot}\\" && ./omp-widget.sh >/dev/null 2>&1 &"`;
      execFileSync("osacompile", ["-e", appleScript, "-o", appPath], { stdio: "ignore" });
      if (!options.silent) {
        console.log(`Created macOS desktop application: ${appPath}`);
      }
      return { path: appPath, platform, type: "app" };
    } catch {
      const commandPath = path.join(desktopDir, "OMP Provider Usage.command");
      const content = generateMacCommandScript({ repoRoot, launcherPath: launcher });
      fs.writeFileSync(commandPath, content, { mode: 0o755 });
      if (!options.silent) {
        console.log(`Created macOS command launcher: ${commandPath}`);
      }
      return { path: commandPath, platform, type: "command" };
    }
  }

  // Linux / POSIX fallback
  const launcher = path.join(repoRoot, "omp-widget.sh");
  if (!fs.existsSync(launcher) && !options.dryRun) {
    throw new Error(`Launcher not found: ${launcher}`);
  }

  const shortcutPath = path.join(desktopDir, "omp-provider-usage.desktop");
  const iconPath = path.join(repoRoot, "apps", "desktop", "dist", "assets", "app-icon.png");
  const content = generateLinuxDesktopEntry({
    repoRoot,
    launcherPath: launcher,
    iconPath,
  });

  if (options.dryRun) {
    return { path: shortcutPath, platform, type: "desktop" };
  }

  fs.writeFileSync(shortcutPath, content, { mode: 0o755 });
  if (!options.silent) {
    console.log(`Created Linux desktop shortcut: ${shortcutPath}`);
  }

  const appsDir = path.join(home, ".local", "share", "applications");
  if (fs.existsSync(appsDir)) {
    try {
      const menuPath = path.join(appsDir, "omp-provider-usage.desktop");
      fs.writeFileSync(menuPath, content, { mode: 0o755 });
      if (!options.silent) {
        console.log(`Installed application menu launcher: ${menuPath}`);
      }
    } catch {
      // Best-effort menu entry
    }
  }

  return { path: shortcutPath, platform, type: "desktop" };
}

if (import.meta.main) {
  createDesktopShortcut();
}
