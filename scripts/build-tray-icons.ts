import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import tokens from "../design/tokens.json";
import { oklchToRgb, type Rgb } from "./color";

const desktop = tokens.desktop;

const modes = ["light", "dark"] as const;
const levels = ["ok", "warn", "hot", "critical", "unknown"] as const;

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function drawTrayIcon(size: number, mode: "light" | "dark", level: (typeof levels)[number]): PNG {
  const png = new PNG({ width: size, height: size });
  const palette = desktop.color[mode] as Record<string, { $value: string }>;
  const surfaceRaised = oklchToRgb(palette.surfaceRaised.$value);
  const border = oklchToRgb(palette.border.$value);
  const surface = oklchToRgb(palette.surface.$value);
  const accent = oklchToRgb(palette.accent.$value);
  const colorKey = level === "critical" ? "danger" : level === "unknown" ? "muted" : level;
  const statusColor = oklchToRgb(palette[colorKey].$value);

  const cx = size / 2;
  const cy = size / 2;
  const cornerRadius = size * 0.22;
  const borderWidth = Math.max(1, size / 16);
  const accentRadius = size * 0.2;
  const dotX = size * 0.78;
  const dotY = size * 0.78;
  const dotRadius = size * 0.2;
  const ringWidth = Math.max(1, size / 16);
  const outerDotRadius = dotRadius + ringWidth;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      const px = x + 0.5;
      const py = y + 0.5;

      // Base chip: rounded rectangle
      const qx = Math.max(Math.abs(px - cx) - (cx - cornerRadius), 0);
      const qy = Math.max(Math.abs(py - cy) - (cy - cornerRadius), 0);
      const dist = Math.hypot(qx, qy);
      const chipAlpha = clamp(cornerRadius - dist + 0.5, 0, 1);

      if (chipAlpha <= 0) {
        png.data[idx] = 0;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 0;
        png.data[idx + 3] = 0;
        continue;
      }

      // Border outline of the chip
      const innerCornerRadius = Math.max(0.5, cornerRadius - borderWidth);
      const iqx = Math.max(Math.abs(px - cx) - (cx - borderWidth - innerCornerRadius), 0);
      const iqy = Math.max(Math.abs(py - cy) - (cy - borderWidth - innerCornerRadius), 0);
      const innerDist = Math.hypot(iqx, iqy);
      const innerAlpha = clamp(innerCornerRadius - innerDist + 0.5, 0, 1);

      let r = border.r * (1 - innerAlpha) + surfaceRaised.r * innerAlpha;
      let g = border.g * (1 - innerAlpha) + surfaceRaised.g * innerAlpha;
      let b = border.b * (1 - innerAlpha) + surfaceRaised.b * innerAlpha;

      // Center accent circle
      const distCenter = Math.hypot(px - cx, py - cy);
      const accentAlpha = clamp(accentRadius - distCenter + 0.5, 0, 1);
      if (accentAlpha > 0) {
        r = r * (1 - accentAlpha) + accent.r * accentAlpha;
        g = g * (1 - accentAlpha) + accent.g * accentAlpha;
        b = b * (1 - accentAlpha) + accent.b * accentAlpha;
      }

      // Status dot with surface ring at bottom right
      const distDot = Math.hypot(px - dotX, py - dotY);
      const ringAlpha = clamp(outerDotRadius - distDot + 0.5, 0, 1);
      if (ringAlpha > 0) {
        r = r * (1 - ringAlpha) + surface.r * ringAlpha;
        g = g * (1 - ringAlpha) + surface.g * ringAlpha;
        b = b * (1 - ringAlpha) + surface.b * ringAlpha;

        const dotAlpha = clamp(dotRadius - distDot + 0.5, 0, 1);
        if (dotAlpha > 0) {
          r = r * (1 - dotAlpha) + statusColor.r * dotAlpha;
          g = g * (1 - dotAlpha) + statusColor.g * dotAlpha;
          b = b * (1 - dotAlpha) + statusColor.b * dotAlpha;
        }
      }

      png.data[idx] = Math.round(r);
      png.data[idx + 1] = Math.round(g);
      png.data[idx + 2] = Math.round(b);
      png.data[idx + 3] = Math.round(chipAlpha * 255);
    }
  }

  return png;
}

function drawAppIcon(size: number, bgColor: Rgb, accentColor: Rgb): PNG {
  const png = new PNG({ width: size, height: size });
  const cornerRadius = 48;
  const cx = size / 2;
  const cy = size / 2;
  const circleRadius = 72;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;

      // Rounded rectangle distance
      const qx = Math.max(Math.abs(x + 0.5 - cx) - (cx - cornerRadius), 0);
      const qy = Math.max(Math.abs(y + 0.5 - cy) - (cy - cornerRadius), 0);
      const dist = Math.hypot(qx, qy);
      const bgAlpha = clamp(cornerRadius - dist + 0.5, 0, 1);

      if (bgAlpha <= 0) {
        png.data[idx] = 0;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 0;
        png.data[idx + 3] = 0;
        continue;
      }

      // Center accent circle
      const circleDist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const circleAlpha = clamp(circleRadius - circleDist + 0.5, 0, 1);

      const r = Math.round(bgColor.r * (1 - circleAlpha) + accentColor.r * circleAlpha);
      const g = Math.round(bgColor.g * (1 - circleAlpha) + accentColor.g * circleAlpha);
      const b = Math.round(bgColor.b * (1 - circleAlpha) + accentColor.b * circleAlpha);

      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = Math.round(bgAlpha * 255);
    }
  }

  return png;
}

export function buildTrayIcons(assetsDir: string): void {
  const trayDir = path.join(assetsDir, "tray");
  fs.mkdirSync(trayDir, { recursive: true });

  for (const mode of modes) {
    for (const level of levels) {
      // 16x16 standard
      const icon16 = drawTrayIcon(16, mode, level);
      const buf16 = PNG.sync.write(icon16);
      fs.writeFileSync(path.join(trayDir, `tray-${mode}-${level}.png`), buf16);

      // 32x32 @2x
      const icon32 = drawTrayIcon(32, mode, level);
      const buf32 = PNG.sync.write(icon32);
      fs.writeFileSync(path.join(trayDir, `tray-${mode}-${level}@2x.png`), buf32);
    }
  }

  // App icon (256x256)
  const darkPalette = desktop.color.dark as Record<string, { $value: string }>;
  const darkSurface = oklchToRgb(darkPalette.surface.$value);
  const darkAccent = oklchToRgb(darkPalette.accent.$value);

  const appIcon = drawAppIcon(256, darkSurface, darkAccent);
  fs.writeFileSync(path.join(assetsDir, "app-icon.png"), PNG.sync.write(appIcon));
}

if (import.meta.main) {
  const target = process.argv[2] ?? path.resolve(import.meta.dir, "../apps/desktop/dist/assets");
  buildTrayIcons(target);
  console.log(`Generated tray and app icons in ${target}`);
}
