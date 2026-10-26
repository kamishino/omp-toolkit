import type { Dashboard, WarmUpRequest } from "@omp-toolkit/core";
import { supportsWarmUp, warmUpEligibility } from "@omp-toolkit/core";
import type { BrowserWindow, MessageBoxOptions } from "electron";
import { fetchDashboard } from "./data";
import type { PanelState } from "./ipc";
import { logError } from "./logger";
import type { LoginItem } from "./login-item";
import { openOrca, openTerminal } from "./open";
import { findBun, resolveCheckout, resolveHealthScript, resolveMonitorScript } from "./paths";
import {
  type DesktopSettings,
  loadDesktopSettings,
  saveDesktopSettings,
  validateDesktopSettings,
} from "./settings";
import { computePanelState } from "./state";
import { executeWarmUp } from "./warmup";

export interface DialogHost {
  showErrorBox(title: string, message: string): void;
  showMessageBox(
    window: BrowserWindow | null | undefined,
    options: MessageBoxOptions,
  ): Promise<{ response: number }>;
}

export const defaultDialogHost: DialogHost = {
  showErrorBox: (title, message) => {
    try {
      const electron = require("electron");
      if (electron?.dialog?.showErrorBox) {
        electron.dialog.showErrorBox(title, message);
      }
    } catch {
      // headless fallback
    }
  },
  showMessageBox: async (window, options) => {
    try {
      const electron = require("electron");
      if (electron?.dialog?.showMessageBox) {
        return window
          ? electron.dialog.showMessageBox(window, options)
          : electron.dialog.showMessageBox(options);
      }
    } catch {
      // headless fallback
    }
    return { response: 0 };
  },
};

export interface DesktopRuntimeOptions {
  userDataDir: string;
  checkoutRoot: string;
  loginItem?: LoginItem | null;
  fetchDashboardFn?: (source?: { bun?: string; script?: string }) => Promise<Dashboard>;
  executeWarmUpFn?: (
    source: { bun: string; script: string },
    request: WarmUpRequest,
  ) => Promise<{ success: boolean; message: string }>;
  dialogHost?: DialogHost;
  argv?: string[];
  env?: NodeJS.ProcessEnv;
}

export type RuntimeListener = (state: PanelState) => void;

/**
 * Deep runtime coordinator for the desktop widget.
 *
 * Encapsulates:
 * - Application lifecycle and active polling intervals
 * - State machine transitions and reactive subscriber notification
 * - Desktop settings persistence and login-item autostart sync
 * - Refresh execution with error tracking
 * - Warm-up operation status
 */
export class DesktopRuntime {
  private settings: DesktopSettings;
  private lastDashboard: Dashboard | null = null;
  private lastError: string | null = null;
  private refreshing = false;
  private quitting = false;
  private warmupRunning = false;
  private warmupMessage: string | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private readonly dialogHost: DialogHost;
  private readonly listeners = new Set<RuntimeListener>();

  constructor(private readonly options: DesktopRuntimeOptions) {
    this.dialogHost = options.dialogHost ?? defaultDialogHost;
    this.settings = loadDesktopSettings({
      userDataDir: options.userDataDir,
      argv: options.argv ?? process.argv,
      env: options.env ?? process.env,
      loginItemEnabled: options.loginItem?.isEnabled() ?? false,
    });
  }

  getState(): PanelState {
    return computePanelState({
      intervalSeconds: this.settings.intervalSeconds,
      lastDashboard: this.lastDashboard,
      refreshing: this.refreshing,
      lastError: this.lastError,
      warmup: { running: this.warmupRunning, message: this.warmupMessage },
      settings: this.settings,
    });
  }

  getDashboard(): Dashboard | null {
    return this.lastDashboard;
  }

  getSettings(): DesktopSettings {
    return this.settings;
  }

