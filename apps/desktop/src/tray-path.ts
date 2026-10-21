import path from "node:path";
import type { UsageLevel } from "@omp-toolkit/core";

export type TrayMode = "light" | "dark";

export function trayIconPath(
  assetsDir: string,
  mode: TrayMode,
  level: UsageLevel,
  scaleFactor: 1 | 2 = 1,
): string {
  const suffix = scaleFactor === 2 ? "@2x" : "";
  return path.join(assetsDir, "tray", `tray-${mode}-${level}${suffix}.png`);
}
