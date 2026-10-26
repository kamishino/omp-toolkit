import { describe, expect, test } from "bun:test";
import { apcaLc, contrastRatio, oklchToRgb } from "./color";

describe("color helpers using colorjs.io", () => {
  test("converts dark and light surface oklch to approximate sRGB", () => {
    const darkRgb = oklchToRgb("oklch(0.210 0.006 285.9)");
    expect(Math.abs(darkRgb.r - 24)).toBeLessThanOrEqual(2);
    expect(Math.abs(darkRgb.g - 24)).toBeLessThanOrEqual(2);
    expect(Math.abs(darkRgb.b - 27)).toBeLessThanOrEqual(2);

    const lightRgb = oklchToRgb("oklch(0.985 0.000 89.9)");
    expect(Math.abs(lightRgb.r - 250)).toBeLessThanOrEqual(2);
    expect(Math.abs(lightRgb.g - 250)).toBeLessThanOrEqual(2);
    expect(Math.abs(lightRgb.b - 250)).toBeLessThanOrEqual(2);
  });

  test("calculates WCAG contrast ratio", () => {
    const white = { r: 255, g: 255, b: 255 };
    const black = { r: 0, g: 0, b: 0 };
    expect(contrastRatio(white, black)).toBeCloseTo(21, 0);
  });

  test("computes APCA Lc values", () => {
    const white = { r: 255, g: 255, b: 255 };
    const black = { r: 0, g: 0, b: 0 };
    // Black text on white background is positive (~106)
    expect(apcaLc(black, white)).toBeCloseTo(106, 0);
    // White text on black background is negative (~ -108)
    expect(apcaLc(white, black)).toBeCloseTo(-108, 0);
  });
});
