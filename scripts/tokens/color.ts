import "colorjs.io/spaces";
import { contrastAPCA, contrastWCAG21, parse, to } from "colorjs.io/fn";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

function clampByte(val: number): number {
  return Math.round(Math.max(0, Math.min(1, val)) * 255);
}

function rgbCss(c: Rgb): string {
  return `rgb(${c.r} ${c.g} ${c.b})`;
}

export function oklchToRgb(value: string): Rgb {
  const parsed = parse(value);
  const srgb = to(parsed, "srgb");
  const [r, g, b] = srgb.coords;
  return {
    r: clampByte(r ?? 0),
    g: clampByte(g ?? 0),
    b: clampByte(b ?? 0),
  };
}

export function contrastRatio(c1: Rgb, c2: Rgb): number {
  const color1 = parse(rgbCss(c1));
  const color2 = parse(rgbCss(c2));
  return contrastWCAG21(color1, color2);
}

export function apcaLc(txt: Rgb, bg: Rgb): number {
  const textColor = parse(rgbCss(txt));
  const bgColor = parse(rgbCss(bg));
  // Color.js takes background first, foreground (text) second
  return contrastAPCA(bgColor, textColor);
}
