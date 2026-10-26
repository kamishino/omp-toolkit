import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_DESKTOP_SETTINGS,
  type DesktopSettings,
  loadDesktopSettings,
  saveDesktopSettings,
  settingsFilePath,
  validateDesktopSettings,
} from "./settings";

describe("desktop settings module", () => {
  test("validateDesktopSettings verifies valid settings", () => {
    const valid: DesktopSettings = {
      intervalSeconds: 120,
      balanceAlert: { cny: 15, usd: 10 },
      theme: "dark",
      openAtLogin: true,
    };
    const res = validateDesktopSettings(valid);
    expect(res.valid).toBe(true);
    expect(res.errors.length).toBe(0);
  });

  test("validateDesktopSettings rejects invalid values", () => {
    expect(validateDesktopSettings(null).valid).toBe(false);
    expect(
      validateDesktopSettings({ ...DEFAULT_DESKTOP_SETTINGS, intervalSeconds: 10 }).valid,
    ).toBe(false);
    expect(
      validateDesktopSettings({
        ...DEFAULT_DESKTOP_SETTINGS,
        balanceAlert: { cny: -1, usd: 5 },
      }).valid,
    ).toBe(false);
    expect(
      validateDesktopSettings({
        ...DEFAULT_DESKTOP_SETTINGS,
        theme: "invalid" as unknown as DesktopSettings["theme"],
      }).valid,
    ).toBe(false);
  });
  test("saveDesktopSettings writes settings.json atomically", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-settings-test-"));
    try {
      const custom: DesktopSettings = {
        intervalSeconds: 60,
        balanceAlert: { cny: 25, usd: 20 },
        theme: "light",
        openAtLogin: true,
      };
      saveDesktopSettings(tmpDir, custom);
      const file = settingsFilePath(tmpDir);
      expect(fs.existsSync(file)).toBe(true);
      const loaded = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(loaded.intervalSeconds).toBe(60);
      expect(loaded.theme).toBe("light");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("loadDesktopSettings falls back to defaults when no file or env exists", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-settings-test-"));
    try {
      const settings = loadDesktopSettings({ userDataDir: tmpDir, env: {} });
      expect(settings.intervalSeconds).toBe(300);
      expect(settings.theme).toBe("system");
      expect(settings.balanceAlert.cny).toBe(10);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("loadDesktopSettings respects environment variables when file is missing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-settings-test-"));
    try {
      const settings = loadDesktopSettings({
        userDataDir: tmpDir,
        env: {
          OMP_WIDGET_INTERVAL_SECONDS: "90",
          DEEPSEEK_BALANCE_ALERT_CNY: "50",
          DEEPSEEK_BALANCE_ALERT_USD: "40",
        },
      });
      expect(settings.intervalSeconds).toBe(90);
      expect(settings.balanceAlert.cny).toBe(50);
      expect(settings.balanceAlert.usd).toBe(40);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("loadDesktopSettings prioritizes file over environment variables", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-settings-test-"));
    try {
      const saved: DesktopSettings = {
        intervalSeconds: 120,
        balanceAlert: { cny: 15, usd: 15 },
        theme: "dark",
        openAtLogin: true,
      };
      saveDesktopSettings(tmpDir, saved);

      const settings = loadDesktopSettings({
        userDataDir: tmpDir,
        env: {
          OMP_WIDGET_INTERVAL_SECONDS: "900",
        },
      });
      expect(settings.intervalSeconds).toBe(120);
      expect(settings.theme).toBe("dark");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("loadDesktopSettings prioritizes CLI flags over file and environment", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-settings-test-"));
    try {
      const saved: DesktopSettings = {
        intervalSeconds: 120,
        balanceAlert: { cny: 15, usd: 15 },
        theme: "dark",
        openAtLogin: true,
      };
      saveDesktopSettings(tmpDir, saved);

      const settings = loadDesktopSettings({
        userDataDir: tmpDir,
        argv: ["--interval=60"],
        env: {
          OMP_WIDGET_INTERVAL_SECONDS: "900",
        },
      });
      expect(settings.intervalSeconds).toBe(60);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("loadDesktopSettings gracefully recovers from corrupt JSON file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-settings-test-"));
    try {
      const file = settingsFilePath(tmpDir);
      fs.writeFileSync(file, "{ invalid json", "utf8");

      const settings = loadDesktopSettings({ userDataDir: tmpDir, env: {} });
      expect(settings.intervalSeconds).toBe(300);
      expect(settings.theme).toBe("system");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
