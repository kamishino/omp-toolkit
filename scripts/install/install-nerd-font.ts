import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_NERD_FONT_FAMILY,
  generateFontRegistryEntry,
  NERD_FONT_CATALOG,
  patchWindowsTerminalFont,
  resolveNerdFontDownloadUrl,
  resolveUserFontDirectory,
  resolveWindowsTerminalSettingsCandidates,
} from "../../packages/core/src";
import { resolveAgentDir } from "../../packages/core/src/environment";

export interface FontInstallOptions {
  family?: string;
  list?: boolean;
  noTerminal?: boolean;
  noCache?: boolean;
  dryRun?: boolean;
  version?: string;
}

export function parseFontInstallArgs(argv: string[] = process.argv.slice(2)): FontInstallOptions {
  const fontArg = argv.find((a) => a.startsWith("--font="));
  const versionArg = argv.find((a) => a.startsWith("--version="));
  const positionals = argv.filter((a) => !a.startsWith("--"));

  return {
    family: fontArg ? fontArg.slice("--font=".length) : positionals[0],
    list: argv.includes("--list") || argv.includes("-l"),
    noTerminal: argv.includes("--no-terminal"),
    noCache: argv.includes("--no-cache"),
    dryRun: argv.includes("--dry-run"),
    version: versionArg ? versionArg.slice("--version=".length) : undefined,
  };
}

export function printFontCatalog(): void {
  console.log("Curated Nerd Font Families (https://github.com/ryanoasis/nerd-fonts):");
  console.log("----------------------------------------------------------------------");
  for (const [id, font] of Object.entries(NERD_FONT_CATALOG)) {
    const isDefault = id === DEFAULT_NERD_FONT_FAMILY ? " (default)" : "";
    console.log(`  * ${id.padEnd(14)} ${font.name}${isDefault}`);
    console.log(`    Primary face: "${font.primaryFontFace}"`);
  }
  console.log("----------------------------------------------------------------------");
  console.log("Usage: bun run font:install [family] [--no-terminal] [--dry-run]");
}

/**
 * Downloads, extracts, installs, and registers a Nerd Font family into the user font store.
 */
