import type { Dashboard } from "@omp-toolkit/core";
import type { PanelState, WarmUpState } from "./ipc";

export interface PanelStateOptions {
  intervalSeconds: number;
  lastDashboard: Dashboard | null;
  refreshing: boolean;
  lastError: string | null;
  warmup: WarmUpState;
}

export function computePanelState(options: PanelStateOptions): PanelState {
  const { intervalSeconds, lastDashboard, refreshing, lastError, warmup } = options;

  if (refreshing) {
    return {
      status: "loading",
      data: lastDashboard,
      intervalSeconds,
      warmup,
    };
  }

  if (lastError) {
    return {
      status: "error",
      data: lastDashboard,
      message: lastError,
      intervalSeconds,
      warmup,
    };
  }

  if (lastDashboard) {
    return {
      status: "ready",
      data: lastDashboard,
      intervalSeconds,
      warmup,
    };
  }

  return {
    status: "loading",
    data: null,
    intervalSeconds,
    warmup,
  };
}
