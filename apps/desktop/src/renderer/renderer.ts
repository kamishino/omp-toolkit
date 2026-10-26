import { mdiClose, mdiCog, mdiRefresh, mdiWindowMinimize } from "@mdi/js";
import { formatAge, summaryText } from "@omp-toolkit/core";
import type { PanelState } from "../ipc";
import { DEFAULT_DESKTOP_SETTINGS, type DesktopSettings } from "../settings";
import { renderProviderCard } from "./card";
import { icon } from "./icon";
import { renderSettingsView, type SettingsViewController } from "./settings-view";
import { applyTheme, applyThemePreference, getActiveThemePreference } from "./tokens";

const media = window.matchMedia("(prefers-color-scheme: dark)");
applyTheme(media.matches ? "dark" : "light");
media.addEventListener("change", (e) => {
  if (getActiveThemePreference() === "system") {
    applyTheme(e.matches ? "dark" : "light");
  }
});

let activeTab: "dashboard" | "settings" = "dashboard";
let activeSettingsController: SettingsViewController | null = null;
let toastMessage: string | null = null;
let toastTimer: number | null = null;

function showToast(message: string): void {
  toastMessage = message;
  if (toastTimer !== null) {
    clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    toastMessage = null;
    render();
  }, 2500);
  render();
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildPanel(state: PanelState): HTMLElement {
  if (activeSettingsController) {
    activeSettingsController.destroy();
    activeSettingsController = null;
  }
  const panel = document.createElement("div");
  panel.className = "panel";

  // Header
  const header = document.createElement("header");
  header.className = "header";

  const headerLeft = document.createElement("div");
  const h1 = document.createElement("h1");
  h1.className = "title";
  h1.textContent = "OMP PROVIDER USAGE";
  headerLeft.appendChild(h1);

  const subtitle = document.createElement("p");
  subtitle.className = "subtitle";
  subtitle.setAttribute("aria-live", "polite");

  if (state.status === "error") {
    subtitle.className = "subtitle status-error";
    subtitle.textContent = `Refresh failed: ${state.message ?? "Unknown error"}`;
    if (state.message) {
      subtitle.title = state.message;
    }
  } else if (state.status === "loading") {
    subtitle.textContent = state.data ? "Refreshing..." : "Loading...";
  } else {
    subtitle.textContent = `updated ${formatTime(state.data.fetchedAt)}`;
  }
  headerLeft.appendChild(subtitle);
  header.appendChild(headerLeft);

  const actions = document.createElement("div");
  actions.className = "actions";

  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.className = "icon-button";
  refreshBtn.setAttribute("aria-label", "Refresh");
  refreshBtn.title = "Refresh now";
  refreshBtn.appendChild(icon(mdiRefresh));
  if (state.status === "loading" || state.warmup.running) {
    refreshBtn.disabled = true;
  }
  refreshBtn.addEventListener("click", () => {
    window.omp.refresh();
  });
  actions.appendChild(refreshBtn);

  const settingsBtn = document.createElement("button");
  settingsBtn.type = "button";
  settingsBtn.className = activeTab === "settings" ? "icon-button active" : "icon-button";
  settingsBtn.setAttribute("aria-label", "Settings");
  settingsBtn.title = "Settings";
  settingsBtn.appendChild(icon(mdiCog));
  settingsBtn.addEventListener("click", () => {
    activeTab = activeTab === "settings" ? "dashboard" : "settings";
    render();
  });
  actions.appendChild(settingsBtn);

  const minimizeBtn = document.createElement("button");
  minimizeBtn.type = "button";
  minimizeBtn.className = "icon-button";
  minimizeBtn.setAttribute("aria-label", "Minimize to tray");
  minimizeBtn.title = "Minimize to tray";
  minimizeBtn.appendChild(icon(mdiWindowMinimize));
  minimizeBtn.addEventListener("click", () => {
    window.omp.hide();
  });
  actions.appendChild(minimizeBtn);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "icon-button";
  closeBtn.setAttribute("aria-label", "Close to tray");
  closeBtn.title = "Close to tray";
  closeBtn.appendChild(icon(mdiClose));
  closeBtn.addEventListener("click", () => {
    window.omp.hide();
  });
  actions.appendChild(closeBtn);
  header.appendChild(actions);
  panel.appendChild(header);

  if (activeTab === "settings") {
    activeSettingsController = renderSettingsView(
      state.settings,
      (updatedSettings: DesktopSettings) => {
        activeSettingsController = null;
        window.omp.saveSettings(updatedSettings);
        activeTab = "dashboard";
        showToast("Settings saved");
      },
      () => {
        activeSettingsController = null;
        activeTab = "dashboard";
        render();
      },
    );
    panel.appendChild(activeSettingsController.element);
  } else {
    // Summary
    const summaryP = document.createElement("p");
    summaryP.className = "summary";
    if (state.data) {
      summaryP.textContent = summaryText(state.data.summary);
    } else {
      summaryP.textContent = "No usage data";
    }
    panel.appendChild(summaryP);
    if (state.warmup.message) {
      const warmupP = document.createElement("p");
      warmupP.className = "warmup-message";
      warmupP.setAttribute("role", "status");
      warmupP.textContent = state.warmup.message;
      panel.appendChild(warmupP);
    }

    // Content
    const content = document.createElement("div");
    content.className = "content";
    content.setAttribute("aria-busy", state.status === "loading" ? "true" : "false");

    if (!state.data) {
      const emptyDiv = document.createElement("div");
      emptyDiv.className = state.status === "error" ? "empty status-error" : "empty";

      const msgP = document.createElement("p");
      msgP.className = "empty-message";
      msgP.textContent =
        state.status === "error"
          ? `Refresh failed: ${state.message ?? "Unknown error"}`
          : "Loading usage data...";
      emptyDiv.appendChild(msgP);

      if (state.status === "error") {
        const retryBtn = document.createElement("button");
        retryBtn.type = "button";
        retryBtn.className = "button button-secondary";
        retryBtn.textContent = "Retry";
        retryBtn.addEventListener("click", () => {
          window.omp.refresh();
        });
        emptyDiv.appendChild(retryBtn);
      }

      content.appendChild(emptyDiv);
    } else {
      const hasAnyRoute = state.data.providers.some((p) => p.rows.some((r) => r.health !== null));

      let idx = 0;
      for (const provider of state.data.providers) {
        content.appendChild(renderProviderCard(provider, hasAnyRoute, idx++, state));
      }
    }

    panel.appendChild(content);

    // Footer
    const footer = document.createElement("footer");
    footer.className = "footer";

    let healthPart = "";
    if (state.data?.health) {
      const h = state.data.health;
      const ageStr = h.checkedAt > 0 ? formatAge(h.checkedAt, Date.now(), true) : "no snapshot";
      healthPart = ` · health ${ageStr}${h.stale ? " (stale)" : ""}`;
    }

    footer.textContent = `Source: omp usage${healthPart} · refresh ${state.intervalSeconds}s`;
    panel.appendChild(footer);
  }

  if (toastMessage) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = toastMessage;
    panel.appendChild(toast);
  }

  return panel;
}

let currentState: PanelState = {
  status: "loading",
  data: null,
  intervalSeconds: 300,
  warmup: { running: false, message: null },
  settings: DEFAULT_DESKTOP_SETTINGS,
};

function render(): void {
  const app = document.querySelector("#app");
  if (!app) return;

  const prevContent = app.querySelector(".content, .settings-view");
  const scrollTop = prevContent ? prevContent.scrollTop : 0;

  app.replaceChildren(buildPanel(currentState));

  const newContent = app.querySelector(".content, .settings-view");
  if (newContent) {
    newContent.scrollTop = scrollTop;
  }
}

render();

window.omp.onState((state) => {
  currentState = state;
  applyThemePreference(state.settings.theme);
  render();
});
