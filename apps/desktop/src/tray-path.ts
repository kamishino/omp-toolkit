import path from "node:path";
import type { UsageLevel } from "@omp-toolkit/core";

export type TrayMode = "light" | "dark";
export const TRAY_MODES: readonly TrayMode[] = ["light", "dark"] as const;
export const TRAY_LEVELS: readonly UsageLevel[] = [
  "ok",
  "warn",
  "hot",
  "critical",
  "unknown",
] as const;
export const TRAY_SCALES: readonly (1 | 2)[] = [1, 2] as const;

export interface TrayIconDescriptor {
  readonly mode: TrayMode;
  readonly level: UsageLevel;
  readonly scale: 1 | 2;
  readonly fileName: string;
}

export function trayIconFileName(
  mode: TrayMode,
  level: UsageLevel,
  scaleFactor: 1 | 2 = 1,
): string {
  const suffix = scaleFactor === 2 ? "@2x" : "";
  return `tray-${mode}-${level}${suffix}.png`;
}

export function trayIconPath(
  assetsDir: string,
  mode: TrayMode,
  level: UsageLevel,
  scaleFactor: 1 | 2 = 1,
): string {
  return path.join(assetsDir, "tray", trayIconFileName(mode, level, scaleFactor));
}

export function generateTrayManifest(): TrayIconDescriptor[] {
  const manifest: TrayIconDescriptor[] = [];
  for (const mode of TRAY_MODES) {
    for (const level of TRAY_LEVELS) {
      for (const scale of TRAY_SCALES) {
        manifest.push({
          mode,
          level,
          scale,
          fileName: trayIconFileName(mode, level, scale),
        });
      }
    }
  }
  return manifest;
}
