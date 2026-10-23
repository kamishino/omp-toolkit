import {
  assembleDashboard,
  getAllTimeWindowPolicies,
  type HealthSnapshot,
  type UsageReport,
} from "@omp-toolkit/core";
import {
  createStdoutBackend,
  createTerminal,
  drawProviderUsage,
  drawScheduleView,
  type Terminal,
  terminalDraw,
} from "@omp-toolkit/tui";
import type { MonitorCliConfig } from "./config";
import { writeHeartbeat as defaultWriteHeartbeat } from "./heartbeat";
import { fetchUsage as defaultFetchUsage, readSnapshot as defaultReadSnapshot } from "./usage";

export interface InteractiveMonitorOptions {
  config: MonitorCliConfig;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  fetchReports?: () => Promise<UsageReport[]>;
  readSnapshot?: () => HealthSnapshot | null;
  writeHeartbeat?: () => void;
  terminal?: Terminal;
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/**
 * Deep module encapsulating terminal alternate screen lifecycle,
 * raw mode keystroke decoding, view switching, and periodic polling.
 */
export class InteractiveMonitor {
  readonly config: MonitorCliConfig;
  private readonly stdin: NodeJS.ReadStream;
  private readonly stdout: NodeJS.WriteStream;
  private readonly fetchReports: () => Promise<UsageReport[]>;
  private readonly readSnapshot: () => HealthSnapshot | null;
  private readonly writeHeartbeat: () => void;

  private activeView: "usage" | "schedule" = "usage";
  private running = false;
  private alternateActive = false;
  private rawModeActive = false;
  private currentReports: UsageReport[] = [];
  private currentSnapshot: HealthSnapshot | null = null;
  private terminal: Terminal | null = null;
  private cleanupHandler: (() => void) | null = null;

  constructor(options: InteractiveMonitorOptions) {
    this.config = options.config;
    this.stdin = options.stdin ?? process.stdin;
    this.stdout = options.stdout ?? process.stdout;
    this.fetchReports = options.fetchReports ?? defaultFetchUsage;
    this.readSnapshot = options.readSnapshot ?? defaultReadSnapshot;
    this.writeHeartbeat = options.writeHeartbeat ?? defaultWriteHeartbeat;
    this.terminal = options.terminal ?? null;
  }

  getActiveView(): "usage" | "schedule" {
    return this.activeView;
  }

  toggleView(): "usage" | "schedule" {
    this.activeView = this.activeView === "usage" ? "schedule" : "usage";
    this.render();
    return this.activeView;
  }

  handleKey(str: string): "handled" | "exit" {
    if (str === "q" || str === "\u0003") {
      this.stop();
      return "exit";
    }
    if (str === "r") {
      void this.refresh();
      return "handled";
    }
    if (str === "s" || str === "\t") {
      this.toggleView();
      return "handled";
    }
    return "handled";
  }

  private initTerminal(): void {
    if (!this.terminal) {
      const backend = createStdoutBackend(this.stdout);
      this.terminal = createTerminal(backend);
    }
  }

  private enterAlternateScreen(): void {
    if (this.alternateActive) return;
    this.alternateActive = true;
    this.stdout.write("\x1b[?1049h");
    this.stdout.write("\x1b[?25l"); // hide cursor
  }

  private exitAlternateScreen(): void {
    if (!this.alternateActive) return;
    this.alternateActive = false;
    this.stdout.write("\x1b[?25h"); // show cursor
    this.stdout.write("\x1b[?1049l");
  }

  private setupRawMode(): void {
    if (this.stdin.isTTY && typeof this.stdin.setRawMode === "function") {
      try {
        this.stdin.setRawMode(true);
        this.stdin.resume();
        this.rawModeActive = true;
        this.stdin.on("data", (chunk: Buffer) => {
          const res = this.handleKey(chunk.toString("utf8"));
          if (res === "exit") {
            process.exit(0);
          }
        });
      } catch {
        // Best effort for raw mode
      }
    }
  }

  private teardownRawMode(): void {
    if (this.rawModeActive && typeof this.stdin.setRawMode === "function") {
      try {
        this.stdin.setRawMode(false);
        this.stdin.pause();
        this.rawModeActive = false;
      } catch {
        // Best effort
      }
    }
  }

  render(): void {
    if (!this.terminal) return;
    terminalDraw(this.terminal, (frame) => {
      if (this.activeView === "schedule") {
        const policies = getAllTimeWindowPolicies();
        drawScheduleView(frame, policies);
      } else {
        const now = Date.now();
        const dashboard = assembleDashboard(this.currentReports, this.currentSnapshot, {
          now,
          showHealth: this.config.health,
          balanceAlert: this.config.balanceAlert,
        });
        drawProviderUsage(frame, dashboard, {
          interval: this.config.interval,
          watch: this.config.watch,
          showHealth: this.config.health,
          checkedAt: this.currentSnapshot?.checkedAt,
          balanceAlert: this.config.balanceAlert,
        });
      }
    });
  }

  async refresh(): Promise<void> {
    try {
      this.currentReports = await this.fetchReports();
    } catch {
      // Keep previous reports on error
    }
    try {
      this.writeHeartbeat();
    } catch {
      // Best effort
    }
    this.currentSnapshot = this.config.health ? this.readSnapshot() : null;
    this.render();
  }

  stop(): void {
    this.running = false;
    this.teardownRawMode();
    this.exitAlternateScreen();
    if (this.cleanupHandler) {
      process.off("exit", this.cleanupHandler);
      process.off("SIGINT", this.cleanupHandler);
      this.cleanupHandler = null;
    }
  }

  async start(): Promise<void> {
    this.initTerminal();
    this.enterAlternateScreen();
    this.setupRawMode();

    this.cleanupHandler = () => this.stop();
    process.on("exit", this.cleanupHandler);
    process.on("SIGINT", () => {
      this.stop();
      process.exit(0);
    });

    this.running = true;
    await this.refresh();

    while (this.running) {
      await sleep(this.config.interval * 1000);
      if (!this.running) break;
      await this.refresh();
    }
  }
}
