import fs from "node:fs";
import { type Dashboard, truncate, type UsageLevel } from "@omp-toolkit/core";
import { Menu, type NativeImage, nativeImage, nativeTheme, type Rectangle, Tray } from "electron";
import type { LoginItem } from "./login-item";
import { trayIconPath } from "./tray-path";

export function trayImage(
  assetsDir: string,
  mode: "light" | "dark",
  level: UsageLevel,
): NativeImage {
  const filePath = trayIconPath(assetsDir, mode, level);
  let img = nativeImage.createFromPath(filePath);

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
    img = nativeImage.createFromPath(fallbackPath);
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
  readonly tray: Tray;
  private readonly options: DesktopTrayOptions;
  private lastDashboard: Dashboard | null = null;
  private lastError: string | null = null;
  private isRefreshing = false;
  private readonly themeListener: () => void;

  constructor(options: DesktopTrayOptions) {
    this.options = options;

    const initialMode = nativeTheme.shouldUseDarkColors ? "dark" : "light";
    const initialImg = trayImage(options.assetsDir, initialMode, "unknown");
    this.tray = new Tray(initialImg);
    this.tray.setToolTip("OMP: loading...");

    this.tray.on("click", () => {
      this.options.onTogglePanel();
    });

    this.tray.on("double-click", () => {
      this.options.onTogglePanel();
    });

    this.tray.on("right-click", () => {
      const menu = this.rebuildMenu();
      this.tray.popUpContextMenu(menu);
    });

    this.themeListener = () => {
      this.updateIconAndTooltip();
    };
    nativeTheme.on("updated", this.themeListener);

    this.rebuildMenu();
  }

  getBounds(): Rectangle | null {
    if (this.tray.isDestroyed()) return null;
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
    if (this.tray.isDestroyed()) return;
    const mode = nativeTheme.shouldUseDarkColors ? "dark" : "light";
    const level = this.lastDashboard?.iconLevel ?? "unknown";
    const img = trayImage(this.options.assetsDir, mode, level);
    this.tray.setImage(img);

    let tooltip = "OMP: loading...";
    if (this.lastError && !this.lastDashboard) {
      tooltip = "OMP: refresh failed";
    } else if (this.lastDashboard) {
      tooltip = truncate(this.lastDashboard.tooltip, 63);
    }
    this.tray.setToolTip(tooltip);
  }

  rebuildMenu(): Menu {
    const isVisible = Boolean(this.options.isPanelVisible?.());
    const isAutostart = Boolean(this.options.loginItem?.isEnabled());

    const menu = Menu.buildFromTemplate([
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

    if (process.platform === "linux") {
      this.tray.setContextMenu(menu);
    }
    return menu;
  }

  destroy(): void {
    nativeTheme.off("updated", this.themeListener);
    if (!this.tray.isDestroyed()) {
      this.tray.destroy();
    }
  }
}
