import fs from "node:fs";
import type { UsageLevel } from "@omp-toolkit/core";
import { type NativeImage, nativeImage } from "electron";
import { trayIconPath } from "./tray-path";

export function trayImage(
  assetsDir: string,
  mode: "light" | "dark",
  level: UsageLevel,
): NativeImage {
  const filePath = trayIconPath(assetsDir, mode, level);

  let img = nativeImage.createFromPath(filePath);

  const retinaFile = trayIconPath(assetsDir, mode, level, 2);
  if (fs.existsSync(retinaFile)) {
    try {
      const buffer = fs.readFileSync(retinaFile);
      img.addRepresentation({ scaleFactor: 2, buffer });
    } catch {
      // ignore
    }
  }

  if (img.isEmpty() && level !== "unknown") {
    // Fallback to unknown icon
    const fallbackPath = trayIconPath(assetsDir, mode, "unknown");
    img = nativeImage.createFromPath(fallbackPath);
    const fallbackRetina = trayIconPath(assetsDir, mode, "unknown", 2);
    if (fs.existsSync(fallbackRetina)) {
      try {
        const buffer = fs.readFileSync(fallbackRetina);
        img.addRepresentation({ scaleFactor: 2, buffer });
      } catch {
        // ignore
      }
    }
  }

  return img;
}
