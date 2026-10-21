import type { Dashboard } from "@omp-toolkit/core";

export const IPC = {
  state: "omp:state",
  refresh: "omp:refresh",
  hide: "omp:hide",
  openTerminal: "omp:open-terminal",
  openOrca: "omp:open-orca",
  ready: "omp:ready",
} as const;

export type PanelState =
  | { status: "loading"; data: Dashboard | null; intervalSeconds: number }
  | { status: "ready"; data: Dashboard; intervalSeconds: number }
  | { status: "error"; data: Dashboard | null; message: string; intervalSeconds: number };

export interface OmpApi {
  onState(callback: (state: PanelState) => void): () => void;
  refresh(): void;
  hide(): void;
  openTerminal(): void;
  openOrca(): void;
}

declare global {
  interface Window {
    omp: OmpApi;
  }
}
