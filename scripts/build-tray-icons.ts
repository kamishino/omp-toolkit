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

function drawCircleIcon(size: number, dotColor: Rgb, ringColor: Rgb): PNG {
  const png = new PNG({ width: size, height: size });
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.36;
  const ringWidth = Math.max(1, size / 16);
  const innerRadius = radius - ringWidth;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);

      const alpha = clamp(radius - d + 0.5, 0, 1);
      if (alpha <= 0) {
        png.data[idx] = 0;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 0;
        png.data[idx + 3] = 0;
        continue;
      }

      // Blend between inner dot and outer ring
      const ringRatio = clamp(d - innerRadius + 0.5, 0, 1);
      const r = Math.round(dotColor.r * (1 - ringRatio) + ringColor.r * ringRatio);
      const g = Math.round(dotColor.g * (1 - ringRatio) + ringColor.g * ringRatio);
      const b = Math.round(dotColor.b * (1 - ringRatio) + ringColor.b * ringRatio);

      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = Math.round(alpha * 255);
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
    const palette = desktop.color[mode] as Record<string, { $value: string }>;
    const ringColor = oklchToRgb(palette.text.$value);

    for (const level of levels) {
      const colorKey = level === "critical" ? "danger" : level === "unknown" ? "muted" : level;
      const dotColor = oklchToRgb(palette[colorKey].$value);

      // 16x16 standard
      const icon16 = drawCircleIcon(16, dotColor, ringColor);
      const buf16 = PNG.sync.write(icon16);
      fs.writeFileSync(path.join(trayDir, `tray-${mode}-${level}.png`), buf16);

      // 32x32 @2x
      const icon32 = drawCircleIcon(32, dotColor, ringColor);
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
