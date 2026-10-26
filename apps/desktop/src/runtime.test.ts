import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Dashboard } from "@omp-toolkit/core";
import { DesktopRuntime } from "./runtime";
import { DEFAULT_DESKTOP_SETTINGS } from "./settings";

function dummyDashboard(): Dashboard {
  return {
    fetchedAt: Date.now(),
    providers: [],
    summary: {
      providers: 0,
      accounts: 0,
      above80: 0,
      maxed: 0,
      aboveThreshold: 0.8,
      tightest: null,
    },
    health: null,
    balance: null,
    tooltip: "OMP: ok",
    iconLevel: "ok",
  };
}

describe("DesktopRuntime deep coordinator", () => {
  test("initializes with default settings and notifies initial state", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-runtime-test-"));
    try {
      const runtime = new DesktopRuntime({
        userDataDir: tmpDir,
        checkoutRoot: tmpDir,
      });

      let receivedState: unknown = null;
      const unsubscribe = runtime.subscribe((s) => {
        receivedState = s;
      });

      expect(receivedState).toBeDefined();
      expect(runtime.getSettings().intervalSeconds).toBe(DEFAULT_DESKTOP_SETTINGS.intervalSeconds);
      expect(runtime.getState().status).toBe("loading");

      unsubscribe();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("refresh updates state to ready with fetched dashboard", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-runtime-test-"));
    try {
      const dashboard = dummyDashboard();
      const runtime = new DesktopRuntime({
        userDataDir: tmpDir,
        checkoutRoot: tmpDir,
        fetchDashboardFn: async () => dashboard,
      });

      const states: string[] = [];
      runtime.subscribe((s) => {
        states.push(s.status);
      });

      await runtime.refresh();

      expect(states).toContain("loading");
      expect(states).toContain("ready");
      expect(runtime.getState().status).toBe("ready");
      expect(runtime.getDashboard()).toEqual(dashboard);
      expect(runtime.getLastError()).toBeNull();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("refresh catches error and updates state to error", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-runtime-test-"));
    try {
      const runtime = new DesktopRuntime({
        userDataDir: tmpDir,
        checkoutRoot: tmpDir,
        fetchDashboardFn: async () => {
          throw new Error("Simulated failure");
        },
      });

      await runtime.refresh();

      expect(runtime.getState().status).toBe("error");
      expect(runtime.getLastError()).toBe("Simulated failure");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("updateSettings persists valid settings and notifies listeners", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-runtime-test-"));
    try {
      let loginEnabled = false;
      const mockLoginItem = {
        isEnabled: () => loginEnabled,
        setEnabled: (val: boolean) => {
          loginEnabled = val;
        },
      };

      const runtime = new DesktopRuntime({
        userDataDir: tmpDir,
        checkoutRoot: tmpDir,
        loginItem: mockLoginItem,
      });

      const res = runtime.updateSettings({
        intervalSeconds: 60,
        balanceAlert: { cny: 15, usd: 20 },
        theme: "dark",
        openAtLogin: true,
      });

      expect(res.valid).toBe(true);
      expect(runtime.getSettings().intervalSeconds).toBe(60);
      expect(runtime.getSettings().theme).toBe("dark");
      expect(loginEnabled).toBe(true);

      const savedFile = path.join(tmpDir, "settings.json");
      expect(fs.existsSync(savedFile)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("setWarmUp notifies listeners with running and message", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-runtime-test-"));
    try {
      const runtime = new DesktopRuntime({
        userDataDir: tmpDir,
        checkoutRoot: tmpDir,
      });

      runtime.setWarmUp(true, "Warming up accounts...");
      expect(runtime.getState().warmup.running).toBe(true);
      expect(runtime.getState().warmup.message).toBe("Warming up accounts...");

      runtime.setWarmUp(false, "Done");
      expect(runtime.getState().warmup.running).toBe(false);
      expect(runtime.getState().warmup.message).toBe("Done");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
