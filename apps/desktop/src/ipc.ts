import type { Dashboard, WarmUpRequest } from "@omp-toolkit/core";
import type { DesktopSettings } from "./settings";

export const IPC = {
  state: "omp:state",
  refresh: "omp:refresh",
  hide: "omp:hide",
  openTerminal: "omp:open-terminal",
  openOrca: "omp:open-orca",
  ready: "omp:ready",
  warmup: "omp:warmup",
  saveSettings: "omp:save-settings",
  resize: "omp:resize",
  openSettings: "omp:open-settings",
  gatewayAction: "omp:gateway-action",
  gatewayConnect: "omp:gateway-connect",
} as const;

export interface RendererToMainEvents {
  [IPC.refresh]: () => void;
  [IPC.hide]: () => void;
  [IPC.openTerminal]: () => void;
  [IPC.openOrca]: () => void;
  [IPC.ready]: () => void;
  [IPC.warmup]: (request: WarmUpRequest) => void;
  [IPC.saveSettings]: (settings: DesktopSettings) => void;
  [IPC.resize]: (height: number) => void;
}

export interface MainToRendererEvents {
  [IPC.state]: (state: PanelState) => void;
  [IPC.openSettings]: () => void;
}

export interface WarmUpState {
  running: boolean;
  message: string | null;
}

export interface GatewayActionResult {
  success: boolean;
  message: string;
}

export interface GatewayConnectResult {
  success: boolean;
  clientName?: string;
  token?: string;
  recipe?: {
    platform: string;
    title: string;
    snippet: string;
  };
  message?: string;
}

export type GatewayPanelStateKind = "active" | "off" | "error" | "unknown";

export interface GatewayPanelView {
  state: GatewayPanelStateKind;
  /** Tray-compatible one-liner, e.g. "Gateway: Active (:4000)". */
  label: string;
  endpoint: string;
  modelCount: number | null;
  antigravityModelCount: number | null;
  clientCount: number | null;
  checkedAt: number | null;
}

export const UNKNOWN_GATEWAY_PANEL_VIEW: GatewayPanelView = {
  state: "unknown",
  label: "Gateway: …",
  endpoint: "127.0.0.1:4000",
  modelCount: null,
  antigravityModelCount: null,
  clientCount: null,
  checkedAt: null,
};

export type PanelState =
  | {
      status: "loading";
      data: Dashboard | null;
      intervalSeconds: number;
      warmup: WarmUpState;
      settings: DesktopSettings;
      gateway?: GatewayPanelView;
    }
  | {
      status: "ready";
      data: Dashboard;
      intervalSeconds: number;
      warmup: WarmUpState;
      settings: DesktopSettings;
      gateway?: GatewayPanelView;
    }
  | {
      status: "error";
      data: Dashboard | null;
      message: string;
      intervalSeconds: number;
      warmup: WarmUpState;
      settings: DesktopSettings;
      gateway?: GatewayPanelView;
    };

export interface OmpApi {
  onState(callback: (state: PanelState) => void): () => void;
  refresh(): void;
  hide(): void;
  openTerminal(): void;
  openOrca(): void;
  warmup(request: WarmUpRequest): void;
  saveSettings(settings: DesktopSettings): void;
  resize(height: number): void;
  onOpenSettings(callback: () => void): () => void;
  gatewayAction(action: "start" | "stop" | "restart" | "doctor"): Promise<GatewayActionResult>;
  gatewayConnect(platform: string, name?: string): Promise<GatewayConnectResult>;
}

declare global {
  interface Window {
    omp: OmpApi;
  }
}
