import {
  mdiCheck,
  mdiChevronDown,
  mdiChevronRight,
  mdiClose,
  mdiCog,
  mdiContentCopy,
  mdiPlay,
  mdiRefresh,
  mdiRestart,
  mdiStethoscope,
  mdiStop,
  mdiWindowMinimize,
} from "@mdi/js";
import { type DashboardRow, formatAge } from "@omp-toolkit/core";
import type { PanelState } from "../ipc";
import { UNKNOWN_GATEWAY_PANEL_VIEW } from "../ipc";
import { DEFAULT_DESKTOP_SETTINGS, type DesktopSettings } from "../settings";
import { type FilterScope, renderProviderCard } from "./card";
import { icon } from "./icon";
import { renderSettingsView, type SettingsViewController } from "./settings-view";
import { themeManager } from "./tokens";

themeManager.init();

let activeTab: "dashboard" | "settings" = "dashboard";
let activeFilter: FilterScope = "all";
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

export function isSettingsShortcut(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): boolean {
  return Boolean(event.ctrlKey || event.metaKey) && event.key === ",";
}

export function buildIncidentBanner(state: PanelState, now = Date.now()): HTMLElement | null {
  const incident = state.data?.health?.incident;
  if (!incident || now - incident.at >= 86_400_000) return null;
  const banner = document.createElement("div");
  banner.className = "incident-banner";
  banner.setAttribute("role", "alert");
  banner.textContent = `Incident ${incident.kind} · ${formatAge(incident.at, now)} · ${incident.detail}`;
  return banner;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Gateway signal strip: infrastructure status above the usage summary.
 * Pool figures derive from the dashboard's Antigravity section so the strip
 * never needs its own credential-bearing fetch beyond the main probe.
 */
const GATEWAY_DRAWER_STORAGE_KEY = "omp.gatewayDrawerOpen";

export function isGatewayDrawerOpen(): boolean {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(GATEWAY_DRAWER_STORAGE_KEY) === "true"
    );
  } catch {
    return false;
  }
}

export function setGatewayDrawerOpen(open: boolean): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(GATEWAY_DRAWER_STORAGE_KEY, String(open));
    }
  } catch {
    // headless fallback
  }
}

