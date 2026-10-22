import type { Dashboard, WarmUpRequest } from "@omp-toolkit/core";

export const IPC = {
  state: "omp:state",
  refresh: "omp:refresh",
  hide: "omp:hide",
  openTerminal: "omp:open-terminal",
  openOrca: "omp:open-orca",
  ready: "omp:ready",
  warmup: "omp:warmup",
} as const;

export interface WarmUpState {
  running: boolean;
  message: string | null;
}

export type PanelState =
  | { status: "loading"; data: Dashboard | null; intervalSeconds: number; warmup: WarmUpState }
  | { status: "ready"; data: Dashboard; intervalSeconds: number; warmup: WarmUpState }
  | {
      status: "error";
      data: Dashboard | null;
      message: string;
      intervalSeconds: number;
      warmup: WarmUpState;
    };

export interface OmpApi {
  onState(callback: (state: PanelState) => void): () => void;
  refresh(): void;
  hide(): void;
  openTerminal(): void;
  openOrca(): void;
  warmup(request: WarmUpRequest): void;
}

declare global {
  interface Window {
    omp: OmpApi;
  }
}