  isRefreshing(): boolean {
    return this.refreshing;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  isQuitting(): boolean {
    return this.quitting;
  }

  setQuitting(quitting: boolean): void {
    this.quitting = quitting;
    if (quitting) {
      this.stopTimer();
    }
  }

  subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const s = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(s);
      } catch (err) {
        logError(err);
      }
    }
  }

  async refresh(): Promise<void> {
    if (this.refreshing || this.quitting) return;
    this.refreshing = true;
    this.notify();

    try {
      let dashboard: Dashboard;
      if (this.options.fetchDashboardFn) {
        dashboard = await this.options.fetchDashboardFn();
      } else {
        const bun = findBun();
        const script = resolveMonitorScript(
          this.options.env ?? process.env,
          this.options.checkoutRoot,
        );

        if (!bun) {
          throw new Error("Bun not found. Install Bun or set BUN_BIN.");
        }
        if (!script) {
          throw new Error('Monitor script not found. Run "bun run install:omp".');
        }

        dashboard = await fetchDashboard({ bun, script });
      }
      this.lastDashboard = dashboard;
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      logError(error);
    } finally {
      this.refreshing = false;
      this.notify();
    }
  }

  updateSettings(newSettings: DesktopSettings): { valid: boolean; errors: string[] } {
    const validation = validateDesktopSettings(newSettings);
    if (!validation.valid) {
      const err = new Error(`Invalid settings received: ${validation.errors.join(", ")}`);
      logError(err);
      return validation;
    }

    saveDesktopSettings(this.options.userDataDir, newSettings);
    const intervalChanged = this.settings.intervalSeconds !== newSettings.intervalSeconds;
    this.settings = newSettings;

    try {
      this.options.loginItem?.setEnabled(newSettings.openAtLogin);
    } catch (error) {
      logError(error);
    }

    if (intervalChanged && this.refreshTimer) {
      this.resetTimer();
    }

    this.notify();
    return { valid: true, errors: [] };
  }

  setWarmUp(running: boolean, message?: string | null): void {
    this.warmupRunning = running;
    if (message !== undefined) {
      this.warmupMessage = message;
    }
    this.notify();
  }

  async handleWarmUp(request: WarmUpRequest, panelWindow?: BrowserWindow | null): Promise<void> {
    if (this.warmupRunning || this.quitting) return;

    if (!this.lastDashboard) {
      this.dialogHost.showErrorBox(
        "OMP Provider Usage",
        "No usage data loaded yet. Please wait for initial refresh.",
      );
      return;
    }

    const provider = this.lastDashboard.providers.find((p) => p.id === request.provider);
    if (!provider || !supportsWarmUp(provider.id)) {
      this.dialogHost.showErrorBox(
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
        if (panelWindow) {
          await this.dialogHost.showMessageBox(panelWindow, {
            type: "info",
            title: "Warm up all",
            message: "No eligible accounts to warm up.",
            detail: `${skippedNonOk} non-OK account(s) skipped; use Check per account to verify recovery.`,
          });
        }
        return;
      }

      const staleNote =
        this.lastDashboard.health?.stale === true || !this.lastDashboard.health?.checkedAt
          ? " Health data is stale or missing; known non-OK accounts are still skipped."
          : "";

      const boxOpts: MessageBoxOptions = {
        type: "question",
        buttons: ["Cancel", "Warm up"],
        defaultId: 1,
        cancelId: 0,
        title: "Warm up all",
        message: `Warm up ${eligibleCount} account(s) in ${provider.name}?`,
        detail: `${skippedNonOk} non-OK account(s) will be skipped.${staleNote} Each account receives one minimal model request.`,
      };

      const { response } = await this.dialogHost.showMessageBox(panelWindow, boxOpts);
      if (response !== 1) return;
    } else {
      const row = provider.rows.find((r) => r.account === request.account);
      if (!row) {
        this.dialogHost.showErrorBox(
          "OMP Provider Usage",
          `Account "${request.account}" not found in current dashboard.`,
        );
        return;
      }
      const eligibility = warmUpEligibility(provider.id, row.health);
      if (request.action === "warm" && eligibility !== "warm") {
        this.dialogHost.showErrorBox(
          "OMP Provider Usage",
          `Account "${row.displayAccount}" is ${row.route.text}; use Check instead.`,
        );
        return;
      }
      if (request.action === "check" && eligibility !== "check") {
        this.dialogHost.showErrorBox(
          "OMP Provider Usage",
          `Account "${row.displayAccount}" is already OK; use Warm up instead.`,
        );
        return;
      }
    }

    const bun = findBun();
    const healthScript =
      this.options.executeWarmUpFn !== undefined
        ? "mock-health.js"
        : resolveHealthScript(this.options.env ?? process.env, this.options.checkoutRoot);

    if (!bun) {
      this.dialogHost.showErrorBox(
        "OMP Provider Usage",
        "Bun not found. Install Bun or set BUN_BIN.",
      );
      return;
    }
    if (!healthScript) {
      this.dialogHost.showErrorBox(
        "OMP Provider Usage",
        'gemini-health.js was not found. Run "bun run install:omp".',
      );
      return;
    }

    this.setWarmUp(true, "Warming up...");

    let finalMessage: string | undefined;
    try {
      const executeFn = this.options.executeWarmUpFn ?? executeWarmUp;
      const result = await executeFn({ bun, script: healthScript }, request);
      if (result.success) {
        finalMessage = result.message;
        await this.refresh();
      } else {
        finalMessage = `Warm-up failed: ${result.message}`;
        if (panelWindow) {
          await this.dialogHost.showMessageBox(panelWindow, {
            type: "error",
            title: "OMP Provider Usage",
            message: "Warm-up failed",
            detail: result.message,
          });
        } else {
          this.dialogHost.showErrorBox("OMP Provider Usage", result.message);
        }
      }
    } finally {
      this.setWarmUp(false, finalMessage);
    }
  }

  startTimer(): void {
    if (this.refreshTimer) return;
    void this.refresh();
    this.resetTimer();
  }

  private resetTimer(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.refreshTimer = setInterval(() => {
      void this.refresh();
    }, this.settings.intervalSeconds * 1000);
  }

  stopTimer(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async launchTerminal(panelWindow?: BrowserWindow | null): Promise<void> {
    const bun = findBun();
    const script = resolveMonitorScript(this.options.env ?? process.env, this.options.checkoutRoot);

    if (!bun) {
      this.dialogHost.showErrorBox(
        "OMP Provider Usage",
        "Bun not found. Install Bun or set BUN_BIN.",
      );
      return;
    }
    if (!script) {
      this.dialogHost.showErrorBox(
        "OMP Provider Usage",
        'Monitor script not found. Run "bun run install:omp".',
      );
      return;
    }

    const command = [
      bun,
      script,
      "--watch",
      "--health",
      `--interval=${this.settings.intervalSeconds}`,
    ];
    const res = openTerminal(process.platform, command);
    if (res === "copied") {
      const boxOpts: MessageBoxOptions = {
        type: "info",
        title: "OMP Provider Usage",
        message: "Terminal monitor command copied to clipboard.",
        detail: command.join(" "),
      };
      await this.dialogHost.showMessageBox(panelWindow, boxOpts);
    }
  }

  launchOrca(): void {
    const checkout = resolveCheckout(this.options.env ?? process.env, this.options.checkoutRoot);
    const bun = findBun();
    try {
      openOrca(checkout, bun);
    } catch (error) {
      this.dialogHost.showErrorBox(
        "OMP Provider Usage",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  destroy(): void {
    this.setQuitting(true);
    this.listeners.clear();
  }
}
