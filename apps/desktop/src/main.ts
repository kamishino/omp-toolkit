import os from "node:os";
import path from "node:path";
import type { Dashboard, WarmUpRequest } from "@omp-toolkit/core";
import { app, dialog, ipcMain, Menu, nativeTheme, powerMonitor } from "electron";
import tokens from "../../../design/tokens.json";
import { launchOrcaTab, launchTerminalMonitor } from "./actions";
import { fetchDashboard } from "./data";
import { parseInterval } from "./interval";
import { IPC, type PanelState } from "./ipc";
import { logError } from "./logger";
import { createLoginItem, type LoginItem } from "./login-item";
import { DesktopPanel } from "./panel";
import { findBun, panelPaths, resolveMonitorScript } from "./paths";
import { computePanelState } from "./state";
import { DesktopTray } from "./tray";
import { handleWarmUpRequest } from "./warmup-handler";

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
let refreshTimer: NodeJS.Timeout | null = null;

let lastDashboard: Dashboard | null = null;
let lastError: string | null = null;
let refreshing = false;
let quitting = false;
let warmupRunning = false;
let warmupMessage: string | null = null;

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

function currentState(intervalSeconds: number): PanelState {
  return computePanelState({
    intervalSeconds,
    lastDashboard,
    refreshing,
    lastError,
    warmup: { running: warmupRunning, message: warmupMessage },
  });
}

void app.whenReady().then(async () => {
  if (process.platform === "darwin") {
    app.dock?.hide();
  }
  Menu.setApplicationMenu(null);

  const checkoutRoot = path.resolve(app.getAppPath(), "../..");
  const { distDir, preload: preloadPath, html: htmlPath } = panelPaths(app.getAppPath());
  const assetsDir = path.join(distDir, "assets");
  const iconPath = path.join(assetsDir, "app-icon.png");

  const intervalArg = process.argv.find((arg) => arg.startsWith("--interval="));
  const intervalSeconds = parseInterval(intervalArg?.slice("--interval=".length), process.env);

  const preview = process.argv.includes("--preview");

  function sendState(): void {
    panel?.sendState(currentState(intervalSeconds));
  }

  function updateTray(): void {
    desktopTray?.update(lastDashboard, refreshing, lastError);
  }

  function showPanel(): void {
    panel?.show(desktopTray?.getBounds() ?? null);
    sendState();
  }

  function hidePanel(): void {
    panel?.hide();
  }

  function togglePanel(): void {
    panel?.toggle(desktopTray?.getBounds() ?? null);
    if (panel?.isVisible()) {
      sendState();
    }
  }

  loginItem = createLoginItem({
    platform: process.platform,
    home: os.homedir(),
    electronPath: process.execPath,
    appPath: app.getAppPath(),
    iconPath,
  });

  const openTerminalMonitor = () =>
    launchTerminalMonitor({
      checkoutRoot,
      intervalSeconds,
      panelWindow: panel?.window,
    });

  const openOrca = () => launchOrcaTab({ checkoutRoot });

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
    onHide: () => {
      rebuildMenu();
    },
  });

  panel.window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      hidePanel();
    }
  });

  panel.window.on("show", () => {
    rebuildMenu();
  });

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
      onRefreshNow: refresh,
      onOpenTerminal: () => {
        void openTerminalMonitor();
      },
      onOpenOrca: openOrca,
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

  ipcMain.on(IPC.refresh, () => {
    void refresh();
  });
  ipcMain.on(IPC.hide, () => {
    hidePanel();
  });
  ipcMain.on(IPC.openTerminal, () => {
    void openTerminalMonitor();
  });
  ipcMain.on(IPC.openOrca, () => {
    openOrca();
  });
  ipcMain.on(IPC.ready, () => {
    sendState();
  });
  ipcMain.on(IPC.warmup, async (_event, request: WarmUpRequest) => {
    await handleWarmUpRequest(request, {
      panelWindow: panel?.window ?? null,
      lastDashboard,
      checkoutRoot,
      isWarmUpRunning: warmupRunning,
      isQuitting: quitting,
      onWarmUpStart: (msg) => {
        warmupRunning = true;
        warmupMessage = msg;
        sendState();
      },
      onWarmUpEnd: (finalMsg) => {
        warmupRunning = false;
        if (finalMsg !== undefined) {
          warmupMessage = finalMsg;
        }
        sendState();
      },
      onRefreshRequested: refresh,
    });
  });

  panel.window.webContents.on("did-finish-load", () => {
    sendState();
  });

  async function refresh(): Promise<void> {
    if (refreshing || quitting) return;
    refreshing = true;
    sendState();

    try {
      const bun = findBun();
      const script = resolveMonitorScript(process.env, checkoutRoot);

      if (!bun) {
        throw new Error("Bun not found. Install Bun or set BUN_BIN.");
      }
      if (!script) {
        throw new Error('Monitor script not found. Run "bun run install:omp".');
      }

      const dashboard = await fetchDashboard({ bun, script });
      lastDashboard = dashboard;
      lastError = null;
      updateTray();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      logError(error);
      updateTray();
    } finally {
      refreshing = false;
      sendState();
    }
  }

  void refresh();
  refreshTimer = setInterval(() => {
    void refresh();
  }, intervalSeconds * 1000);

  powerMonitor.on("resume", () => {
    void refresh();
  });

  try {
    powerMonitor.on("unlock-screen", () => {
      void refresh();
    });
  } catch {
    // not supported on all platforms
  }

  nativeTheme.on("updated", () => {
    updateTray();
  });

  app.on("second-instance", () => {
    showPanel();
  });

  app.on("activate", () => {
    showPanel();
  });
});

app.on("window-all-closed", () => {
  // Keep app active in the background tray
});

app.on("before-quit", () => {
  quitting = true;
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (desktopTray) {
    desktopTray.destroy();
    desktopTray = null;
  }
});
