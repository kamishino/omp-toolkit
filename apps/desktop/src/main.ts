import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type Dashboard,
  supportsWarmUp,
  truncate,
  type WarmUpRequest,
  warmUpEligibility,
} from "@omp-toolkit/core";
import { app, dialog, ipcMain, Menu, nativeTheme, powerMonitor, Tray } from "electron";
import tokens from "../../../design/tokens.json";
import { fetchDashboard } from "./data";
import { parseInterval } from "./interval";
import { IPC, type PanelState } from "./ipc";
import { createLoginItem, type LoginItem } from "./login-item";
import { openOrca, openTerminal } from "./open";
import { DesktopPanel } from "./panel";
import {
  errorLogPath,
  findBun,
  panelPaths,
  resolveCheckout,
  resolveHealthScript,
  resolveMonitorScript,
} from "./paths";
import { trayImage } from "./tray";
import { executeWarmUp } from "./warmup";

app.setName("OMP Provider Usage");
if (process.platform === "win32") {
  app.setAppUserModelId("dev.omp-toolkit.desktop-widget");
}

if (!app.requestSingleInstanceLock()) {
  console.log("OMP Provider Usage is already running.");
  app.quit();
}

let panel: DesktopPanel | null = null;
let tray: Tray | null = null;
let menu: Menu | null = null;
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

