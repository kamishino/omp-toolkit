import { type Dashboard, summaryText, truncate } from "@omp-toolkit/core";

export interface TrayMenuTemplateOptions {
  isPanelVisible: boolean;
  isAutostart: boolean;
  isRefreshing: boolean;
  lastDashboard: Dashboard | null;
  lastError: string | null;
  gatewayStatus?: string;
  onRefreshNow: () => void | Promise<void>;
  onTogglePanel: () => void;
  onOpenSettings?: () => void;
  onOpenTerminal: () => void;
  onOpenOrca: () => void;
  onToggleAutostart: (checked: boolean) => void;
  onQuit: () => void;
}

export interface TrayMenuItem {
  label?: string;
  type?: "separator" | "checkbox" | "normal";
  enabled?: boolean;
  checked?: boolean;
  click?: (item: { checked: boolean }) => void;
}

export function buildTrayMenuTemplate(options: TrayMenuTemplateOptions): TrayMenuItem[] {
  let statusLabel = "OMP: Loading usage data...";
  if (options.lastError && !options.lastDashboard) {
    statusLabel = "OMP: Refresh failed";
  } else if (options.lastDashboard) {
    statusLabel = truncate(`OMP: ${summaryText(options.lastDashboard.summary)}`, 80);
  }

  return [
    {
      label: statusLabel,
      enabled: false,
    },
    ...(options.gatewayStatus
      ? [
          {
            label: options.gatewayStatus,
            enabled: false,
          },
        ]
      : []),
    { type: "separator" },
    {
      label: options.isRefreshing ? "Refreshing..." : "Refresh now",
      enabled: !options.isRefreshing,
      click: () => {
        void options.onRefreshNow();
      },
    },
    {
      label: options.isPanelVisible ? "Minimize to tray" : "Show panel",
      click: () => {
        options.onTogglePanel();
      },
    },
    ...(options.onOpenSettings
      ? [
          {
            label: "Settings...",
            click: () => {
              options.onOpenSettings?.();
            },
          },
        ]
      : []),
    { type: "separator" },
    {
      label: "Open terminal monitor",
      click: () => {
        options.onOpenTerminal();
      },
    },
    {
      label: "Open Orca tab",
      click: () => {
        options.onOpenOrca();
      },
    },
    { type: "separator" },
    {
      label: "Start at login",
      type: "checkbox",
      checked: options.isAutostart,
      click: (item: { checked: boolean }) => {
        options.onToggleAutostart(item.checked);
      },
    },
    { type: "separator" },
    {
      label: "Exit",
      click: () => {
        options.onQuit();
      },
    },
  ];
}
