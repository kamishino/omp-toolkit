import {
  type DashboardLimit,
  type DashboardProvider,
  formatAge,
  formatPercent,
  formatResetCompact,
  money,
  summaryText,
} from "@omp-toolkit/core";
import type { PanelState } from "../ipc";
import { applyTheme } from "./tokens";

const media = window.matchMedia("(prefers-color-scheme: dark)");
applyTheme(media.matches ? "dark" : "light");
media.addEventListener("change", (e) => {
  applyTheme(e.matches ? "dark" : "light");
});

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderLimitCell(limit: DashboardLimit): HTMLElement {
  const td = document.createElement("td");
  td.className = "col-limit";

  const container = document.createElement("div");
  container.className = "limit-cell";

  if (limit.unit === "cny" || limit.unit === "usd") {
    const moneySpan = document.createElement("span");
    moneySpan.className = `money level-${limit.level}`;
    moneySpan.textContent = money(limit.remaining, limit.unit);
    container.appendChild(moneySpan);

    if (limit.low) {
      const lowSpan = document.createElement("span");
      lowSpan.className = "low";
      lowSpan.textContent = "LOW";
      container.appendChild(lowSpan);
    }
  } else if (limit.usedFraction !== undefined) {
    const progress = document.createElement("progress");
    progress.max = 100;
    progress.value = Math.round(limit.usedFraction * 100);
    progress.className = `level-${limit.level}`;
    progress.setAttribute("aria-label", `${limit.label} ${formatPercent(limit.usedFraction)}`);
    container.appendChild(progress);

    const pctSpan = document.createElement("span");
    pctSpan.className = `percent level-${limit.level}`;
    pctSpan.textContent = formatPercent(limit.usedFraction);
    container.appendChild(pctSpan);

    const resetSpan = document.createElement("span");
    resetSpan.className = "reset";
    resetSpan.textContent = formatResetCompact(limit.resetsAt, Date.now());
    container.appendChild(resetSpan);
  } else {
    const emptySpan = document.createElement("span");
    emptySpan.className = "level-unknown";
    emptySpan.textContent = "—";
    container.appendChild(emptySpan);
  }

  td.appendChild(container);
  return td;
}

function renderProviderCard(
  provider: DashboardProvider,
  hasAnyRoute: boolean,
  providerIndex: number,
): HTMLElement {
  const card = document.createElement("section");
  card.className = "provider-card";

  const titleId = `provider-title-${providerIndex}`;
  const h2 = document.createElement("h2");
  h2.id = titleId;
  h2.className = "provider-title";
  h2.textContent = `${provider.name}${provider.suffix} · ${provider.accounts} ${provider.accounts === 1 ? "account" : "accounts"}`;
  card.appendChild(h2);

  const table = document.createElement("table");
  table.className = "table";
  table.setAttribute("aria-labelledby", titleId);

  const thead = document.createElement("thead");
  const trHead = document.createElement("tr");

  const thAccount = document.createElement("th");
  thAccount.scope = "col";
  thAccount.className = "col-account";
  thAccount.textContent = "ACCOUNT";
  trHead.appendChild(thAccount);

  if (hasAnyRoute) {
    const thRoute = document.createElement("th");
    thRoute.scope = "col";
    thRoute.className = "col-route";
    thRoute.textContent = "ROUTE";
    trHead.appendChild(thRoute);
  }

  for (const col of provider.columns) {
    const thCol = document.createElement("th");
    thCol.scope = "col";
    thCol.className = "col-limit";
    thCol.textContent = col.label.toUpperCase();
    trHead.appendChild(thCol);
  }

  thead.appendChild(trHead);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of provider.rows) {
    const tr = document.createElement("tr");

    const thAcc = document.createElement("th");
    thAcc.scope = "row";
    thAcc.className = `account col-account level-${row.level}`;
    thAcc.textContent = row.displayAccount;
    tr.appendChild(thAcc);

    if (hasAnyRoute) {
      const tdRoute = document.createElement("td");
      tdRoute.className = "col-route";
      const routeSpan = document.createElement("span");
      routeSpan.className = `route level-${row.route.level}`;
      routeSpan.textContent = row.route.text;
      tdRoute.appendChild(routeSpan);
      tr.appendChild(tdRoute);
    }

    for (const limit of row.limits) {
      tr.appendChild(renderLimitCell(limit));
    }

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  card.appendChild(table);
  return card;
}

function buildPanel(state: PanelState): HTMLElement {
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
  refreshBtn.textContent = "↻";
  if (state.status === "loading") {
    refreshBtn.disabled = true;
  }
  refreshBtn.addEventListener("click", () => {
    window.omp.refresh();
  });
  actions.appendChild(refreshBtn);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "icon-button";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => {
    window.omp.hide();
  });
  actions.appendChild(closeBtn);

  header.appendChild(actions);
  panel.appendChild(header);

  // Summary
  const summaryP = document.createElement("p");
  summaryP.className = "summary";
  if (state.data) {
    summaryP.textContent = summaryText(state.data.summary);
  } else {
    summaryP.textContent = "No usage data";
  }
  panel.appendChild(summaryP);

  // Content
  const content = document.createElement("div");
  content.className = "content";
  content.setAttribute("aria-busy", state.status === "loading" ? "true" : "false");

  if (!state.data) {
    const emptyP = document.createElement("p");
    emptyP.className = state.status === "error" ? "empty status-error" : "empty";
    emptyP.textContent =
      state.status === "error"
        ? `Refresh failed: ${state.message ?? "Unknown error"}`
        : "Loading...";
    content.appendChild(emptyP);
  } else {
    const hasAnyRoute = state.data.providers.some((p) => p.rows.some((r) => r.health !== null));

    let idx = 0;
    for (const provider of state.data.providers) {
      content.appendChild(renderProviderCard(provider, hasAnyRoute, idx++));
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

  return panel;
}

let currentState: PanelState = {
  status: "loading",
  data: null,
  intervalSeconds: 300,
};

function render(): void {
  const app = document.querySelector("#app");
  if (!app) return;

  const prevContent = app.querySelector(".content");
  const scrollTop = prevContent ? prevContent.scrollTop : 0;

  app.replaceChildren(buildPanel(currentState));

  const newContent = app.querySelector(".content");
  if (newContent) {
    newContent.scrollTop = scrollTop;
  }
}

render();

window.omp.onState((state) => {
  currentState = state;
  render();
});
