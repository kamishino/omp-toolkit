import type { Dashboard } from "@omp-toolkit/core";
import { fetchDashboard } from "./data";
import type { PanelState } from "./ipc";
import { logError } from "./logger";
import type { LoginItem } from "./login-item";
import { findBun, resolveMonitorScript } from "./paths";
import {
  type DesktopSettings,
  loadDesktopSettings,
  saveDesktopSettings,
  validateDesktopSettings,
} from "./settings";
import { computePanelState } from "./state";

export interface DesktopRuntimeOptions {
  userDataDir: string;
  checkoutRoot: string;
  loginItem?: LoginItem | null;
  fetchDashboardFn?: (source?: { bun?: string; script?: string }) => Promise<Dashboard>;
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
  private readonly listeners = new Set<RuntimeListener>();

  constructor(private readonly options: DesktopRuntimeOptions) {
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

  destroy(): void {
    this.setQuitting(true);
    this.listeners.clear();
  }
}
