import { mdiClose, mdiRefresh, mdiWindowMinimize } from "@mdi/js";
import { formatAge, summaryText } from "@omp-toolkit/core";
import type { PanelState } from "../ipc";
import { icon, renderProviderCard } from "./card";
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
  refreshBtn.appendChild(icon(mdiRefresh));
  if (state.status === "loading" || state.warmup.running) {
    refreshBtn.disabled = true;
  }
  refreshBtn.addEventListener("click", () => {
    window.omp.refresh();
  });
  actions.appendChild(refreshBtn);

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

  return panel;
}

let currentState: PanelState = {
  status: "loading",
  data: null,
  intervalSeconds: 300,
  warmup: { running: false, message: null },
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
