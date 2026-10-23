import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { build } from "plist";

// Electron app is lazily accessed so unit tests can run outside Electron runtime
function getElectronApp() {
  try {
    // biome-ignore lint/suspicious/noExplicitAny: runtime check
    const electron = (globalThis as any).require?.("electron");
    return electron?.app ?? null;
  } catch {
    return null;
  }
}

export interface LoginItem {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
}

export interface CreateLoginItemOptions {
  platform: NodeJS.Platform;
  home: string;
  electronPath: string;
  appPath: string;
  iconPath: string;
}

export const MACOS_LABEL = "dev.omp-toolkit.desktop-widget";

export function desktopQuote(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`")
    .replace(/%/g, "%%");
  return `"${escaped}"`;
}

export function launchAgentPlist(options: {
  label: string;
  electronPath: string;
  appPath: string;
}): string {
  return build({
    Label: options.label,
    ProgramArguments: [options.electronPath, options.appPath, "--hidden"],
    RunAtLoad: true,
    ProcessType: "Interactive",
  });
}

export function autostartDesktopEntry(options: {
  electronPath: string;
  appPath: string;
  iconPath: string;
}): string {
  return `[Desktop Entry]
Type=Application
Name=OMP Provider Usage
Comment=OMP provider usage desktop widget
Exec=${desktopQuote(options.electronPath)} ${desktopQuote(options.appPath)} --hidden
Terminal=false
Icon=${options.iconPath}
X-GNOME-Autostart-enabled=true
`;
}

function writeAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, content, "utf8");
  try {
    fs.renameSync(tempPath, filePath);
  } catch {
    fs.copyFileSync(tempPath, filePath);
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // ignore
    }
  }
}

export function createLoginItem(options: CreateLoginItemOptions): LoginItem {
  const { platform, home, electronPath, appPath, iconPath } = options;

  if (platform === "win32") {
    const args = [appPath, "--hidden"];
    return {
      isEnabled(): boolean {
        const electronApp = getElectronApp();
        return (
          electronApp?.getLoginItemSettings({ path: electronPath, args })?.openAtLogin ?? false
        );
      },
      setEnabled(enabled: boolean): void {
        const electronApp = getElectronApp();
        electronApp?.setLoginItemSettings({
          openAtLogin: enabled,
          path: electronPath,
          args,
          name: "OMP Provider Usage",
        });
      },
    };
  }

  if (platform === "darwin") {
    const plistPath = path.join(home, "Library", "LaunchAgents", `${MACOS_LABEL}.plist`);

    return {
      isEnabled(): boolean {
        return fs.existsSync(plistPath);
      },
      setEnabled(enabled: boolean): void {
        const uid = typeof process.getuid === "function" ? process.getuid() : null;

        if (enabled) {
          const content = launchAgentPlist({
            label: MACOS_LABEL,
            electronPath,
            appPath,
          });
          writeAtomic(plistPath, content);

          if (uid !== null && fs.existsSync("/bin/launchctl")) {
            try {
              execFileSync("/bin/launchctl", ["bootstrap", `gui/${uid}`, plistPath], {
                stdio: "ignore",
              });
            } catch {
              // Ignore already-loaded or transient error
            }
          }
        } else {
          if (uid !== null && fs.existsSync("/bin/launchctl")) {
            try {
              execFileSync("/bin/launchctl", ["bootout", `gui/${uid}`, plistPath], {
                stdio: "ignore",
              });
            } catch {
              // Ignore not-found error
            }
          }

          if (fs.existsSync(plistPath)) {
            fs.unlinkSync(plistPath);
          }
        }
      },
    };
  }

  // Linux
  const desktopPath = path.join(home, ".config", "autostart", "omp-toolkit-desktop-widget.desktop");

  return {
    isEnabled(): boolean {
      return fs.existsSync(desktopPath);
    },
    setEnabled(enabled: boolean): void {
      if (enabled) {
        const content = autostartDesktopEntry({
          electronPath,
          appPath,
          iconPath,
        });
        writeAtomic(desktopPath, content);
      } else {
        if (fs.existsSync(desktopPath)) {
          fs.unlinkSync(desktopPath);
        }
      }
    },
  };
}
