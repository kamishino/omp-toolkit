import os from "node:os";
import path from "node:path";
import { app, dialog, ipcMain, Menu, nativeTheme, powerMonitor } from "electron";
import tokens from "../../../design/tokens.json";
import { IPC, type RendererToMainEvents } from "./ipc";
import { logError } from "./logger";
import { createLoginItem, type LoginItem } from "./login-item";
import { DesktopPanel } from "./panel";
import { panelPaths } from "./paths";
import { DesktopRuntime } from "./runtime";
import { DesktopTray } from "./tray";

app.setName("OMP Provider Usage");
if (process.platform === "win32") {
  app.setAppUserModelId("dev.omp-toolkit.desktop-widget");
}

if (!app.requestSingleInstanceLock()) {
  console.log("OMP Provider Usage is already running.");
  const code = process.argv.includes("--selftest") ? 2 : 0;
  app.exit(code);
  process.exit(code);
}

let panel: DesktopPanel | null = null;
let desktopTray: DesktopTray | null = null;
let loginItem: LoginItem | null = null;
let runtime: DesktopRuntime | null = null;

const desktopTokens = tokens.desktop;
const panelWidth = desktopTokens.size.panelWidth.$value;
const panelHeight = desktopTokens.size.panelHeight.$value;
const margin = desktopTokens.size.margin.$value;

process.on("uncaughtException", (error) => {
  logError(error);
  if (app.isReady()) {
    dialog.showErrorBox(
      "OMP Provider Usage",
      error instanceof Error ? error.message : String(error),
    );
  }
  app.quit();
});

process.on("unhandledRejection", (error) => {
  logError(error);
});

process.on("SIGINT", () => {
  app.quit();
});

void app.whenReady().then(async () => {
  if (process.platform === "darwin") {
    app.dock?.hide();
  }
  Menu.setApplicationMenu(null);

  const checkoutRoot = path.resolve(app.getAppPath(), "../..");
  const { distDir, preload: preloadPath, html: htmlPath } = panelPaths(app.getAppPath());
  const assetsDir = path.join(distDir, "assets");
  const iconPath = path.join(assetsDir, "app-icon.png");

  loginItem = createLoginItem({
    platform: process.platform,
    home: os.homedir(),
    electronPath: process.execPath,
    appPath: app.getAppPath(),
    iconPath,
  });

  runtime = new DesktopRuntime({
    userDataDir: app.getPath("userData"),
    checkoutRoot,
    loginItem,
    argv: process.argv,
    env: process.env,
  });

  const preview = process.argv.includes("--preview");

  function showPanel(): void {
    panel?.show(desktopTray?.getBounds() ?? null);
    if (runtime) {
      panel?.sendState(runtime.getState());
    }
  }

  function hidePanel(): void {
    panel?.hide();
  }

  function togglePanel(): void {
    panel?.toggle(desktopTray?.getBounds() ?? null);
    if (panel?.isVisible() && runtime) {
      panel.sendState(runtime.getState());
    }
  }

  function rebuildMenu(): void {
    desktopTray?.rebuildMenu();
  }

  panel = new DesktopPanel({
    preloadPath,
    htmlPath,
    width: panelWidth,
    height: panelHeight,
    margin,
    onEscape: hidePanel,
    onHide: rebuildMenu,
  });

  panel.window.on("close", (event) => {
    if (!runtime?.isQuitting()) {
      event.preventDefault();
      hidePanel();
    }
  });

  panel.window.on("show", rebuildMenu);

  panel.window.once("ready-to-show", () => {
    if (preview) {
      showPanel();
    }
  });

  try {
    desktopTray = new DesktopTray({
      assetsDir,
      loginItem,
      isPanelVisible: () => Boolean(panel?.isVisible()),
      onTogglePanel: togglePanel,
      onRefreshNow: async () => {
        await runtime?.refresh();
      },
      onOpenTerminal: () => {
        void runtime?.launchTerminal(panel?.window);
      },
      onOpenOrca: () => {
        runtime?.launchOrca();
      },
      onQuit: () => {
        app.quit();
      },
      onError: (error) => {
        logError(error);
        dialog.showErrorBox(
          "OMP Provider Usage",
          `Could not update login item: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    });
  } catch (error) {
    logError(error);
    const message = error instanceof Error ? error.message : String(error);
    const text = `OMP Provider Usage: system tray unavailable: ${message}\n`;
    if (!process.argv.includes("--selftest")) {
      dialog.showErrorBox("OMP Provider Usage", `System tray unavailable: ${message}`);
    }
    process.stderr.write(text, () => {
      app.exit(1);
    });
    return;
  }

  if (process.argv.includes("--selftest")) {
    const created = Boolean(desktopTray?.tray);
    process.stdout.write(`tray: ${created ? "created" : "missing"}\n`, () => {
      app.exit(created ? 0 : 1);
    });
    return;
  }

  // Reactive subscription to deep runtime state changes
  runtime.subscribe((state) => {
    panel?.sendState(state);
    desktopTray?.update(
      runtime?.getDashboard() ?? null,
      runtime?.isRefreshing() ?? false,
      runtime?.getLastError() ?? null,
    );
  });

  // Wire type-safe IPC handlers to runtime
  function onIpc<K extends keyof RendererToMainEvents>(
    channel: K,
    handler: (
      event: Electron.IpcMainEvent,
      ...args: Parameters<RendererToMainEvents[K]>
    ) => void | Promise<void>,
  ): void {
    ipcMain.on(channel, (event, ...args) => {
      // biome-ignore lint/suspicious/noExplicitAny: internal typed wrapper
      return (handler as any)(event, ...args);
    });
  }

  onIpc(IPC.refresh, () => {
    void runtime?.refresh();
  });
  onIpc(IPC.hide, hidePanel);
  onIpc(IPC.openTerminal, () => {
    void runtime?.launchTerminal(panel?.window);
  });
  onIpc(IPC.openOrca, () => {
    runtime?.launchOrca();
  });
  onIpc(IPC.ready, () => {
    if (runtime) {
      panel?.sendState(runtime.getState());
    }
  });
  onIpc(IPC.saveSettings, (_event, newSettings) => {
    runtime?.updateSettings(newSettings);
    desktopTray?.rebuildMenu();
  });
  onIpc(IPC.warmup, async (_event, request) => {
    await runtime?.handleWarmUp(request, panel?.window);
  });
  panel.window.webContents.on("did-finish-load", () => {
    if (runtime) {
      panel?.sendState(runtime.getState());
    }
  });

  // Start runtime periodic polling
  runtime.startTimer();

  powerMonitor.on("resume", () => {
    void runtime?.refresh();
  });

  try {
    powerMonitor.on("unlock-screen", () => {
      void runtime?.refresh();
    });
  } catch {
    // not supported on all platforms
  }

  nativeTheme.on("updated", () => {
    desktopTray?.update(
      runtime?.getDashboard() ?? null,
      runtime?.isRefreshing() ?? false,
      runtime?.getLastError() ?? null,
    );
  });

  app.on("second-instance", showPanel);
  app.on("activate", showPanel);
});

app.on("window-all-closed", () => {
  // Keep app active in the background tray
});

app.on("before-quit", () => {
  runtime?.destroy();
  if (desktopTray) {
    desktopTray.destroy();
    desktopTray = null;
  }
});
