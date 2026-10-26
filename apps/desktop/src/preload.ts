import type { WarmUpRequest } from "@omp-toolkit/core";
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type OmpApi, type PanelState, type RendererToMainEvents } from "./ipc";
import type { DesktopSettings } from "./settings";

function sendIpc<K extends keyof RendererToMainEvents>(
  channel: K,
  ...args: Parameters<RendererToMainEvents[K]>
): void {
  ipcRenderer.send(channel, ...args);
}

const api: OmpApi = {
  onState(callback: (state: PanelState) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, state: PanelState) => {
      callback(state);
    };
    ipcRenderer.on(IPC.state, listener);
    sendIpc(IPC.ready);

    return () => {
      ipcRenderer.removeListener(IPC.state, listener);
    };
  },
  refresh(): void {
    sendIpc(IPC.refresh);
  },
  hide(): void {
    sendIpc(IPC.hide);
  },
  openTerminal(): void {
    sendIpc(IPC.openTerminal);
  },
  openOrca(): void {
    sendIpc(IPC.openOrca);
  },
  warmup(request: WarmUpRequest): void {
    sendIpc(IPC.warmup, request);
  },
  saveSettings(settings: DesktopSettings): void {
    sendIpc(IPC.saveSettings, settings);
  },
};

contextBridge.exposeInMainWorld("omp", api);
