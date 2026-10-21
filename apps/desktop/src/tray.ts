import fs from "node:fs";
import path from "node:path";
import type { UsageLevel } from "@omp-toolkit/core";
import { type NativeImage, nativeImage } from "electron";

export function trayImage(
  assetsDir: string,
  mode: "light" | "dark",
  level: UsageLevel,
): NativeImage {
  const fileLevel = level;
  const fileName = `tray-${mode}-${fileLevel}.png`;
  const filePath = path.join(assetsDir, fileName);

  let img = nativeImage.createFromPath(filePath);

  const retinaFile = path.join(assetsDir, `tray-${mode}-${fileLevel}@2x.png`);
  if (fs.existsSync(retinaFile)) {
    try {
      const buffer = fs.readFileSync(retinaFile);
      img.addRepresentation({ scaleFactor: 2, buffer });
    } catch {
      // ignore
    }
  }

  if (img.isEmpty() && fileLevel !== "unknown") {
    // Fallback to unknown icon
    const fallbackPath = path.join(assetsDir, `tray-${mode}-unknown.png`);
    img = nativeImage.createFromPath(fallbackPath);
    const fallbackRetina = path.join(assetsDir, `tray-${mode}-unknown@2x.png`);
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
