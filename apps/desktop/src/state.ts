import type { Dashboard } from "@omp-toolkit/core";
import type { PanelState, WarmUpState } from "./ipc";
import type { DesktopSettings } from "./settings";

export interface PanelStateOptions {
  intervalSeconds: number;
  lastDashboard: Dashboard | null;
  refreshing: boolean;
  lastError: string | null;
  warmup: WarmUpState;
  settings: DesktopSettings;
}

export function computePanelState(options: PanelStateOptions): PanelState {
  const { intervalSeconds, lastDashboard, refreshing, lastError, warmup, settings } = options;

  if (refreshing) {
    return {
      status: "loading",
      data: lastDashboard,
      intervalSeconds,
      warmup,
      settings,
    };
  }

  if (lastError) {
    return {
      status: "error",
      data: lastDashboard,
      message: lastError,
      intervalSeconds,
      warmup,
      settings,
    };
  }

  if (lastDashboard) {
    return {
      status: "ready",
      data: lastDashboard,
      intervalSeconds,
      warmup,
      settings,
    };
  }

  return {
    status: "loading",
    data: null,
    intervalSeconds,
    warmup,
    settings,
  };
}
