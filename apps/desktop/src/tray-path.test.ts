import { describe, expect, test } from "bun:test";
import path from "node:path";
import { generateTrayManifest, trayIconPath } from "./tray-path";

describe("trayIconPath", () => {
  const assetsDir = path.join("apps", "desktop", "dist", "assets");

  test("puts base icons under assets/tray", () => {
    expect(trayIconPath(assetsDir, "light", "unknown")).toBe(
      path.join(assetsDir, "tray", "tray-light-unknown.png"),
    );
  });

  test("puts @2x icons under assets/tray", () => {
    expect(trayIconPath(assetsDir, "dark", "ok", 2)).toBe(
      path.join(assetsDir, "tray", "tray-dark-ok@2x.png"),
    );
  });

  test("covers every mode and level", () => {
    for (const mode of ["light", "dark"] as const) {
      for (const level of ["ok", "warn", "hot", "critical", "unknown"] as const) {
        expect(trayIconPath(assetsDir, mode, level)).toBe(
          path.join(assetsDir, "tray", `tray-${mode}-${level}.png`),
        );
        expect(trayIconPath(assetsDir, mode, level, 2)).toBe(
          path.join(assetsDir, "tray", `tray-${mode}-${level}@2x.png`),
        );
      }
    }
  });
  test("generateTrayManifest returns all 20 unique combinations", () => {
    const manifest = generateTrayManifest();
    expect(manifest.length).toBe(20);
    for (const item of manifest) {
      expect(item.fileName).toContain(`tray-${item.mode}-${item.level}`);
    }
  });
});
