import { describe, expect, test } from "bun:test";
import type { Dashboard } from "@omp-toolkit/core";
import { buildTrayMenuTemplate } from "./tray-menu";

function mockDashboard(): Dashboard {
  return {
    fetchedAt: Date.now(),
    providers: [
      {
        id: "muse-code",
        name: "MUSE CODE",
        suffix: "",
        accounts: 1,
        columns: [],
        rows: [],
      },
    ],
    summary: {
      providers: 1,
      accounts: 1,
      above80: 0,
      maxed: 0,
      aboveThreshold: 0.8,
      tightest: { provider: "muse", account: "user", usedFraction: 0.31 },
    },
    health: null,
    balance: null,
    tooltip: "OMP: ok",
    iconLevel: "ok",
  };
}

describe("buildTrayMenuTemplate", () => {
  test("generates disabled status header with live summary when dashboard is loaded", () => {
    const template = buildTrayMenuTemplate({
      isPanelVisible: false,
      isAutostart: false,
      isRefreshing: false,
      lastDashboard: mockDashboard(),
      lastError: null,
      onRefreshNow: () => {},
      onTogglePanel: () => {},
      onOpenTerminal: () => {},
      onOpenOrca: () => {},
      onToggleAutostart: () => {},
      onQuit: () => {},
    });

    const header = template[0];
    expect(header.enabled).toBe(false);
    expect(header.label).toContain("OMP: 1 providers · 1 accounts");
    expect(header.label).toContain("tightest muse:user 31%");
  });

  test("generates loading status when dashboard is null or isRefreshing is true", () => {
    const template = buildTrayMenuTemplate({
      isPanelVisible: false,
      isAutostart: false,
      isRefreshing: true,
      lastDashboard: null,
      lastError: null,
      onRefreshNow: () => {},
      onTogglePanel: () => {},
      onOpenTerminal: () => {},
      onOpenOrca: () => {},
      onToggleAutostart: () => {},
      onQuit: () => {},
    });

    expect(template[0].label).toBe("OMP: Loading usage data...");
    expect(template[0].enabled).toBe(false);
  });

  test("generates error status when lastError is set and dashboard is null", () => {
    const template = buildTrayMenuTemplate({
      isPanelVisible: false,
      isAutostart: false,
      isRefreshing: false,
      lastDashboard: null,
      lastError: "Network timeout",
      onRefreshNow: () => {},
      onTogglePanel: () => {},
      onOpenTerminal: () => {},
      onOpenOrca: () => {},
      onToggleAutostart: () => {},
      onQuit: () => {},
    });

    expect(template[0].label).toBe("OMP: Refresh failed");
  });

  test("includes Settings... item and invokes onOpenSettings on click", () => {
    let settingsCalled = false;
    const template = buildTrayMenuTemplate({
      isPanelVisible: false,
      isAutostart: false,
      isRefreshing: false,
      lastDashboard: mockDashboard(),
      lastError: null,
      onRefreshNow: () => {},
      onTogglePanel: () => {},
      onOpenSettings: () => {
        settingsCalled = true;
      },
      onOpenTerminal: () => {},
      onOpenOrca: () => {},
      onToggleAutostart: () => {},
      onQuit: () => {},
    });

    const settingsItem = template.find((item) => item.label === "Settings...");
    expect(settingsItem).toBeDefined();
    settingsItem?.click?.({ checked: false });
    expect(settingsCalled).toBe(true);
  });

  test("switches toggle panel label based on isPanelVisible", () => {
    const hidden = buildTrayMenuTemplate({
      isPanelVisible: false,
      isAutostart: false,
      isRefreshing: false,
      lastDashboard: null,
      lastError: null,
      onRefreshNow: () => {},
      onTogglePanel: () => {},
      onOpenTerminal: () => {},
      onOpenOrca: () => {},
      onToggleAutostart: () => {},
      onQuit: () => {},
    });
    expect(hidden.some((i) => i.label === "Show panel")).toBe(true);
    expect(hidden.some((i) => i.label === "Minimize to tray")).toBe(false);

    const visible = buildTrayMenuTemplate({
      isPanelVisible: true,
      isAutostart: false,
      isRefreshing: false,
      lastDashboard: null,
      lastError: null,
      onRefreshNow: () => {},
      onTogglePanel: () => {},
      onOpenTerminal: () => {},
      onOpenOrca: () => {},
      onToggleAutostart: () => {},
      onQuit: () => {},
    });
    expect(visible.some((i) => i.label === "Minimize to tray")).toBe(true);
    expect(visible.some((i) => i.label === "Show panel")).toBe(false);
  });
});
