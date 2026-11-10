import { mdiClose, mdiRefresh } from "@mdi/js";
import { type DashboardRow, formatAge } from "@omp-toolkit/core";
import tokens from "../../../../design/tokens.json";
import type { PanelState } from "../ipc";
import { DEFAULT_DESKTOP_SETTINGS } from "../settings";
import { type FilterScope, matchesFilter, renderProviderCard } from "./card";
import { createGatewayView, type GatewayViewController } from "./gateway-view";
import { icon } from "./icon";
import { buildProviderAccessSection, providerAccessSummary } from "./provider-access";
import { renderSettingsView, type SettingsViewController } from "./settings-view";
import { themeManager } from "./tokens";

export interface PanelRenderer {
  update(state: PanelState): void;
  openSettings(): void;
  destroy(): void;
}

type ViewId = "usage" | "gateway" | "settings";

const VIEWS: readonly ViewId[] = ["usage", "gateway", "settings"];

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildIncidentBanner(state: PanelState, now = Date.now()): HTMLElement | null {
  const incident = state.data?.health?.incident;
  if (!incident || now - incident.at >= 86_400_000) return null;
  const banner = el(
    "div",
    "incident-banner",
    `Incident ${incident.kind} · ${formatAge(incident.at, now)} · ${incident.detail}`,
  );
  banner.setAttribute("role", "alert");
  return banner;
}

function renderSummaryChips(
  allRows: readonly DashboardRow[],
  active: FilterScope,
  aboveThreshold: number,
  onSelect: (scope: FilterScope) => void,
): HTMLElement {
  let highUsage = 0;
  let attention = 0;
  for (const row of allRows) {
    if (matchesFilter(row, "high-usage", aboveThreshold)) highUsage += 1;
    if (matchesFilter(row, "attention", aboveThreshold)) attention += 1;
  }

  const container = el("div", "summary-chips");
  container.setAttribute("role", "toolbar");
  container.setAttribute("aria-label", "Filter accounts by status");

  const chips: Array<{ id: FilterScope; label: string; count: number; dotClass: string }> = [
    { id: "all", label: "All", count: allRows.length, dotClass: "dot-all" },
    { id: "high-usage", label: "High usage", count: highUsage, dotClass: "dot-warn" },
    { id: "attention", label: "Needs attention", count: attention, dotClass: "dot-danger" },
  ];

  for (const chip of chips) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = chip.id === active ? "metric-chip active" : "metric-chip";
    button.setAttribute("aria-pressed", chip.id === active ? "true" : "false");
    button.title =
      chip.id === "high-usage"
        ? `Filter accounts at or above ${Math.round(aboveThreshold * 100)}% usage (${chip.count})`
        : `Filter accounts: ${chip.label} (${chip.count})`;

    const dot = el("span", `chip-dot ${chip.dotClass}`);
    dot.setAttribute("aria-hidden", "true");
    button.appendChild(dot);
    button.appendChild(el("span", "chip-label", chip.label));
    button.appendChild(el("span", "chip-count", `(${chip.count})`));

    button.addEventListener("click", () => {
      onSelect(chip.id === active && chip.id !== "all" ? "all" : chip.id);
    });

    container.appendChild(button);
  }

  return container;
}

function focusDescriptor(): { provider: string; action: string; account?: string } | null {
  const active = document.activeElement as HTMLElement | null;
  if (!active || !("dataset" in active)) return null;
  const { provider, action, account } = active.dataset;
  if (!provider || !action) return null;
  return { provider, action, account };
}

function findFocusTarget(
  root: HTMLElement,
  descriptor: { provider: string; action: string; account?: string },
): HTMLElement | null {
  for (const element of Array.from(root.querySelectorAll<HTMLElement>("[data-provider]"))) {
    if (
      element.dataset.provider === descriptor.provider &&
      element.dataset.action === descriptor.action &&
      (descriptor.account === undefined || element.dataset.account === descriptor.account)
    ) {
      return element;
    }
  }
  return null;
}