export function buildGatewayStrip(state: PanelState): HTMLElement {
  const gateway = state.gateway ?? UNKNOWN_GATEWAY_PANEL_VIEW;
  let drawerOpen = isGatewayDrawerOpen();

  const container = el("section", "gateway-container");
  container.setAttribute("data-state", gateway.state);
  container.setAttribute("aria-label", gateway.label);

  const strip = el("div", "gateway-strip");

  const dot = el("span", "gw-dot");
  dot.setAttribute("aria-hidden", "true");
  strip.appendChild(dot);

  const main = el("div", "gw-main");
  const titleRow = el("div", "gw-title-row");
  titleRow.appendChild(el("span", "gw-name", "GATEWAY"));
  const stateLabel =
    gateway.state === "active"
      ? "Active"
      : gateway.state === "off"
        ? "Off"
        : gateway.state === "error"
          ? gateway.label.replace("Gateway: ", "")
          : "Checking…";
  titleRow.appendChild(el("span", "gw-state", stateLabel));
  main.appendChild(titleRow);

  const meta = el("p", "gw-meta");
  if (gateway.state === "active") {
    const parts = [gateway.endpoint];
    if (gateway.modelCount !== null) {
      parts.push(
        gateway.antigravityModelCount !== null
          ? `${gateway.modelCount} models · ${gateway.antigravityModelCount} Antigravity`
          : `${gateway.modelCount} models`,
      );
    }
    if (gateway.clientCount !== null) {
      parts.push(`${gateway.clientCount} client${gateway.clientCount === 1 ? "" : "s"}`);
    }
    meta.textContent = parts.join(" · ");
  } else if (gateway.state === "off") {
    meta.textContent = "start it with: bun run gateway:ctl start";
  } else if (gateway.state === "error") {
    meta.textContent = `${gateway.endpoint} · check: bun run gateway:ctl doctor`;
  } else {
    meta.textContent = `${gateway.endpoint} · probing…`;
  }
  main.appendChild(meta);
  strip.appendChild(main);

  const provider = state.data?.providers.find((p) => p.id === "google-antigravity");
  if (provider && gateway.state === "active") {
    const total = provider.rows.length;
    const degraded = provider.rows.filter(
      (r) => typeof r.health === "string" && r.health !== "ok",
    ).length;
    const pool = el("div", "gw-pool");
    pool.appendChild(el("span", "gw-pool-num", `${total - degraded}/${total}`));
    pool.appendChild(
      el(
        "span",
        degraded > 0 ? "gw-pool-cap gw-pool-warn" : "gw-pool-cap",
        degraded > 0 ? "accounts · degraded" : "accounts up",
      ),
    );
    strip.appendChild(pool);
  }

  // Action controls
  const controls = el("div", "gw-controls");

  const runAction = (action: "start" | "stop" | "restart" | "doctor", btn: HTMLButtonElement) => {
    btn.disabled = true;
    showToast(`Gateway ${action} in progress...`);
    if (typeof window !== "undefined" && window.omp?.gatewayAction) {
      void window.omp.gatewayAction(action).then((res) => {
        btn.disabled = false;
        showToast(
          res.success ? `Gateway ${action} completed` : `Gateway ${action} failed: ${res.message}`,
        );
      });
    }
  };

  if (gateway.state === "off" || gateway.state === "error") {
    const startBtn = el("button", "gw-action-btn") as HTMLButtonElement;
    startBtn.type = "button";
    startBtn.title = "Start Gateway";
    startBtn.setAttribute("aria-label", "Start Gateway");
    startBtn.appendChild(icon(mdiPlay));
    startBtn.addEventListener("click", () => runAction("start", startBtn));
    controls.appendChild(startBtn);

    const docBtn = el("button", "gw-action-btn") as HTMLButtonElement;
    docBtn.type = "button";
    docBtn.title = "Run Gateway Doctor";
    docBtn.setAttribute("aria-label", "Run Gateway Doctor");
    docBtn.appendChild(icon(mdiStethoscope));
    docBtn.addEventListener("click", () => runAction("doctor", docBtn));
    controls.appendChild(docBtn);
  } else if (gateway.state === "active") {
    const restartBtn = el("button", "gw-action-btn") as HTMLButtonElement;
    restartBtn.type = "button";
    restartBtn.title = "Restart Gateway";
    restartBtn.setAttribute("aria-label", "Restart Gateway");
    restartBtn.appendChild(icon(mdiRestart));
    restartBtn.addEventListener("click", () => runAction("restart", restartBtn));
    controls.appendChild(restartBtn);

    const stopBtn = el("button", "gw-action-btn") as HTMLButtonElement;
    stopBtn.type = "button";
    stopBtn.title = "Stop Gateway";
    stopBtn.setAttribute("aria-label", "Stop Gateway");
    stopBtn.appendChild(icon(mdiStop));
    stopBtn.addEventListener("click", () => runAction("stop", stopBtn));
    controls.appendChild(stopBtn);

    const docBtn = el("button", "gw-action-btn") as HTMLButtonElement;
    docBtn.type = "button";
    docBtn.title = "Run Gateway Doctor";
    docBtn.setAttribute("aria-label", "Run Gateway Doctor");
    docBtn.appendChild(icon(mdiStethoscope));
    docBtn.addEventListener("click", () => runAction("doctor", docBtn));
    controls.appendChild(docBtn);
  }

  const toggleBtn = el("button", "gw-toggle-btn") as HTMLButtonElement;
  toggleBtn.type = "button";
  toggleBtn.title = drawerOpen ? "Collapse gateway details" : "Expand gateway details";
  toggleBtn.setAttribute(
    "aria-label",
    drawerOpen ? "Collapse gateway details" : "Expand gateway details",
  );
  toggleBtn.appendChild(icon(drawerOpen ? mdiChevronDown : mdiChevronRight));
  controls.appendChild(toggleBtn);

  strip.appendChild(controls);
  container.appendChild(strip);

  // Drawer
  let drawer: HTMLElement | null = null;
  const renderDrawer = () => {
    if (!drawerOpen) {
      if (drawer) {
        drawer.remove();
        drawer = null;
      }
      return;
    }
    if (drawer) return;

    drawer = el("div", "gw-drawer");

    // Row 1: Endpoint & Quick Copy
    const row1 = el("div", "gw-drawer-row");
    const epLabel = el("span", "", `Endpoint: http://${gateway.endpoint}`);
    const copyEp = el("button", "gw-endpoint-copy") as HTMLButtonElement;
    copyEp.type = "button";
    copyEp.appendChild(icon(mdiContentCopy));
    copyEp.appendChild(document.createTextNode("Copy URL"));
    copyEp.addEventListener("click", () => {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(`http://${gateway.endpoint}`);
        copyEp.replaceChildren(icon(mdiCheck), document.createTextNode("Copied!"));
        setTimeout(() => {
          copyEp.replaceChildren(icon(mdiContentCopy), document.createTextNode("Copy URL"));
        }, 1500);
      }
    });
    row1.appendChild(epLabel);
    row1.appendChild(copyEp);
    drawer.appendChild(row1);

    // Row 2: Recipe Bar
    const recipeBar = el("div", "gw-recipe-bar");
    recipeBar.appendChild(el("span", "gw-recipe-label", "Connect Tool:"));

    const recipeSelect = document.createElement("select");
    recipeSelect.className = "select-input gw-recipe-select";
    const platforms = [
      { id: "claude-code", label: "Claude Code" },
      { id: "opencode", label: "OpenCode" },
      { id: "cline", label: "Cline" },
      { id: "cursor", label: "Cursor" },
      { id: "aider", label: "Aider" },
      { id: "curl", label: "curl" },
    ];
    for (const p of platforms) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.label;
      recipeSelect.appendChild(opt);
    }
    recipeBar.appendChild(recipeSelect);

    const copyRecipeBtn = el("button", "gw-recipe-copy-btn") as HTMLButtonElement;
    copyRecipeBtn.type = "button";
    copyRecipeBtn.appendChild(icon(mdiContentCopy));
    copyRecipeBtn.appendChild(document.createTextNode("Copy Setup Snippet"));
    copyRecipeBtn.addEventListener("click", () => {
      copyRecipeBtn.disabled = true;
      if (typeof window !== "undefined" && window.omp?.gatewayConnect) {
        void window.omp.gatewayConnect(recipeSelect.value).then((res) => {
          copyRecipeBtn.disabled = false;
          if (res.success && res.recipe?.snippet) {
            if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
              void navigator.clipboard.writeText(res.recipe.snippet);
            }
            showToast(`Copied ${res.recipe.title} setup snippet!`);
            copyRecipeBtn.replaceChildren(icon(mdiCheck), document.createTextNode("Copied!"));
            setTimeout(() => {
              copyRecipeBtn.replaceChildren(
                icon(mdiContentCopy),
                document.createTextNode("Copy Setup Snippet"),
              );
            }, 1500);
          } else {
            showToast(res.message || "Failed to generate recipe");
          }
        });
      }
    });
    recipeBar.appendChild(copyRecipeBtn);
    drawer.appendChild(recipeBar);

    container.appendChild(drawer);
  };

  toggleBtn.addEventListener("click", () => {
    drawerOpen = !drawerOpen;
    setGatewayDrawerOpen(drawerOpen);
    toggleBtn.title = drawerOpen ? "Collapse gateway details" : "Expand gateway details";
    toggleBtn.setAttribute(
      "aria-label",
      drawerOpen ? "Collapse gateway details" : "Expand gateway details",
    );
    toggleBtn.replaceChildren(icon(drawerOpen ? mdiChevronDown : mdiChevronRight));
    renderDrawer();
  });

  renderDrawer();

  return container;
}

