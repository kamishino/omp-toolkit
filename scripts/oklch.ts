export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

export function parseOklch(value: string): Oklch {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value.trim());
  if (!match) {
    throw new Error(`invalid oklch string: "${value}"`);
  }
  return {
    l: Number.parseFloat(match[1]),
    c: Number.parseFloat(match[2]),
    h: Number.parseFloat(match[3]),
  };
}

export function oklchToRgb(oklch: Oklch): Rgb {
  const hRad = (oklch.h * Math.PI) / 180;
  const a = oklch.c * Math.cos(hRad);
  const b = oklch.c * Math.sin(hRad);

  const l_ = oklch.l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = oklch.l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = oklch.l - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const rLin = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bLin = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  function toGamma(c: number): number {
    const clamped = Math.max(0, Math.min(1, c));
    const srgb = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(1, srgb)) * 255);
  }

  return {
    r: toGamma(rLin),
    g: toGamma(gLin),
    b: toGamma(bLin),
  };
}

function srgbToLinear(c255: number): number {
  const c = c255 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(rgb: Rgb): number {
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  return 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
}

export function contrastRatio(c1: Rgb, c2: Rgb): number {
  const y1 = relativeLuminance(c1);
  const y2 = relativeLuminance(c2);
  const brighter = Math.max(y1, y2);
  const darker = Math.min(y1, y2);
  return (brighter + 0.05) / (darker + 0.05);
}

export function apcaLc(txtRgb: Rgb, bgRgb: Rgb): number {
  let yTxt = relativeLuminance(txtRgb);
  let yBg = relativeLuminance(bgRgb);

  const blkThrs = 0.022;
  // biome-ignore lint/suspicious/noApproximativeNumericConstant: APCA specification constant
  const blkClmp = 1.414;
  if (yTxt < blkThrs) yTxt += (blkThrs - yTxt) ** blkClmp;
  if (yBg < blkThrs) yBg += (blkThrs - yBg) ** blkClmp;

  if (Math.abs(yBg - yTxt) < 0.0005) return 0.0;

  if (yBg > yTxt) {
    const sapc = (yBg ** 0.56 - yTxt ** 0.57) * 1.14;
    return (sapc < 0.1 ? 0 : sapc - 0.027) * 100;
  }
  const sapc = (yBg ** 0.65 - yTxt ** 0.62) * 1.14;
  return (sapc > -0.1 ? 0 : sapc + 0.027) * 100;
}
