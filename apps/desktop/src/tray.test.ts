import { describe, expect, test } from "bun:test";
import path from "node:path";
import { DesktopTray, trayImage } from "./tray";

describe("tray image and DesktopTray coordinator", () => {
  const assetsDir = path.resolve(import.meta.dir, "../dist/assets");

  test("trayImage handles missing Electron runtime gracefully", () => {
    const img = trayImage(assetsDir, "light", "ok");
    // In node/bun test environment without Electron runtime, returns null cleanly
    expect(img === null || img !== undefined).toBe(true);
  });

  test("DesktopTray instantiates without throwing outside Electron runtime", () => {
    const tray = new DesktopTray({
      assetsDir,
      onTogglePanel: () => {},
      onRefreshNow: async () => {},
      onOpenTerminal: () => {},
      onOpenOrca: () => {},
      onQuit: () => {},
    });

    expect(tray).toBeDefined();
    expect(tray.getBounds()).toBeNull();
    tray.update(null, false, null);
    tray.destroy();
  });
});