export function mountPanel(root: HTMLElement, initialState: PanelState): PanelRenderer {
  let currentState = initialState;
  let activeView: ViewId = "usage";
  let activeFilter: FilterScope = "all";
  let providerAccessExpanded = false;
  let providerAccessSection: HTMLElement | null = null;
  let lastBuildKey: string | null = null;
  let toastElement: HTMLElement | null = null;
  let toastTimer: number | null = null;
  let resizeFrame: number | null = null;
  let lastRequestedHeight = 0;
  let destroyed = false;
  const scrollPositions: Record<ViewId, number> = { usage: 0, gateway: 0, settings: 0 };

  themeManager.init();

  const panel = el("div", "panel");

  const compactBreakpoint = tokens.desktop.breakpoint.compact.$value;

  function syncDensity(): boolean {
    const width = panel.clientWidth || 0;
    const density = width > 0 && width < compactBreakpoint ? "compact" : "regular";
    if (panel.dataset.density === density) return false;
    panel.dataset.density = density;
    return true;
  }

  const header = el("header", "header");
  const headerTop = el("div", "header-top");
  const headerLeft = el("div", "header-left");
  const title = el("h1", "title", "Provider usage");
  const subtitle = el("p", "subtitle");
  subtitle.setAttribute("aria-live", "polite");
  headerLeft.appendChild(title);
  headerLeft.appendChild(subtitle);
  headerTop.appendChild(headerLeft);

  const actions = el("div", "actions");
  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.className = "icon-button";
  refreshBtn.setAttribute("aria-label", "Refresh");
  refreshBtn.title = "Refresh now";
  refreshBtn.appendChild(icon(mdiRefresh));
  refreshBtn.addEventListener("click", () => {
    window.omp.refresh();
  });
  actions.appendChild(refreshBtn);

  const hideBtn = document.createElement("button");
  hideBtn.type = "button";
  hideBtn.className = "icon-button";
  hideBtn.setAttribute("aria-label", "Hide panel");
  hideBtn.title = "Hide panel";
  hideBtn.appendChild(icon(mdiClose));
  hideBtn.addEventListener("click", () => {
    window.omp.hide();
  });
  actions.appendChild(hideBtn);
  headerTop.appendChild(actions);
  header.appendChild(headerTop);

  const tabs = el("div", "panel-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Panel views");
  const tabButtons = new Map<ViewId, HTMLButtonElement>();
  for (const view of VIEWS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "panel-tab";
    button.id = `panel-tab-${view}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", `panel-view-${view}`);
    button.textContent = view === "usage" ? "Usage" : view === "gateway" ? "Gateway" : "Settings";
    button.addEventListener("click", () => {
      setView(view);
    });
    button.addEventListener("keydown", (event) => {
      const index = VIEWS.indexOf(view);
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setView(VIEWS[(index + 1) % VIEWS.length], true);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setView(VIEWS[(index - 1 + VIEWS.length) % VIEWS.length], true);
      } else if (event.key === "Home") {
        event.preventDefault();
        setView(VIEWS[0], true);
      } else if (event.key === "End") {
        event.preventDefault();
        setView(VIEWS[VIEWS.length - 1], true);
      }
    });
    tabButtons.set(view, button);
    tabs.appendChild(button);
  }
  header.appendChild(tabs);
  panel.appendChild(header);

  const body = el("div", "panel-body");
  const usagePanel = el("section", "panel-view");
  usagePanel.id = "panel-view-usage";
  usagePanel.setAttribute("role", "tabpanel");
  usagePanel.setAttribute("aria-labelledby", "panel-tab-usage");
  const usageContent = el("div", "view-content usage-content");
  usagePanel.appendChild(usageContent);

  const gatewayPanel = el("section", "panel-view");
  gatewayPanel.id = "panel-view-gateway";
  gatewayPanel.setAttribute("role", "tabpanel");
  gatewayPanel.setAttribute("aria-labelledby", "panel-tab-gateway");
  const gatewayContent = el("div", "view-content gateway-content");
  const gatewayController: GatewayViewController = createGatewayView(initialState, showToast);
  gatewayContent.appendChild(gatewayController.element);
  gatewayPanel.appendChild(gatewayContent);

  const settingsPanel = el("section", "panel-view");
  settingsPanel.id = "panel-view-settings";
  settingsPanel.setAttribute("role", "tabpanel");
  settingsPanel.setAttribute("aria-labelledby", "panel-tab-settings");
  const settingsContent = el("div", "view-content settings-content");
  const providerAccessHost = el("div", "provider-access-host");
  settingsPanel.appendChild(settingsContent);
  body.appendChild(usagePanel);
  body.appendChild(gatewayPanel);
  body.appendChild(settingsPanel);
  panel.appendChild(body);

  const footer = el("footer", "footer");
  const footerStatus = el("span", "footer-status");
  const footerActions = el("div", "footer-actions");
  footer.appendChild(footerStatus);
  footer.appendChild(footerActions);
  panel.appendChild(footer);

  const settingsController: SettingsViewController = renderSettingsView(
    initialState.settings,
    async (settings) => {
      if (typeof window === "undefined" || !window.omp?.saveSettings) {
        return { valid: false, errors: ["Settings are not available."] };
      }
      const result = await window.omp.saveSettings(settings);
      if (result.valid) showToast("Settings saved");
      return result;
    },
    () => {
      if (activeView === "settings") setView("usage");
    },
  );
  settingsContent.appendChild(settingsController.element);
  settingsContent.appendChild(providerAccessHost);

  const viewContents: Record<ViewId, HTMLElement> = {
    usage: usageContent,
    gateway: gatewayContent,
    settings: settingsContent,
  };
  const viewPanels: Record<ViewId, HTMLElement> = {
    usage: usagePanel,
    gateway: gatewayPanel,
    settings: settingsPanel,
  };

  function showToast(message: string): void {
    if (!toastElement) {
      toastElement = el("div", "toast");
      toastElement.setAttribute("role", "status");
      toastElement.setAttribute("aria-live", "polite");
      panel.appendChild(toastElement);
    }
    toastElement.textContent = message;
    clearTimeout(toastTimer ?? undefined);
    toastTimer = setTimeout(() => {
      toastElement?.remove();
      toastElement = null;
      toastTimer = null;
      requestMeasure();
    }, tokens.desktop.motion.duration.toast.$value) as unknown as number;
    requestMeasure();
  }

  function updateHeader(): void {
    refreshBtn.disabled = currentState.status === "loading" || currentState.warmup.running;
    if (currentState.status === "error") {
      subtitle.className = "subtitle status-error";
      subtitle.textContent = "Refresh failed";
      subtitle.title = currentState.message ?? "Unknown error";
      return;
    }
    subtitle.className = "subtitle";
    subtitle.removeAttribute("title");
    if (currentState.status === "loading") {
      subtitle.textContent = currentState.data ? "Refreshing…" : "Loading…";
      return;
    }
    subtitle.textContent = `${currentState.data.summary.accounts} accounts · updated ${formatAge(currentState.data.fetchedAt, Date.now(), true)}`;
    subtitle.title = `Last updated ${new Date(currentState.data.fetchedAt).toLocaleString()}`;
  }

  function renderEmptyState(container: HTMLElement): void {
    if (!currentState.data) {
      const empty = el("div", currentState.status === "error" ? "empty status-error" : "empty");
      empty.appendChild(
        el(
          "p",
          "empty-message",
          currentState.status === "error"
            ? `Refresh failed: ${currentState.message ?? "Unknown error"}`
            : "Loading usage data...",
        ),
      );
      if (currentState.status === "error") {
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "button button-secondary";
        retry.textContent = "Retry";
        retry.addEventListener("click", () => {
          window.omp.refresh();
        });
        empty.appendChild(retry);
      }
      container.appendChild(empty);
      return;
    }

    if (currentState.data.providers.length === 0) {
      const empty = el("div", "empty");
      empty.appendChild(
        el(
          "p",
          "empty-message",
          "No providers reported by omp usage yet — sign in to a provider, then Refresh.",
        ),
      );
      container.appendChild(empty);
    }
  }

  function renderUsage(): void {
    const focus = focusDescriptor();
    usageContent.replaceChildren();

    const warmupMessage = currentState.warmup.message;
    if (warmupMessage) {
      const status = el("p", "warmup-message", warmupMessage);
      status.setAttribute("role", "status");
      usageContent.appendChild(status);
    }

    const incident = buildIncidentBanner(currentState);
    if (incident) usageContent.appendChild(incident);

    if (!currentState.data) {
      renderEmptyState(usageContent);
    } else {
      const allRows = currentState.data.providers.flatMap((provider) => provider.rows);
      const aboveThreshold = currentState.data.summary.aboveThreshold;
      usageContent.appendChild(
        renderSummaryChips(allRows, activeFilter, aboveThreshold, (scope) => {
          activeFilter = scope;
          renderUsage();
          requestMeasure();
        }),
      );

      let renderedCount = 0;
      let index = 0;
      for (const provider of currentState.data.providers) {
        const card = renderProviderCard(
          provider,
          aboveThreshold,
          index++,
          currentState,
          activeFilter,
        );
        if (card) {
          usageContent.appendChild(card);
          renderedCount += 1;
        }
      }

      if (currentState.data.providers.length === 0) {
        renderEmptyState(usageContent);
      } else if (renderedCount === 0 && activeFilter !== "all") {
        const empty = el("div", "empty-filter-view");
        empty.appendChild(el("p", "empty-filter-title", `No accounts match this filter.`));
        const reset = document.createElement("button");
        reset.type = "button";
        reset.className = "button button-secondary";
        reset.textContent = "Show all accounts";
        reset.addEventListener("click", () => {
          activeFilter = "all";
          renderUsage();
          requestMeasure();
        });
        empty.appendChild(reset);
        usageContent.appendChild(empty);
      }
    }

    if (focus) {
      const target = findFocusTarget(usageContent, focus);
      target?.focus();
    }
  }

  function renderProviderAccess(): void {
    const buildKey = JSON.stringify(currentState.ompBuild ?? null);
    if (providerAccessSection && buildKey === lastBuildKey) return;
    lastBuildKey = buildKey;
    providerAccessSection = buildProviderAccessSection(
      currentState,
      providerAccessExpanded,
      (expanded) => {
        providerAccessExpanded = expanded;
        requestMeasure();
      },
    );
    providerAccessHost.replaceChildren(providerAccessSection);
  }

  function renderFooter(): void {
    footerActions.replaceChildren();
    if (activeView === "settings") {
      footerActions.appendChild(settingsController.actions);
    } else if (activeView === "usage") {
      const accessButton = document.createElement("button");
      accessButton.type = "button";
      accessButton.className = "footer-link";
      accessButton.textContent = "Provider access";
      accessButton.title = providerAccessSummary(currentState.ompBuild);
      accessButton.addEventListener("click", () => {
        openSettings(true);
      });
      footerActions.appendChild(accessButton);
    }

    if (activeView === "usage" && currentState.data) {
      footerStatus.textContent = `Source: omp usage · refresh ${currentState.intervalSeconds}s`;
    } else if (activeView === "gateway") {
      footerStatus.textContent = "Gateway controls affect connected clients.";
    } else if (activeView === "settings") {
      footerStatus.textContent = "Esc hides the panel. Cancel discards unsaved changes.";
    } else {
      footerStatus.textContent = "Source: omp usage";
    }
  }

  function setView(view: ViewId, focusTab = false): void {
    const viewChanged = activeView !== view;
    const previousPanel = viewPanels[activeView];
    const activeElement = document.activeElement as HTMLElement | null;
    const focusWasInsidePanel =
      viewChanged &&
      activeElement !== null &&
      typeof previousPanel.contains === "function" &&
      previousPanel.contains(activeElement);
    if (viewChanged) {
      scrollPositions[activeView] = body.scrollTop;
    }
    activeView = view;
    for (const candidate of VIEWS) {
      const selected = candidate === view;
      const tab = tabButtons.get(candidate);
      if (tab) {
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
        tab.classList.toggle("active", selected);
      }
      viewPanels[candidate].hidden = !selected;
      viewContents[candidate].classList.toggle("motion-enter", viewChanged && selected);
    }
    body.scrollTop = scrollPositions[view];
    renderFooter();
    if (view === "usage") renderUsage();
    requestMeasure();
    if (focusTab || focusWasInsidePanel) tabButtons.get(view)?.focus();
  }

  function openSettings(expandAccess = false): void {
    setView("settings");
    if (!expandAccess) return;
    providerAccessExpanded = true;
    const details = providerAccessSection?.querySelector("details") as HTMLDetailsElement | null;
    if (details) details.open = true;
    const heading = providerAccessSection?.querySelector(
      "#provider-access-heading",
    ) as HTMLElement | null;
    heading?.focus();
    heading?.scrollIntoView?.({ block: "start" });
    requestMeasure();
  }

  function measure(): void {
    if (destroyed) return;
    syncDensity();
    const content = viewContents[activeView];
    const headerHeight = header.offsetHeight || 0;
    const footerHeight = footer.offsetHeight || 0;
    const contentHeight = Math.max(content.scrollHeight || 0, content.offsetHeight || 0);
    let paddingTop = 0;
    let paddingBottom = 0;
    let gap = 0;
    if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
      const style = window.getComputedStyle(panel);
      paddingTop = Number.parseFloat(style.paddingTop) || 0;
      paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
      gap = Number.parseFloat(style.rowGap) || 0;
    }
    const needed = Math.ceil(
      headerHeight + contentHeight + footerHeight + paddingTop + paddingBottom + gap * 2 + 2,
    );
    if (needed !== lastRequestedHeight && typeof window !== "undefined" && window.omp?.resize) {
      lastRequestedHeight = needed;
      window.omp.resize(needed);
    }
  }

  function requestMeasure(): void {
    if (destroyed) return;
    if (typeof requestAnimationFrame === "function") {
      if (resizeFrame !== null) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        measure();
      });
      return;
    }
    measure();
  }

  const resizeObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          requestMeasure();
        })
      : null;
  if (resizeObserver) {
    for (const target of [header, footer, usageContent, gatewayContent, settingsContent]) {
      resizeObserver.observe(target);
    }
  }

  const densityObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          if (syncDensity()) requestMeasure();
        })
      : null;
  densityObserver?.observe(panel);

  function update(state: PanelState): void {
    if (destroyed) return;
    currentState = state;
    updateHeader();
    settingsController.syncSettings(state.settings);
    if (activeView !== "settings") themeManager.apply(state.settings.theme);
    renderProviderAccess();
    gatewayController.update(state);
    if (activeView === "usage") renderUsage();
    renderFooter();
    requestMeasure();
  }

  const keyHandler = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key === ",") {
      event.preventDefault();
      openSettings();
    }
  };
  window.addEventListener("keydown", keyHandler);

  root.replaceChildren(panel);
  updateHeader();
  renderProviderAccess();
  setView("usage");
  if (typeof document !== "undefined" && document.fonts?.ready) {
    void document.fonts.ready.then(() => requestMeasure());
  }

  return {
    update,
    openSettings: () => openSettings(),
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      window.removeEventListener("keydown", keyHandler);
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      clearTimeout(toastTimer ?? undefined);
      resizeObserver?.disconnect();
      densityObserver?.disconnect();
      settingsController.destroy();
      gatewayController.destroy();
    },
  };
}

function bootstrap(): void {
  if (typeof document === "undefined") return;
  const app = document.querySelector<HTMLElement>("#app");
  if (!app) return;
  const initial: PanelState = {
    status: "loading",
    data: null,
    intervalSeconds: 300,
    warmup: { running: false, message: null },
    settings: DEFAULT_DESKTOP_SETTINGS,
  };
  const renderer = mountPanel(app, initial);
  if (typeof window !== "undefined" && window.omp) {
    window.omp.onState((state) => renderer.update(state));
    window.omp.onOpenSettings?.(() => renderer.openSettings());
  }
}

bootstrap();
