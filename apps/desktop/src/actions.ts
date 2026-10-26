import type { BrowserWindow } from "electron";
import { dialog } from "electron";
import { openOrca, openTerminal } from "./open";
import { findBun, resolveCheckout, resolveMonitorScript } from "./paths";

export interface TerminalMonitorOptions {
  checkoutRoot: string;
  intervalSeconds: number;
  panelWindow?: BrowserWindow | null;
  env?: Record<string, string | undefined>;
}

export async function launchTerminalMonitor(options: TerminalMonitorOptions): Promise<void> {
  const { checkoutRoot, intervalSeconds, panelWindow, env = process.env } = options;
  const bun = findBun();
  const script = resolveMonitorScript(env, checkoutRoot);

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
    if (panelWindow) {
      await dialog.showMessageBox(panelWindow, boxOpts);
    } else {
      await dialog.showMessageBox(boxOpts);
    }
  }
}

export interface OrcaTabOptions {
  checkoutRoot: string;
  env?: Record<string, string | undefined>;
}

export function launchOrcaTab(options: OrcaTabOptions): void {
  const { checkoutRoot, env = process.env } = options;
  const checkout = resolveCheckout(env, checkoutRoot);
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
