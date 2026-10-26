import { describe, expect, test } from "bun:test";
import { placePanel } from "./panel-position";

describe("placePanel positioning", () => {
  const panel = { width: 600, height: 640 };
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

  test("places above bottom taskbar on win32", () => {
    const tray = { x: 1800, y: 1040, width: 24, height: 24 };
    const res = placePanel({
      tray,
      workArea,
      panel,
      platform: "win32",
      margin: 12,
    });
    // panel width=600, height=640
    // maxX = 1920 - 600 - 12 = 1308
    // maxY = 1040 - 640 - 12 = 388
    expect(res.width).toBe(600);
    expect(res.height).toBe(640);
    expect(res.x).toBe(1308);
    expect(res.y).toBe(388);
  });

  test("places below top taskbar on win32", () => {
    const tray = { x: 1800, y: 0, width: 24, height: 24 };
    const res = placePanel({
      tray,
      workArea,
      panel,
      platform: "win32",
      margin: 12,
    });
    expect(res.x).toBe(1308);
    expect(res.y).toBe(12);
  });

  test("places left of right taskbar on win32", () => {
    const tray = { x: 1920, y: 500, width: 24, height: 24 };
    const res = placePanel({
      tray,
      workArea,
      panel,
      platform: "win32",
      margin: 12,
    });
    expect(res.x).toBe(1308);
    expect(res.y).toBe(192); // 500 + 12 - 320 = 192
  });

  test("centers below menu bar on darwin", () => {
    const tray = { x: 1500, y: 0, width: 24, height: 24 };
    const res = placePanel({
      tray,
      workArea,
      panel,
      platform: "darwin",
      margin: 12,
    });
    // center under tray: 1500 + 12 - 300 = 1212
    // y = 0 + 24 + 12 = 36
    expect(res.x).toBe(1212);
    expect(res.y).toBe(36);
  });

  test("places bottom-right on linux or when tray is absent", () => {
    const resLinux = placePanel({
      tray: { x: 100, y: 100, width: 24, height: 24 },
      workArea,
      panel,
      platform: "linux",
      margin: 12,
    });
    expect(resLinux.x).toBe(1308);
    expect(resLinux.y).toBe(388);

    const resNoTray = placePanel({
      tray: null,
      workArea,
      panel,
      platform: "win32",
      margin: 12,
    });
    expect(resNoTray.x).toBe(1308);
    expect(resNoTray.y).toBe(388);
  });

  test("clamps panel size when work area is smaller than requested dimensions", () => {
    const smallArea = { x: 0, y: 0, width: 400, height: 300 };
    const res = placePanel({
      tray: null,
      workArea: smallArea,
      panel,
      platform: "linux",
      margin: 12,
    });
    expect(res.width).toBe(400 - 24);
    expect(res.height).toBe(300 - 24);
    expect(res.x).toBe(12);
    expect(res.y).toBe(12);
  });
});
