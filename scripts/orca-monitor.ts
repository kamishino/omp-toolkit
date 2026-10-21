import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const FLOATING_WORKTREE = "id:global-floating-terminal";
const TITLE = "OMP Provider Usage";
const DEFAULT_INTERVAL = 300;
const ORCA = process.env.ORCA_BIN || "orca";
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".omp", "agent");
const ROOT = path.resolve(import.meta.dir, "..");

interface OrcaTerminalEntry {
  handle?: string;
  title?: string;
  preview?: string;
}

interface OrcaResponse<T = unknown> {
  ok: boolean;
  result?: T;
  error?: {
    code?: string;
    message?: string;
  };
}

function quoteArg(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function resolveMonitorScript(): string {
  const installed = path.join(AGENT_DIR, "scripts", "omp-provider-usage.js");
  const dist = path.resolve(ROOT, "apps/provider-usage/dist/index.js");
  const source = path.resolve(ROOT, "apps/provider-usage/src/index.ts");
  const candidates = [installed, dist, source];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? installed;
}

async function orca<T = unknown>(args: string[]): Promise<OrcaResponse<T>> {
  const { stdout } = await execFileAsync(ORCA, [...args, "--json"], {
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  const parsed = JSON.parse(String(stdout)) as OrcaResponse<T>;
  if (!parsed.ok) {
    throw new Error(parsed.error?.message ?? "Orca command failed");
  }
  return parsed;
}

export async function launchOrFocusMonitor(): Promise<void> {
  const args = process.argv.slice(2);
  const restart = args.includes("--restart");
  const health = !args.includes("--no-health");
  const intervalArg = args.find((arg) => arg.startsWith("--interval="));
  const rawInterval = Number(intervalArg?.slice("--interval=".length) ?? DEFAULT_INTERVAL);
  const interval = Math.max(10, Number.isFinite(rawInterval) ? rawInterval : DEFAULT_INTERVAL);

  const script = resolveMonitorScript();
  const parts = [
    quoteArg(process.execPath),
    quoteArg(script),
    "--watch",
    `--interval=${interval}`,
    ...(health ? ["--health"] : []),
  ];
  const command = process.platform === "win32" ? `& ${parts.join(" ")}` : parts.join(" ");

  try {
    const listed = await orca<{
      terminals?: OrcaTerminalEntry[];
      visualLayouts?: Array<{
        root?: {
          tabs?: Array<{
            title?: string;
            panes?: { handle?: string };
          }>;
        };
      }>;
    }>(["terminal", "list", "--worktree", FLOATING_WORKTREE, "--include-visual-layouts"]);
    const terminals = listed.result?.terminals ?? [];
    const layoutTitles = new Map<string, string>();
    for (const layout of listed.result?.visualLayouts ?? []) {
      for (const tab of layout.root?.tabs ?? []) {
        if (tab.panes?.handle && tab.title) {
          layoutTitles.set(tab.panes.handle, tab.title);
        }
      }
    }

    const existing = terminals.find((terminal) => {
      if (!terminal.handle) return false;
      const tabTitle = layoutTitles.get(terminal.handle) ?? terminal.title;
      const preview = terminal.preview ?? "";
      return (
        tabTitle === TITLE ||
        preview.includes("OMP Provider Usage") ||
        preview.includes("Source: omp usage")
      );
    });

    if (existing?.handle && !restart) {
      await orca(["terminal", "switch", "--terminal", existing.handle]);
      console.log("OMP Provider Usage: focused in Orca Floating Workspace.");
    } else {
      if (existing?.handle) {
        await orca(["terminal", "close", "--terminal", existing.handle]);
      }
      await orca([
        "terminal",
        "create",
        "--worktree",
        FLOATING_WORKTREE,
        "--title",
        TITLE,
        "--command",
        command,
        "--focus",
      ]);
      console.log("OMP Provider Usage: started in Orca Floating Workspace.");
    }

    console.log("Press Ctrl+Alt+A to show the Floating Workspace panel.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Orca monitor: ${message}`);
    if (message.includes("selector_not_found")) {
      console.error(
        `Orca rejected the floating workspace selector. Open it with Ctrl+Alt+A, then run:\n  ${command}`,
      );
    }
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  launchOrFocusMonitor();
}