export async function installNerdFont(options: FontInstallOptions = {}): Promise<{
  success: boolean;
  family: string;
  installedCount: number;
  terminalConfigured: boolean;
  message: string;
}> {
  if (options.list) {
    printFontCatalog();
    return {
      success: true,
      family: "",
      installedCount: 0,
      terminalConfigured: false,
      message: "Printed font catalog",
    };
  }

  const family = options.family?.trim() || DEFAULT_NERD_FONT_FAMILY;
  const catalogEntry = NERD_FONT_CATALOG[family];
  const familyName = catalogEntry?.name ?? family;
  const downloadUrl = resolveNerdFontDownloadUrl(catalogEntry?.id ?? family, options.version);

  console.log(`=== Nerd Font Installer: ${familyName} ===`);

  // 1. Resolve cache directory
  const agentDir = resolveAgentDir();
  const cacheDir = path.join(agentDir, "cache", "fonts");
  const cachedZip = path.join(cacheDir, `${catalogEntry?.id ?? family}.zip`);

  if (!options.dryRun && (!fs.existsSync(cachedZip) || options.noCache)) {
    console.log(`Downloading from ${downloadUrl}...`);
    fs.mkdirSync(cacheDir, { recursive: true });
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`Failed to download ${family} (HTTP ${response.status} from GitHub)`);
    }
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(cachedZip, Buffer.from(arrayBuffer));
    console.log(`Cached download -> ${cachedZip}`);
  } else if (options.dryRun) {
    console.log(`[dry-run] Would download ${downloadUrl} -> ${cachedZip}`);
  } else {
    console.log(`Using cached font archive -> ${cachedZip}`);
  }

  // 2. Extract font archive
  const extractDir = path.join(os.tmpdir(), `omp-font-${family}-${Date.now()}`);
  let fontFiles: string[] = [];

  try {
    if (!options.dryRun) {
      fs.mkdirSync(extractDir, { recursive: true });
      execFileSync("tar", ["-xf", cachedZip, "-C", extractDir]);
      fontFiles = fs.readdirSync(extractDir).filter((file) => /\.(ttf|otf)$/i.test(file));
      if (fontFiles.length === 0) {
        throw new Error(`No .ttf or .otf font files found in ${family} archive`);
      }
      console.log(`Extracted ${fontFiles.length} font files.`);
    } else {
      console.log(`[dry-run] Would extract ${cachedZip} and discover font files.`);
      fontFiles = [`${family}NFM-Regular.ttf`, `${family}NFM-Bold.ttf`];
    }

    // 3. Copy to User Font Store
    const fontStoreDir = resolveUserFontDirectory(process.platform);
    console.log(`User Font Store: ${fontStoreDir}`);

    if (!options.dryRun) {
      fs.mkdirSync(fontStoreDir, { recursive: true });
      for (const file of fontFiles) {
        const src = path.join(extractDir, file);
        const dest = path.join(fontStoreDir, file);
        fs.copyFileSync(src, dest);
      }
      console.log(`Installed ${fontFiles.length} font files into user font directory.`);
    } else {
      console.log(`[dry-run] Would copy ${fontFiles.length} files to ${fontStoreDir}`);
    }

    // 4. OS Registration
    if (process.platform === "win32") {
      console.log("Registering fonts in Windows Registry (HKCU)...");
      for (const file of fontFiles) {
        const { key } = generateFontRegistryEntry(file);
        const fontPath = path.join(fontStoreDir, file);
        if (!options.dryRun) {
          execFileSync("reg.exe", [
            "add",
            "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
            "/v",
            key,
            "/t",
            "REG_SZ",
            "/d",
            fontPath,
            "/f",
          ]);
        } else {
          console.log(`[dry-run] Would register: ${key} -> ${fontPath}`);
        }
      }

      // Live broadcast notification
      if (!options.dryRun && fontFiles.length > 0) {
        const sampleFont = path.join(fontStoreDir, fontFiles[0]);
        console.log("Broadcasting WM_FONTCHANGE to active Windows applications...");
        try {
          const notifyScript = `
            Add-Type -TypeDefinition '
              using System;
              using System.Runtime.InteropServices;
              public class FontInstaller {
                [DllImport("gdi32.dll", EntryPoint="AddFontResourceW", SetLastError=true)]
                public static extern int AddFontResource(string lpFileName);
                [DllImport("user32.dll")]
                public static extern int SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
                public static void Notify() {
                  UIntPtr res;
                  SendMessageTimeout((IntPtr)0xffff, 0x001D, UIntPtr.Zero, IntPtr.Zero, 2, 1000, out res);
                }
              }';
            [FontInstaller]::AddFontResource('${sampleFont.replace(/'/g, "''")}');
            [FontInstaller]::Notify();
          `;
          execFileSync("powershell.exe", [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            notifyScript,
          ]);
        } catch {
          // Best effort broadcast
        }
      }
    } else if (process.platform === "linux") {
      if (!options.dryRun) {
        console.log("Updating fontconfig cache with fc-cache...");
        try {
          execFileSync("fc-cache", ["-fv", fontStoreDir]);
        } catch {
          // Best effort
        }
      } else {
        console.log(`[dry-run] Would run: fc-cache -fv ${fontStoreDir}`);
      }
    }

    // 5. Windows Terminal Configuration
    let terminalConfigured = false;
    if (process.platform === "win32" && !options.noTerminal) {
      const candidates = resolveWindowsTerminalSettingsCandidates();
      const settingsPath = candidates.find((c) => fs.existsSync(c));

      if (settingsPath) {
        const primaryFace = catalogEntry?.primaryFontFace ?? `${family} NFM`;
        console.log(`Found Windows Terminal settings -> ${settingsPath}`);

        if (!options.dryRun) {
          const raw = fs.readFileSync(settingsPath, "utf-8");
          const { text, changed } = patchWindowsTerminalFont(raw, primaryFace);

          if (changed) {
            const backupPath = `${settingsPath}.bak-${Date.now()}`;
            fs.copyFileSync(settingsPath, backupPath);
            fs.writeFileSync(settingsPath, text, "utf-8");
            terminalConfigured = true;
            console.log(
              `Configured Windows Terminal default font: "${primaryFace}" (backup: ${path.basename(backupPath)})`,
            );
          } else {
            console.log(`Windows Terminal already configured with: "${primaryFace}"`);
          }
        } else {
          console.log(`[dry-run] Would configure Windows Terminal font face: "${primaryFace}"`);
          terminalConfigured = true;
        }
      }
    }

    const message = `Successfully installed ${fontFiles.length} ${familyName} font files.`;
    console.log(`=== Done: ${message} ===`);
    return {
      success: true,
      family,
      installedCount: fontFiles.length,
      terminalConfigured,
      message,
    };
  } finally {
    if (fs.existsSync(extractDir)) {
      try {
        fs.rmSync(extractDir, { recursive: true, force: true });
      } catch {
        // Best effort temp cleanup
      }
    }
  }
}

if (import.meta.main) {
  const args = parseFontInstallArgs();
  installNerdFont(args).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
