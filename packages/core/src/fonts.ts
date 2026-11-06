import { homedir } from "node:os";
import path from "node:path";

export interface NerdFontFamilyInfo {
  id: string;
  name: string;
  githubAsset: string;
  primaryFontFace: string;
  recommendedMonoFace: string;
}

export const NERD_FONT_CATALOG: Record<string, NerdFontFamilyInfo> = {
  JetBrainsMono: {
    id: "JetBrainsMono",
    name: "JetBrains Mono Nerd Font",
    githubAsset: "JetBrainsMono.zip",
    primaryFontFace: "JetBrainsMono NFM",
    recommendedMonoFace: "JetBrainsMono NFM",
  },
  CascadiaCode: {
    id: "CascadiaCode",
    name: "Caskaydia Cove Nerd Font",
    githubAsset: "CascadiaCode.zip",
    primaryFontFace: "CaskaydiaCove NFM",
    recommendedMonoFace: "CaskaydiaCove NFM",
  },
  FiraCode: {
    id: "FiraCode",
    name: "Fira Code Nerd Font",
    githubAsset: "FiraCode.zip",
    primaryFontFace: "FiraCode NFM",
    recommendedMonoFace: "FiraCode NFM",
  },
  Meslo: {
    id: "Meslo",
    name: "MesloLGS Nerd Font",
    githubAsset: "Meslo.zip",
    primaryFontFace: "MesloLGS NFM",
    recommendedMonoFace: "MesloLGS NFM",
  },
  Hack: {
    id: "Hack",
    name: "Hack Nerd Font",
    githubAsset: "Hack.zip",
    primaryFontFace: "Hack NFM",
    recommendedMonoFace: "Hack NFM",
  },
  GeistMono: {
    id: "GeistMono",
    name: "Geist Mono Nerd Font",
    githubAsset: "GeistMono.zip",
    primaryFontFace: "GeistMono NFM",
    recommendedMonoFace: "GeistMono NFM",
  },
};

export const DEFAULT_NERD_FONT_FAMILY = "JetBrainsMono";

/**
 * Returns GitHub release download URL for a Nerd Font release asset.
 */
export function resolveNerdFontDownloadUrl(family: string, version?: string): string {
  const asset = family.endsWith(".zip") ? family : `${family}.zip`;
  if (version) {
    const tag = version.startsWith("v") ? version : `v${version}`;
    return `https://github.com/ryanoasis/nerd-fonts/releases/download/${tag}/${asset}`;
  }
  return `https://github.com/ryanoasis/nerd-fonts/releases/latest/download/${asset}`;
}

/**
 * Resolves the user-scoped operating system font directory (no admin elevation required).
 */
export function resolveUserFontDirectory(
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): string {
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    return path.join(localAppData, "Microsoft", "Windows", "Fonts");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Fonts");
  }
  // Linux / BSD
  const xdgData = env.XDG_DATA_HOME ?? path.join(home, ".local", "share");
  return path.join(xdgData, "fonts", "NerdFonts");
}

/**
 * Known paths where Windows Terminal stores its settings.json file.
 */
export function resolveWindowsTerminalSettingsCandidates(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): string[] {
  const localAppData = env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
  return [
    path.join(
      localAppData,
      "Packages",
      "Microsoft.WindowsTerminal_8wekyb3d8bbwe",
      "LocalState",
      "settings.json",
    ),
    path.join(
      localAppData,
      "Packages",
      "Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe",
      "LocalState",
      "settings.json",
    ),
    path.join(localAppData, "Microsoft", "Windows Terminal", "settings.json"),
  ];
}

/**
 * Generates the Windows Registry value name for a font file (e.g. "JetBrainsMonoNFM-Regular (TrueType)").
 */
export function generateFontRegistryEntry(fileName: string): { key: string; isTrueType: boolean } {
  const isOtf = fileName.toLowerCase().endsWith(".otf");
  const baseName = fileName.replace(/\.(ttf|otf)$/i, "");
  const suffix = isOtf ? "(OpenType)" : "(TrueType)";
  return {
    key: `${baseName} ${suffix}`,
    isTrueType: !isOtf,
  };
}

/**
 * Pure JSON patcher for Windows Terminal settings.json, setting profiles.defaults.font.face.
 */
export function patchWindowsTerminalFont(
  settingsJsonText: string,
  fontFace: string,
): { text: string; changed: boolean } {
  const hasBom = settingsJsonText.charCodeAt(0) === 0xfeff;
  const content = hasBom ? settingsJsonText.slice(1) : settingsJsonText;

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { text: settingsJsonText, changed: false };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { text: settingsJsonText, changed: false };
  }

  const root = parsed as Record<string, unknown>;
  const profiles =
    root.profiles && typeof root.profiles === "object" && !Array.isArray(root.profiles)
      ? (root.profiles as Record<string, unknown>)
      : {};

  const defaults =
    profiles.defaults && typeof profiles.defaults === "object" && !Array.isArray(profiles.defaults)
      ? (profiles.defaults as Record<string, unknown>)
      : {};

  const font =
    defaults.font && typeof defaults.font === "object" && !Array.isArray(defaults.font)
      ? (defaults.font as Record<string, unknown>)
      : {};

  if (font.face === fontFace) {
    return { text: settingsJsonText, changed: false };
  }

  font.face = fontFace;
  defaults.font = font;
  profiles.defaults = defaults;
  root.profiles = profiles;

  const newJson = JSON.stringify(root, null, 4);
  return {
    text: `${hasBom ? "\uFEFF" : ""}${newJson}\n`,
    changed: true,
  };
}
