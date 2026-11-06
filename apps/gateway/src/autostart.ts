import fs from "node:fs";
import path from "node:path";

/**
 * Start-on-login for the gateway daemons.
 *
 * Windows uses a Startup-folder VBS launcher (hidden window) rather than
 * Task Scheduler: creating scheduled tasks needs elevation on typical
 * workstations, while the per-user Startup folder does not.
 */
export const AUTOSTART_ENTRY_NAME = "OMP Toolkit Gateway.vbs";

export interface AutostartFileOps {
  exists(filePath: string): boolean;
  write(filePath: string, text: string): void;
  remove(filePath: string): void;
}

const defaultFiles: AutostartFileOps = {
  exists: (p) => fs.existsSync(p),
  write: (p, text) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, "utf-8");
  },
  remove: (p) => fs.rmSync(p, { force: true }),
};

export interface AutostartDependencies {
  platform: string;
  startupDir: string;
  bunPath: string;
  ctlScriptPath: string;
  withTunnel?: boolean;
  files: AutostartFileOps;
}

export interface AutostartResult {
  ok: boolean;
  lines: string[];
}

export function windowsStartupDir(env: NodeJS.ProcessEnv = process.env): string {
  const appData = env.APPDATA ?? "";
  return path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
}

/** VBS that launches gateway:ctl start with no visible window. */
export function buildWindowsLauncher(
  bunPath: string,
  ctlScriptPath: string,
  withTunnel = false,
): string {
  const tunnelFlag = withTunnel ? " --with-tunnel" : "";
  const command = `""${bunPath}"" ""${ctlScriptPath}"" start${tunnelFlag}`;
  return [
    "' OMP Toolkit Gateway autostart (managed by gateway:ctl autostart-*)",
    'Set shell = CreateObject("WScript.Shell")',
    `shell.Run "${command}", 0, False`,
    "",
  ].join("\r\n");
}

export function createAutostart(deps: Partial<AutostartDependencies> = {}) {
  const platform = deps.platform ?? process.platform;
  const files = deps.files ?? defaultFiles;
  const bunPath = deps.bunPath ?? process.execPath;
  const ctlScriptPath = deps.ctlScriptPath ?? path.join(import.meta.dir, "index.ts");
  const entryPath = path.join(deps.startupDir ?? windowsStartupDir(), AUTOSTART_ENTRY_NAME);

  const unsupported = (): AutostartResult => ({
    ok: false,
    lines: [
      `autostart is implemented for Windows (Startup folder) only; on ${platform}, run "gateway:ctl start" from your login shell profile or a user service`,
    ],
  });

  return {
    entryPath,
    async install(): Promise<AutostartResult> {
      if (platform !== "win32") return unsupported();
      files.write(
        entryPath,
        buildWindowsLauncher(bunPath, ctlScriptPath, deps.withTunnel ?? false),
      );
      return {
        ok: true,
        lines: [`startup entry installed: ${entryPath} (runs gateway:ctl start at sign-in)`],
      };
    },
    async remove(): Promise<AutostartResult> {
      if (platform !== "win32") return unsupported();
      if (!files.exists(entryPath)) return { ok: false, lines: ["startup entry is not installed"] };
      files.remove(entryPath);
      return { ok: true, lines: [`startup entry removed: ${entryPath}`] };
    },
    async status(): Promise<AutostartResult> {
      if (platform !== "win32") return unsupported();
      const installed = files.exists(entryPath);
      return {
        ok: true,
        lines: [
          installed ? `startup entry is installed: ${entryPath}` : "startup entry is not installed",
        ],
      };
    },
  };
}
