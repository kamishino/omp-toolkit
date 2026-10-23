import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  type MonitorOptions,
  monitorCommandArgs,
  parseMonitorArgs,
  resolveMonitorScript,
} from "./monitor-target";

const execFileAsync = promisify(execFile);

const FLOATING_WORKTREE = "id:global-floating-terminal";
const TITLE = "OMP Provider Usage";
export function resolveOrcaBin(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const explicit = env.ORCA_BIN?.trim();
  if (explicit) return explicit;
  const managed = env.ORCA_CLI_COMMAND?.trim();
  if (managed) return managed;
  if (env.ORCA_DEV_REPO_ROOT) return "orca-dev";
  if (platform === "linux") return "orca-ide";
  return "orca";
}

export function quoteArg(value: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function floatingShortcut(platform: NodeJS.Platform = process.platform): string {
  return platform === "darwin" ? "Cmd+Alt+A" : "Ctrl+Alt+A";
}

export function buildMonitorCommand(
  script: string,
  options: MonitorOptions,
  platform: NodeJS.Platform = process.platform,
  execPath: string = process.execPath,
): string {
  const parts = [
    quoteArg(execPath, platform),
    ...monitorCommandArgs(script, options).map((part) => quoteArg(part, platform)),
  ];
  return platform === "win32" ? `& ${parts.join(" ")}` : parts.join(" ");
}

export async function isOrcaAvailable(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  const bin = resolveOrcaBin(env, platform);
  try {
    const { stdout } = await execFileAsync(bin, ["--version"], {
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    return String(stdout).trim().length > 0;
  } catch {
    return false;
  }
}

const ORCA = resolveOrcaBin();

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
  const options = parseMonitorArgs(args);
  const script = resolveMonitorScript();
  const command = buildMonitorCommand(script, options, process.platform, process.execPath);
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

    console.log(`Press ${floatingShortcut()} to show the Floating Workspace panel.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Orca monitor: ${message}`);
    if (message.includes("ENOENT")) {
      console.error(`Orca CLI not found (${ORCA}). Set ORCA_BIN or install Orca.`);
    } else if (message.includes("selector_not_found")) {
      console.error(
        `Orca rejected the floating workspace selector. Open it with ${floatingShortcut()}, then run:\n  ${command}`,
      );
    }
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  launchOrFocusMonitor();
}
