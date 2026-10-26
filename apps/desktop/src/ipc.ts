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
} as const;

export interface RendererToMainEvents {
  [IPC.refresh]: () => void;
  [IPC.hide]: () => void;
  [IPC.openTerminal]: () => void;
  [IPC.openOrca]: () => void;
  [IPC.ready]: () => void;
  [IPC.warmup]: (request: WarmUpRequest) => void;
  [IPC.saveSettings]: (settings: DesktopSettings) => void;
}

export interface MainToRendererEvents {
  [IPC.state]: (state: PanelState) => void;
}

export interface WarmUpState {
  running: boolean;
  message: string | null;
}

export type PanelState =
  | {
      status: "loading";
      data: Dashboard | null;
      intervalSeconds: number;
      warmup: WarmUpState;
      settings: DesktopSettings;
    }
  | {
      status: "ready";
      data: Dashboard;
      intervalSeconds: number;
      warmup: WarmUpState;
      settings: DesktopSettings;
    }
  | {
      status: "error";
      data: Dashboard | null;
      message: string;
      intervalSeconds: number;
      warmup: WarmUpState;
      settings: DesktopSettings;
    };

export interface OmpApi {
  onState(callback: (state: PanelState) => void): () => void;
  refresh(): void;
  hide(): void;
  openTerminal(): void;
  openOrca(): void;
  warmup(request: WarmUpRequest): void;
  saveSettings(settings: DesktopSettings): void;
}

declare global {
  interface Window {
    omp: OmpApi;
  }
}