function logError(error: unknown): void {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    const file = errorLogPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, line, "utf8");
  } catch {
    // Logging must not crash the widget
  }
}

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
  const warmup = { running: warmupRunning, message: warmupMessage };
  if (refreshing) {
    return {
      status: "loading",
      data: lastDashboard,
      intervalSeconds,
      warmup,
    };
  }

  if (lastError) {
    return {
      status: "error",
      data: lastDashboard,
      message: lastError,
      intervalSeconds,
      warmup,
    };
  }

  if (lastDashboard) {
    return {
      status: "ready",
      data: lastDashboard,
      intervalSeconds,
      warmup,
    };
  }

  return {
    status: "loading",
    data: null,
    intervalSeconds,
    warmup,
  };
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
    if (!tray) return;
    const mode = nativeTheme.shouldUseDarkColors ? "dark" : "light";
    const level = lastDashboard?.iconLevel ?? "unknown";
    tray.setImage(trayImage(assetsDir, mode, level));

    let tooltip = "OMP: loading...";
    if (lastError && !lastDashboard) {
      tooltip = "OMP: refresh failed";
    } else if (lastDashboard) {
      tooltip = truncate(lastDashboard.tooltip, 63);
    }
    tray.setToolTip(tooltip);
  }

  function showPanel(): void {
    panel?.show(tray?.getBounds() ?? null);
    sendState();
  }

  function hidePanel(): void {
    panel?.hide();
  }

  function togglePanel(): void {
    panel?.toggle(tray?.getBounds() ?? null);
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

  async function openTerminalMonitor(): Promise<void> {
    const bun = findBun();
    const script = resolveMonitorScript(process.env, checkoutRoot);
    if (!bun) {
      dialog.showErrorBox("OMP Provider Usage", "Bun not found. Install Bun or set BUN_BIN.");
      return;
    }
    if (!script) {
      dialog.showErrorBox(
        "OMP Provider Usage",
        'Monitor script not found. Run "bun run install:omp".',
      );
      return;
    }

    const command = [bun, script, "--watch", "--health", `--interval=${intervalSeconds}`];
    const res = openTerminal(process.platform, command);
    if (res === "copied") {
      const boxOpts: Electron.MessageBoxOptions = {
        type: "info",
        title: "OMP Provider Usage",
        message: "Terminal monitor command copied to clipboard.",
        detail: command.join(" "),
      };
      if (panel?.window) {
        await dialog.showMessageBox(panel.window, boxOpts);
      } else {
        await dialog.showMessageBox(boxOpts);
      }
    }
  }

  function openOrcaTab(): void {
    const checkout = resolveCheckout(process.env, checkoutRoot);
    const bun = findBun();
    try {
      openOrca(checkout, bun);
    } catch (error) {
      dialog.showErrorBox(
        "OMP Provider Usage",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  function rebuildMenu(): void {
    const isVisible = Boolean(panel?.isVisible());
    const isAutostart = Boolean(loginItem?.isEnabled());

    menu = Menu.buildFromTemplate([
      {
        label: "Refresh now",
        click: () => {
          void refresh();
        },
      },
      {
        label: isVisible ? "Minimize to tray" : "Show panel",
        click: () => {
          togglePanel();
        },
      },
      { type: "separator" },
      {
        label: "Open terminal monitor",
        click: () => {
          void openTerminalMonitor();
        },
      },
      {
        label: "Open Orca tab",
        click: () => {
          openOrcaTab();
        },
      },
      { type: "separator" },
      {
        label: "Start at login",
        type: "checkbox",
        checked: isAutostart,
        click: (item) => {
          try {
            loginItem?.setEnabled(item.checked);
          } catch (error) {
            logError(error);
            dialog.showErrorBox(
              "OMP Provider Usage",
              `Could not update login item: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          rebuildMenu();
        },
      },
      { type: "separator" },
      {
        label: "Exit",
        click: () => {
          app.quit();
        },
      },
    ]);

    if (process.platform === "linux") {
      tray?.setContextMenu(menu);
    }
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

  tray = new Tray(
    trayImage(assetsDir, nativeTheme.shouldUseDarkColors ? "dark" : "light", "unknown"),
  );
  tray.setToolTip("OMP: loading...");

  rebuildMenu();

  if (process.platform === "darwin") {
    tray.setIgnoreDoubleClickEvents(true);
  }

  tray.on("click", () => {
    togglePanel();
  });

  if (process.platform !== "linux") {
    tray.on("right-click", () => {
      if (menu) {
        tray?.popUpContextMenu(menu);
      }
    });
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
    openOrcaTab();
  });
  ipcMain.on(IPC.ready, () => {
    sendState();
  });
  ipcMain.on(IPC.warmup, async (_event, request: WarmUpRequest) => {
    if (warmupRunning || quitting) return;
    if (!lastDashboard) {
      dialog.showErrorBox(
        "OMP Provider Usage",
        "No usage data loaded yet. Please wait for initial refresh.",
      );
      return;
    }

    const provider = lastDashboard.providers.find((p) => p.id === request.provider);
    if (!provider || !supportsWarmUp(provider.id)) {
      dialog.showErrorBox(
        "OMP Provider Usage",
        `Warm-up is not supported for provider "${request.provider}".`,
      );
      return;
    }

    if ("all" in request) {
      if (request.action !== "warm") return;
      const eligibleCount = provider.rows.filter(
        (r) => warmUpEligibility(provider.id, r.health) === "warm",
      ).length;
      const skippedNonOk = provider.rows.length - eligibleCount;

      if (eligibleCount === 0) {
        if (panel?.window) {
          await dialog.showMessageBox(panel.window, {
            type: "info",
            title: "Warm up all",
            message: "No eligible accounts to warm up.",
            detail: `${skippedNonOk} non-OK account(s) skipped; use Check per account to verify recovery.`,
          });
        }
        return;
      }

      const staleNote =
        lastDashboard.health?.stale === true || !lastDashboard.health?.checkedAt
          ? " Health data is stale or missing; known non-OK accounts are still skipped."
          : "";

      const boxOpts: Electron.MessageBoxOptions = {
        type: "question",
        buttons: ["Cancel", "Warm up"],
        defaultId: 1,
        cancelId: 0,
        title: "Warm up all",
        message: `Warm up ${eligibleCount} account(s) in ${provider.name}?`,
        detail: `${skippedNonOk} non-OK account(s) will be skipped.${staleNote} Each account receives one minimal model request.`,
      };

      const { response } = panel?.window
        ? await dialog.showMessageBox(panel.window, boxOpts)
        : await dialog.showMessageBox(boxOpts);

      if (response !== 1) return;
    } else {
      const row = provider.rows.find((r) => r.account === request.account);
      if (!row) {
        dialog.showErrorBox(
          "OMP Provider Usage",
          `Account "${request.account}" not found in current dashboard.`,
        );
        return;
      }
      const eligibility = warmUpEligibility(provider.id, row.health);
      if (request.action === "warm" && eligibility !== "warm") {
        dialog.showErrorBox(
          "OMP Provider Usage",
          `Account "${row.displayAccount}" is ${row.route.text}; use Check instead.`,
        );
        return;
      }
      if (request.action === "check" && eligibility !== "check") {
        dialog.showErrorBox(
          "OMP Provider Usage",
          `Account "${row.displayAccount}" is already OK; use Warm up instead.`,
        );
        return;
      }
    }

    const bun = findBun();
    const healthScript = resolveHealthScript(process.env, checkoutRoot);
    if (!bun) {
      dialog.showErrorBox("OMP Provider Usage", "Bun not found. Install Bun or set BUN_BIN.");
      return;
    }
    if (!healthScript) {
      dialog.showErrorBox(
        "OMP Provider Usage",
        'gemini-health.js was not found. Run "bun run install:omp".',
      );
      return;
    }

    warmupRunning = true;
    warmupMessage = "Warming up...";
    sendState();

    try {
      const result = await executeWarmUp({ bun, script: healthScript }, request);
      if (result.success) {
        warmupMessage = result.message;
        await refresh();
      } else {
        warmupMessage = `Warm-up failed: ${result.message}`;
        if (panel?.window) {
          await dialog.showMessageBox(panel.window, {
            type: "error",
            title: "OMP Provider Usage",
            message: "Warm-up failed",
            detail: result.message,
          });
        } else {
          dialog.showErrorBox("OMP Provider Usage", result.message);
        }
      }
    } finally {
      warmupRunning = false;
      sendState();
    }
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
  if (tray) {
    tray.destroy();
    tray = null;
  }
});
