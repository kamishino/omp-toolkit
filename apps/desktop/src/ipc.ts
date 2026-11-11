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
  [IPC.resize]: (height: number) => void;
}

export interface SettingsSaveResult {
  valid: boolean;
  errors: string[];
}

export interface MainToRendererEvents {
  [IPC.state]: (state: PanelState) => void;
  [IPC.openSettings]: () => void;
}

export interface WarmUpState {
  running: boolean;
  message: string | null;
}

/**
 * Fixed user-recorded OMP build reference, captured before provider-policy
 * experimentation. Never overwritten by refresh, restart, or auto-update.
 */
export const OMP_VERSION_CHECKPOINT = {
  version: "18.18.6",
  sha256: "dfb15c27cb2ea192a94761c26aa5cd4eed54b1e0a5a85c02938ab07d769bc8f7",
  capturedAt: "2026-11-10T10:42:31.883Z",
  releaseUrl: "https://github.com/can1357/oh-my-pi/releases/tag/v18.18.6",
  policyUrl: "https://github.com/can1357/oh-my-pi/pull/18622",
  reason:
    "Google may restrict accounts that use Antigravity outside its own apps, so this provider is paused for now.",
} as const;

/** Read-only identity of the OMP build the panel is running against. */
export interface OmpBuildView {
  version: string | null;
  sha256: string | null;
  comparison: "same" | "changed" | "unknown";
  builtInAntigravityPolicy: "documented-pause" | "unverified";
  healthProbesEnabled: boolean;
  inspectionError: string | null;
}

export const UNKNOWN_OMP_BUILD_VIEW: OmpBuildView = {
  version: null,
  sha256: null,
  comparison: "unknown",
  builtInAntigravityPolicy: "unverified",
  healthProbesEnabled: false,
  inspectionError: null,
};

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
  /** Mirrors the gateway setup outcome; present when the gateway returned setup JSON. */
  outcome?: "applied" | "noop" | "partial" | "failed";
  /** Mirrors the gateway audit state; present when the gateway returned setup JSON. */
  audit?: "recorded" | "unavailable" | "not-attempted";
  message?: string;
}

export type GatewayPanelStateKind = "active" | "off" | "error" | "unknown";

export type GatewayAccessState = "ok" | "denied" | "error" | "unknown";

export interface GatewayPanelView {
  state: GatewayPanelStateKind;
  /** Tray-compatible one-liner, e.g. "Gateway: Alive · access verified". */
  label: string;
  /** Complete normalized gateway URL, e.g. "http://127.0.0.1:4000". */
  endpoint: string;
  /** Authenticated catalogue access; independent of process liveness. */
  access: GatewayAccessState;
  accessHttpStatus: number | null;
  modelCount: number | null;
  antigravityModelCount: number | null;
  clientCount: number | null;
  checkedAt: number | null;
}

export const UNKNOWN_GATEWAY_PANEL_VIEW: GatewayPanelView = {
  state: "unknown",
  label: "Gateway: …",
  endpoint: "http://127.0.0.1:4000",
  access: "unknown",
  accessHttpStatus: null,
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
      ompBuild?: OmpBuildView;
    }
  | {
      status: "ready";
      data: Dashboard;
      intervalSeconds: number;
      warmup: WarmUpState;
      settings: DesktopSettings;
      gateway?: GatewayPanelView;
      ompBuild?: OmpBuildView;
    }
  | {
      status: "error";
      data: Dashboard | null;
      message: string;
      intervalSeconds: number;
      warmup: WarmUpState;
      settings: DesktopSettings;
      gateway?: GatewayPanelView;
      ompBuild?: OmpBuildView;
    };

export interface OmpApi {
  onState(callback: (state: PanelState) => void): () => void;
  refresh(): void;
  hide(): void;
  openTerminal(): void;
  openOrca(): void;
  warmup(request: WarmUpRequest): void;
  saveSettings(settings: DesktopSettings): Promise<SettingsSaveResult>;
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