function renderSummaryChips(
  allRows: readonly DashboardRow[],
  active: FilterScope,
  onSelect: (scope: FilterScope) => void,
): HTMLElement {
  const total = allRows.length;
  const okCount = allRows.filter(
    (r) => (r.health === null || r.health === "ok") && r.level === "ok",
  ).length;
  const hotCount = allRows.filter(
    (r) => r.maxUsed >= 0.8 || r.level === "hot" || r.level === "critical",
  ).length;
  const issuesCount = allRows.filter((r) => r.health !== null && r.health !== "ok").length;

  const container = document.createElement("div");
  container.className = "summary-chips";
  container.setAttribute("role", "toolbar");
  container.setAttribute("aria-label", "Filter accounts by status");

  const chips: Array<{ id: FilterScope; label: string; count: number; dotClass: string }> = [
    { id: "all", label: "All", count: total, dotClass: "dot-all" },
    { id: "ok", label: "Healthy", count: okCount, dotClass: "dot-ok" },
    { id: "hot", label: "≥80%", count: hotCount, dotClass: "dot-warn" },
    { id: "issues", label: "Issues", count: issuesCount, dotClass: "dot-danger" },
  ];

  for (const chip of chips) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = chip.id === active ? "metric-chip active" : "metric-chip";
    btn.setAttribute("aria-pressed", chip.id === active ? "true" : "false");
    btn.title = `Filter accounts: ${chip.label} (${chip.count} accounts)`;

    const dot = document.createElement("span");
    dot.className = `chip-dot ${chip.dotClass}`;
    btn.appendChild(dot);

    const labelSpan = document.createElement("span");
    labelSpan.className = "chip-label";
    labelSpan.textContent = chip.label;
    btn.appendChild(labelSpan);

    const countSpan = document.createElement("span");
    countSpan.className = "chip-count";
    countSpan.textContent = `(${chip.count})`;
    btn.appendChild(countSpan);

    btn.addEventListener("click", () => {
      onSelect(chip.id === active && chip.id !== "all" ? "all" : chip.id);
    });

    container.appendChild(btn);
  }

  return container;
}

