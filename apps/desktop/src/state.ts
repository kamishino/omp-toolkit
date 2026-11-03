import type { Dashboard } from "@omp-toolkit/core";
import type { GatewayPanelView, PanelState, WarmUpState } from "./ipc";
import { UNKNOWN_GATEWAY_PANEL_VIEW } from "./ipc";
import type { DesktopSettings } from "./settings";

export interface PanelStateOptions {
  intervalSeconds: number;
  lastDashboard: Dashboard | null;
  refreshing: boolean;
  lastError: string | null;
  warmup: WarmUpState;
  settings: DesktopSettings;
  gateway?: GatewayPanelView;
}

export function computePanelState(options: PanelStateOptions): PanelState {
  const { intervalSeconds, lastDashboard, refreshing, lastError, warmup, settings } = options;
  const gateway = options.gateway ?? UNKNOWN_GATEWAY_PANEL_VIEW;

  if (refreshing) {
    return { status: "loading", data: lastDashboard, intervalSeconds, warmup, settings, gateway };
  }

  if (lastError) {
    return {
      status: "error",
      data: lastDashboard,
      message: lastError,
      intervalSeconds,
      warmup,
      settings,
      gateway,
    };
  }

  if (lastDashboard) {
    return { status: "ready", data: lastDashboard, intervalSeconds, warmup, settings, gateway };
  }

  return { status: "loading", data: null, intervalSeconds, warmup, settings, gateway };
}
