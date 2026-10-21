import { contextBridge, ipcRenderer } from "electron";
import { IPC, type OmpApi, type PanelState } from "./ipc";

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
};

contextBridge.exposeInMainWorld("omp", api);