export function buildPanel(state: PanelState): HTMLElement {
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
    panel.appendChild(buildGatewayStrip(state));

    if (state.data) {
      const allRows = state.data.providers.flatMap((p) => p.rows);
      panel.appendChild(
        renderSummaryChips(allRows, activeFilter, (nextScope) => {
          activeFilter = nextScope;
          render();
        }),
      );
    } else {
      const summaryP = document.createElement("p");
      summaryP.className = "summary";
      summaryP.textContent = "No usage data";
      panel.appendChild(summaryP);
    }
    if (state.warmup.message) {
      const warmupP = document.createElement("p");
      warmupP.className = "warmup-message";
      warmupP.setAttribute("role", "status");
      warmupP.textContent = state.warmup.message;
      panel.appendChild(warmupP);
    }

    const incidentBanner = buildIncidentBanner(state);
    if (incidentBanner) {
      panel.appendChild(incidentBanner);
    }

    // Content
    const content = document.createElement("div");
    content.className = "content";
    content.setAttribute("aria-busy", state.status === "loading" ? "true" : "false");

    if (state.data && state.data.providers.length === 0) {
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "empty";
      const msgP = document.createElement("p");
      msgP.className = "empty-message";
      msgP.textContent =
        "No providers reported by omp usage yet — sign in to a provider, then Refresh.";
      emptyDiv.appendChild(msgP);
      content.appendChild(emptyDiv);
    } else if (!state.data) {
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
      let renderedCount = 0;
      for (const provider of state.data.providers) {
        const card = renderProviderCard(provider, hasAnyRoute, idx++, state, activeFilter);
        if (card) {
          content.appendChild(card);
          renderedCount++;
        }
      }

      if (renderedCount === 0 && activeFilter !== "all") {
        const emptyFilter = document.createElement("div");
        emptyFilter.className = "empty-filter-view";

        const title = document.createElement("p");
        title.className = "empty-filter-title";
        title.textContent = `No accounts matching filter "${activeFilter}".`;
        emptyFilter.appendChild(title);

        const resetBtn = document.createElement("button");
        resetBtn.type = "button";
        resetBtn.className = "button button-secondary";
        resetBtn.textContent = "Show All Accounts";
        resetBtn.addEventListener("click", () => {
          activeFilter = "all";
          render();
        });
        emptyFilter.appendChild(resetBtn);
        content.appendChild(emptyFilter);
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

    const footerText = document.createElement("span");
    footerText.textContent = `Source: omp usage${healthPart} · refresh ${state.intervalSeconds}s`;
    footer.appendChild(footerText);

    const footerSettings = document.createElement("button");
    footerSettings.type = "button";
    footerSettings.className = "footer-settings";
    footerSettings.textContent = "Settings";
    footerSettings.title = "Settings (Ctrl+,)";
    footerSettings.setAttribute("aria-label", "Open settings");
    footerSettings.addEventListener("click", () => {
      activeTab = "settings";
      render();
    });
    footer.appendChild(footerSettings);
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

function measureContentHeight(): number {
  const panel = document.querySelector(".panel") as HTMLElement | null;
  if (!panel) return 220;

  const header = panel.querySelector(".header") as HTMLElement | null;
  const gatewayStrip = panel.querySelector(".gateway-strip") as HTMLElement | null;
  const summary = panel.querySelector(".summary") as HTMLElement | null;
  const warmup = panel.querySelector(".warmup-message") as HTMLElement | null;
  const banner = panel.querySelector(".incident-banner") as HTMLElement | null;
  const scrollArea = panel.querySelector(".content, .settings-view") as HTMLElement | null;
  const footer = panel.querySelector(".footer") as HTMLElement | null;

  const headerH = header ? header.offsetHeight : 0;
  const gatewayH = gatewayStrip ? gatewayStrip.offsetHeight : 0;
  const summaryH = summary ? summary.offsetHeight : 0;
  const warmupH = warmup ? warmup.offsetHeight : 0;
  const bannerH = banner ? banner.offsetHeight : 0;
  const scrollH = scrollArea ? scrollArea.scrollHeight : 0;
  const footerH = footer ? footer.offsetHeight : 0;

  const panelStyle = window.getComputedStyle(panel);
  const paddingTop = Number.parseFloat(panelStyle.paddingTop) || 20;
  const paddingBottom = Number.parseFloat(panelStyle.paddingBottom) || 20;
  const rowGap = Number.parseFloat(panelStyle.rowGap) || 16;

  const activeChildren = [header, gatewayStrip, summary, warmup, banner, scrollArea, footer].filter(
    Boolean,
  );
  const gapTotal = Math.max(0, activeChildren.length - 1) * rowGap;

  return Math.ceil(
    headerH +
      gatewayH +
      summaryH +
      warmupH +
      bannerH +
      scrollH +
      footerH +
      paddingTop +
      paddingBottom +
      gapTotal +
      2,
  );
}

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

  if (typeof window !== "undefined" && window.omp?.resize) {
    const neededHeight = measureContentHeight();
    window.omp.resize(neededHeight);
  }
}

render();

if (typeof window !== "undefined" && window.omp?.onState) {
  window.omp.onState((state) => {
    currentState = state;
    themeManager.apply(state.settings.theme);
    render();
  });
}

if (typeof window !== "undefined" && window.omp?.onOpenSettings) {
  window.omp.onOpenSettings(() => {
    activeTab = "settings";
    render();
  });
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("keydown", (event) => {
    if (isSettingsShortcut(event)) {
      event.preventDefault();
      activeTab = activeTab === "settings" ? "dashboard" : "settings";
      render();
    }
  });
}
