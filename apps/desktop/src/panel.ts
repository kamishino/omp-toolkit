import { BrowserWindow } from "electron";

export interface CreatePanelOptions {
  preloadPath: string;
  htmlPath: string;
  width: number;
  height: number;
  onEscape?: () => void;
}

export function createPanel(options: CreatePanelOptions): BrowserWindow {
  const panel = new BrowserWindow({
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
    panel.setAlwaysOnTop(true, "floating");
  }

  panel.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  panel.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });

  panel.webContents.on("context-menu", (event) => {
    event.preventDefault();
  });

  if (options.onEscape) {
    panel.webContents.on("before-input-event", (event, input) => {
      if (input.key === "Escape" && input.type === "keyDown") {
        event.preventDefault();
        options.onEscape?.();
      }
    });
  }

  void panel.loadFile(options.htmlPath);

  return panel;
}
