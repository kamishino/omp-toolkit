import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { generateTrayManifest, type TrayMode } from "../../apps/desktop/src/tray-path";
import tokens from "../../design/tokens.json";
import type { UsageLevel } from "../../packages/core/src/dashboard/index";
import { oklchToRgb, type Rgb } from "../tokens/color";

const desktop = tokens.desktop;
function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function drawTrayIcon(size: number, mode: TrayMode, level: UsageLevel): PNG {
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

      // Base rounded box SDF
      const dxBox = Math.abs(x - cx + 0.5) - (cx - cornerRadius);
      const dyBox = Math.abs(y - cy + 0.5) - (cy - cornerRadius);
      const boxDist =
        Math.hypot(Math.max(0, dxBox), Math.max(0, dyBox)) +
        Math.min(0, Math.max(dxBox, dyBox)) -
        cornerRadius;
      const boxAlpha = clamp(0.5 - boxDist, 0, 1);

      if (boxAlpha <= 0) continue;

      let r = surfaceRaised.r;
      let g = surfaceRaised.g;
      let b = surfaceRaised.b;

      // Border layer
      const innerBoxDist = boxDist + borderWidth;
      const borderFactor = clamp(0.5 - boxDist, 0, 1) - clamp(0.5 - innerBoxDist, 0, 1);
      if (borderFactor > 0) {
        r = Math.round(r * (1 - borderFactor) + border.r * borderFactor);
        g = Math.round(g * (1 - borderFactor) + border.g * borderFactor);
        b = Math.round(b * (1 - borderFactor) + border.b * borderFactor);
      }

      // Center accent dot
      const centerDist = Math.hypot(x - cx + 0.5, y - cy + 0.5) - accentRadius;
      const centerAlpha = clamp(0.5 - centerDist, 0, 1);
      if (centerAlpha > 0) {
        r = Math.round(r * (1 - centerAlpha) + accent.r * centerAlpha);
        g = Math.round(g * (1 - centerAlpha) + accent.g * centerAlpha);
        b = Math.round(b * (1 - centerAlpha) + accent.b * centerAlpha);
      }

      // Status cutout ring (surface cutout background)
      const ringDist = Math.hypot(x - dotX + 0.5, y - dotY + 0.5) - outerDotRadius;
      const ringAlpha = clamp(0.5 - ringDist, 0, 1);
      if (ringAlpha > 0) {
        r = Math.round(r * (1 - ringAlpha) + surface.r * ringAlpha);
        g = Math.round(g * (1 - ringAlpha) + surface.g * ringAlpha);
        b = Math.round(b * (1 - ringAlpha) + surface.b * ringAlpha);
      }

      // Status indicator dot
      const dotDist = Math.hypot(x - dotX + 0.5, y - dotY + 0.5) - dotRadius;
      const dotAlpha = clamp(0.5 - dotDist, 0, 1);
      if (dotAlpha > 0) {
        r = Math.round(r * (1 - dotAlpha) + statusColor.r * dotAlpha);
        g = Math.round(g * (1 - dotAlpha) + statusColor.g * dotAlpha);
        b = Math.round(b * (1 - dotAlpha) + statusColor.b * dotAlpha);
      }

      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = Math.round(boxAlpha * 255);
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

      // Squircle background
      const dx = Math.abs(x - cx + 0.5) - (cx - cornerRadius);
      const dy = Math.abs(y - cy + 0.5) - (cy - cornerRadius);
      const bgDist =
        Math.hypot(Math.max(0, dx), Math.max(0, dy)) + Math.min(0, Math.max(dx, dy)) - cornerRadius;
      const bgAlpha = clamp(0.5 - bgDist, 0, 1);

      if (bgAlpha <= 0) continue;

      let r = bgColor.r;
      let g = bgColor.g;
      let b = bgColor.b;

      // Inner accent ring
      const distCenter = Math.hypot(x - cx + 0.5, y - cy + 0.5);
      const ringOuter = circleRadius;
      const ringInner = circleRadius - 16;
      const inRing = distCenter <= ringOuter && distCenter >= ringInner;

      if (inRing) {
        r = accentColor.r;
        g = accentColor.g;
        b = accentColor.b;
      }

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

  const manifest = generateTrayManifest();
  for (const item of manifest) {
    const size = item.scale === 2 ? 32 : 16;
    const icon = drawTrayIcon(size, item.mode, item.level);
    fs.writeFileSync(path.join(trayDir, item.fileName), PNG.sync.write(icon));
  }

  // App icon (256x256)
  const darkPalette = desktop.color.dark as Record<string, { $value: string }>;
  const darkSurface = oklchToRgb(darkPalette.surface.$value);
  const darkAccent = oklchToRgb(darkPalette.accent.$value);

  const appIcon = drawAppIcon(256, darkSurface, darkAccent);
  fs.writeFileSync(path.join(assetsDir, "app-icon.png"), PNG.sync.write(appIcon));
}

export function main(): void {
  const target = process.argv[2] ?? path.resolve(import.meta.dir, "../../apps/desktop/dist/assets");
  buildTrayIcons(target);
  console.log(`Generated tray and app icons in ${target}`);
}

if (import.meta.main) {
  main();
}
