import { BrowserWindow, type Rectangle, screen } from "electron";
import { IPC, type PanelState } from "./ipc";
import { placePanel, type Rect } from "./panel-position";

export interface CreatePanelOptions {
  preloadPath: string;
  htmlPath: string;
  width: number;
  height: number;
  margin?: number;
  onEscape?: () => void;
  onHide?: () => void;
}

/**
 * Deep module encapsulating the Electron desktop floating panel window,
 * screen display detection, tray-relative coordinate positioning,
 * and visibility transitions.
 */
export class DesktopPanel {
  readonly window: BrowserWindow;
  private readonly width: number;
  private readonly maxHeight: number;
  private currentHeight: number;
  private readonly margin: number;
  private lastHiddenAt = 0;
  private lastTrayBounds: Rectangle | null = null;

  constructor(options: CreatePanelOptions) {
    this.width = options.width;
    this.maxHeight = options.height;
    this.currentHeight = options.height;
    this.margin = options.margin ?? 12;
    this.window = new BrowserWindow({
      width: options.width,
      height: options.height,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: "OMP Provider Usage",
      webPreferences: {
        preload: options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });

    if (process.platform === "darwin") {
      this.window.setAlwaysOnTop(true, "floating");
    }

    this.window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.window.webContents.on("will-navigate", (event) => {
      event.preventDefault();
    });
    this.window.webContents.on("context-menu", (event) => {
      event.preventDefault();
    });

    this.window.on("blur", () => {
      this.hide();
      options.onHide?.();
    });

    if (options.onEscape) {
      this.window.webContents.on("before-input-event", (event, input) => {
        if (input.key === "Escape" && input.type === "keyDown") {
          event.preventDefault();
          options.onEscape?.();
        }
      });
    }

    void this.window.loadFile(options.htmlPath);
  }

  private placementFor(width: number, height: number): Rect {
    const tray = this.lastTrayBounds;
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(
      tray && tray.width > 0 ? { x: tray.x + tray.width / 2, y: tray.y + tray.height / 2 } : cursor,
    );
    return placePanel({
      tray,
      workArea: display.workArea,
      panel: { width, height },
      platform: process.platform,
      margin: this.margin,
    });
  }

  show(trayBounds: Rectangle | null = null): void {
    if (this.window.isDestroyed()) return;
    this.lastTrayBounds = trayBounds;

    this.window.setBounds(this.placementFor(this.width, this.currentHeight));
    this.window.show();
    this.window.focus();
  }

  setHeight(newHeight: number): void {
    if (this.window.isDestroyed()) return;
    const minH = 220;
    const maxH = this.maxHeight;
    const clamped = Math.max(minH, Math.min(maxH, newHeight));
    const [currW, currH] = this.window.getSize();
    if (currH === clamped) return;

    this.currentHeight = clamped;

    if (this.window.isVisible()) {
      this.window.setBounds(this.placementFor(currW, clamped));
    } else {
      this.window.setSize(currW, clamped);
    }
  }

  getHeight(): number {
    return this.currentHeight;
  }

  hide(): void {
    if (this.window.isDestroyed() || !this.window.isVisible()) return;
    this.lastHiddenAt = Date.now();
    this.window.hide();
  }

  toggle(trayBounds: Rectangle | null = null): void {
    if (Date.now() - this.lastHiddenAt < 300) return;
    if (this.isVisible()) {
      this.hide();
    } else {
      this.show(trayBounds);
    }
  }

  isVisible(): boolean {
    return !this.window.isDestroyed() && this.window.isVisible();
  }

  sendState(state: PanelState): void {
    if (!this.window.isDestroyed()) {
      this.window.webContents.send(IPC.state, state);
    }
  }

  destroy(): void {
    if (!this.window.isDestroyed()) {
      this.window.destroy();
    }
  }
}
