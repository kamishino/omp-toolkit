import type { WarmUpRequest } from "@omp-toolkit/core";
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type OmpApi, type PanelState } from "./ipc";
import type { DesktopSettings } from "./settings";

const api: OmpApi = {
  onState(callback: (state: PanelState) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, state: PanelState) => {
      callback(state);
    };
    ipcRenderer.on(IPC.state, listener);
    ipcRenderer.send(IPC.ready);

    return () => {
      ipcRenderer.removeListener(IPC.state, listener);
    };
  },
  refresh(): void {
    ipcRenderer.send(IPC.refresh);
  },
  hide(): void {
    ipcRenderer.send(IPC.hide);
  },
  openTerminal(): void {
    ipcRenderer.send(IPC.openTerminal);
  },
  openOrca(): void {
    ipcRenderer.send(IPC.openOrca);
  },
  warmup(request: WarmUpRequest): void {
    ipcRenderer.send(IPC.warmup, request);
  },
  saveSettings(settings: DesktopSettings): void {
    ipcRenderer.send(IPC.saveSettings, settings);
  },
};

contextBridge.exposeInMainWorld("omp", api);
