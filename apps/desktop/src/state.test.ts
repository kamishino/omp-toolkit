import { describe, expect, test } from "bun:test";
import type { Dashboard } from "@omp-toolkit/core";
import { computePanelState } from "./state";

const mockDashboard: Dashboard = {
  fetchedAt: 1000,
  providers: [],
  summary: {
    providers: 0,
    accounts: 0,
    above80: 0,
    maxed: 0,
    aboveThreshold: 0,
    tightest: null,
  },
  health: null,
  balance: null,
  tooltip: "mock",
  iconLevel: "ok",
};

const defaultWarmup = { running: false, message: null };

describe("computePanelState", () => {
  test("returns loading state when refreshing", () => {
    const state = computePanelState({
      intervalSeconds: 60,
      lastDashboard: mockDashboard,
      refreshing: true,
      lastError: null,
      warmup: defaultWarmup,
    });
    expect(state.status).toBe("loading");
    expect(state.data).toBe(mockDashboard);
    expect(state.intervalSeconds).toBe(60);
  });

  test("returns error state when lastError is set and not refreshing", () => {
    const state = computePanelState({
      intervalSeconds: 60,
      lastDashboard: mockDashboard,
      refreshing: false,
      lastError: "Failed to fetch",
      warmup: defaultWarmup,
    });
    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.message).toBe("Failed to fetch");
      expect(state.data).toBe(mockDashboard);
    }
  });

  test("returns ready state when lastDashboard is present and no error", () => {
    const state = computePanelState({
      intervalSeconds: 30,
      lastDashboard: mockDashboard,
      refreshing: false,
      lastError: null,
      warmup: defaultWarmup,
    });
    expect(state.status).toBe("ready");
    if (state.status === "ready") {
      expect(state.data).toBe(mockDashboard);
      expect(state.intervalSeconds).toBe(30);
    }
  });

  test("returns initial loading state when data is null and no error", () => {
    const state = computePanelState({
      intervalSeconds: 120,
      lastDashboard: null,
      refreshing: false,
      lastError: null,
      warmup: { running: true, message: "warming up..." },
    });
    expect(state.status).toBe("loading");
    expect(state.data).toBeNull();
    expect(state.warmup.running).toBe(true);
    expect(state.warmup.message).toBe("warming up...");
  });
});
