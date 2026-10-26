import tokens from "../../design/tokens.json";
import { apcaLc, contrastRatio, oklchToRgb, type Rgb } from "./color";

export function checkTokens(): boolean {
  const desktop = tokens.desktop;
  if (!desktop?.color) {
    console.error("Missing desktop.color tokens");
    process.exit(1);
  }

  const textKeys = ["text", "muted", "accent", "ok", "warn", "hot", "danger"] as const;
  const modes = ["light", "dark"] as const;

  const failures: string[] = [];

  for (const mode of modes) {
    const palette = desktop.color[mode] as Record<string, { $value: string }>;
    const surfaceRgb: Rgb = oklchToRgb(palette.surface.$value);
    const raisedRgb: Rgb = oklchToRgb(palette.surfaceRaised.$value);
    const borderRgb: Rgb = oklchToRgb(palette.border.$value);

    const borderCr = contrastRatio(borderRgb, surfaceRgb);
    if (borderCr < 1.3) {
      failures.push(`${mode} border on surface: WCAG contrast ${borderCr.toFixed(2)} < 1.30`);
    }

    for (const key of textKeys) {
      const textRgb: Rgb = oklchToRgb(palette[key].$value);

      const lcSurface = apcaLc(textRgb, surfaceRgb);
      if (Math.abs(lcSurface) < 60) {
        failures.push(`${mode} ${key} on surface: APCA |${lcSurface.toFixed(1)}| < 60`);
      }

      const lcRaised = apcaLc(textRgb, raisedRgb);
      if (Math.abs(lcRaised) < 60) {
        failures.push(`${mode} ${key} on surfaceRaised: APCA |${lcRaised.toFixed(1)}| < 60`);
      }
    }
  }

  if (failures.length > 0) {
    console.error("Token contrast check failed:");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    return false;
  }

  console.log("token contrast: light ok, dark ok");
  return true;
}

if (import.meta.main) {
  if (!checkTokens()) {
    process.exit(1);
  }
}
