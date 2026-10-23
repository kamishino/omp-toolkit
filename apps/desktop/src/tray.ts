import fs from "node:fs";
import { type Dashboard, truncate, type UsageLevel } from "@omp-toolkit/core";
import type { Menu as ElectronMenu, Tray as ElectronTray, NativeImage, Rectangle } from "electron";
import type { LoginItem } from "./login-item";
import { trayIconPath } from "./tray-path";

// Electron runtime is lazily accessed so unit tests can run outside Electron runtime
function getElectron() {
  try {
    // biome-ignore lint/suspicious/noExplicitAny: electron runtime detection
    return (globalThis as any).require?.("electron") ?? null;
  } catch {
    return null;
  }
}

export function trayImage(
  assetsDir: string,
  mode: "light" | "dark",
  level: UsageLevel,
): NativeImage | null {
  const electron = getElectron();
  if (!electron?.nativeImage) return null;

  const filePath = trayIconPath(assetsDir, mode, level);
  let img = electron.nativeImage.createFromPath(filePath);

  const retinaFile = trayIconPath(assetsDir, mode, level, 2);
  if (fs.existsSync(retinaFile)) {
    try {
      const buffer = fs.readFileSync(retinaFile);
      img.addRepresentation({ scaleFactor: 2, buffer });
    } catch {
      // ignore
    }
  }

  if (img.isEmpty() && level !== "unknown") {
    const fallbackPath = trayIconPath(assetsDir, mode, "unknown");
    img = electron.nativeImage.createFromPath(fallbackPath);
    const fallbackRetina = trayIconPath(assetsDir, mode, "unknown", 2);
    if (fs.existsSync(fallbackRetina)) {
      try {
        const buffer = fs.readFileSync(fallbackRetina);
        img.addRepresentation({ scaleFactor: 2, buffer });
      } catch {
        // ignore
      }
    }
  }

  return img;
}

export interface DesktopTrayOptions {
  assetsDir: string;
  loginItem?: LoginItem | null;
  isPanelVisible?: () => boolean;
  onTogglePanel: () => void;
  onRefreshNow: () => Promise<void>;
  onOpenTerminal: () => void;
  onOpenOrca: () => void;
  onQuit: () => void;
  onError?: (error: unknown) => void;
}

/**
 * Deep module encapsulating the Electron Tray lifecycle, dynamic context menu,
 * tooltip truncation, click events, and OS theme event listeners.
 */
export class DesktopTray {
  readonly tray: ElectronTray | null = null;
  private readonly options: DesktopTrayOptions;
  private lastDashboard: Dashboard | null = null;
  private lastError: string | null = null;
  private isRefreshing = false;
  private readonly themeListener?: () => void;

  constructor(options: DesktopTrayOptions) {
    this.options = options;
    const electron = getElectron();
    if (!electron?.Tray) {
      return;
    }

    const initialMode = electron.nativeTheme?.shouldUseDarkColors ? "dark" : "light";
    const initialImg = trayImage(options.assetsDir, initialMode, "unknown");
    if (initialImg) {
      const trayInstance = new electron.Tray(initialImg);
      trayInstance.setToolTip("OMP: loading...");

      trayInstance.on("click", () => {
        this.options.onTogglePanel();
      });

      trayInstance.on("double-click", () => {
        this.options.onTogglePanel();
      });

      trayInstance.on("right-click", () => {
        const menu = this.rebuildMenu();
        if (menu) {
          trayInstance.popUpContextMenu(menu);
        }
      });
      this.tray = trayInstance;
    }
    if (electron.nativeTheme) {
      this.themeListener = () => {
        this.updateIconAndTooltip();
      };
      electron.nativeTheme.on("updated", this.themeListener);
    }

    this.rebuildMenu();
  }

  getBounds(): Rectangle | null {
    if (!this.tray || this.tray.isDestroyed()) return null;
    return this.tray.getBounds();
  }

  update(dashboard: Dashboard | null, isRefreshing: boolean, error: string | null): void {
    this.lastDashboard = dashboard;
    this.isRefreshing = isRefreshing;
    this.lastError = error;
    this.updateIconAndTooltip();
    this.rebuildMenu();
  }

  private updateIconAndTooltip(): void {
    if (!this.tray || this.tray.isDestroyed()) return;
    const electron = getElectron();
    const mode = electron?.nativeTheme?.shouldUseDarkColors ? "dark" : "light";
    const level = this.lastDashboard?.iconLevel ?? "unknown";
    const img = trayImage(this.options.assetsDir, mode, level);
    if (img) {
      this.tray.setImage(img);
    }

    let tooltip = "OMP: loading...";
    if (this.lastError && !this.lastDashboard) {
      tooltip = "OMP: refresh failed";
    } else if (this.lastDashboard) {
      tooltip = truncate(this.lastDashboard.tooltip, 63);
    }
    this.tray.setToolTip(tooltip);
  }

  rebuildMenu(): ElectronMenu | null {
    const electron = getElectron();
    if (!electron?.Menu) return null;

    const isVisible = Boolean(this.options.isPanelVisible?.());
    const isAutostart = Boolean(this.options.loginItem?.isEnabled());

    const menu = electron.Menu.buildFromTemplate([
      {
        label: this.isRefreshing ? "Refreshing..." : "Refresh now",
        enabled: !this.isRefreshing,
        click: () => {
          void this.options.onRefreshNow();
        },
      },
      {
        label: isVisible ? "Minimize to tray" : "Show panel",
        click: () => {
          this.options.onTogglePanel();
        },
      },
      { type: "separator" },
      {
        label: "Open terminal monitor",
        click: () => {
          this.options.onOpenTerminal();
        },
      },
      {
        label: "Open Orca tab",
        click: () => {
          this.options.onOpenOrca();
        },
      },
      { type: "separator" },
      {
        label: "Start at login",
        type: "checkbox",
        checked: isAutostart,
        click: (item: { checked: boolean }) => {
          try {
            this.options.loginItem?.setEnabled(item.checked);
          } catch (error) {
            this.options.onError?.(error);
          }
          this.rebuildMenu();
        },
      },
      { type: "separator" },
      {
        label: "Exit",
        click: () => {
          this.options.onQuit();
        },
      },
    ]);

    if (process.platform === "linux" && this.tray) {
      this.tray.setContextMenu(menu);
    }
    return menu;
  }

  destroy(): void {
    const electron = getElectron();
    if (this.themeListener && electron?.nativeTheme) {
      electron.nativeTheme.off("updated", this.themeListener);
    }
    if (this.tray && !this.tray.isDestroyed()) {
      this.tray.destroy();
    }
  }
}
