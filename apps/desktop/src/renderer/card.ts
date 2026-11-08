import {
  mdiCheck,
  mdiChevronDown,
  mdiChevronRight,
  mdiContentCopy,
  mdiFlash,
  mdiStethoscope,
} from "@mdi/js";
import {
  type DashboardProvider,
  formatPercent,
  supportsWarmUp,
  warmUpEligibility,
} from "@omp-toolkit/core";
import type { PanelState } from "../ipc";
import { icon } from "./icon";
import { renderLimitCell } from "./limit-cell";
import { providerLogo } from "./provider-logos";

export type FilterScope = "all" | "ok" | "hot" | "issues";

const COLLAPSED_STORAGE_KEY = "omp.collapsedProviders";

export function isProviderCollapsed(providerId: string): boolean {
  try {
    const raw =
      typeof localStorage !== "undefined" ? localStorage.getItem(COLLAPSED_STORAGE_KEY) : null;
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list.includes(providerId);
    }
  } catch {
    // headless or corrupted storage fallback
  }
  return false;
}

export function setProviderCollapsed(providerId: string, collapsed: boolean): void {
  try {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    const set = new Set<string>(raw ? JSON.parse(raw) : []);
    if (collapsed) {
      set.add(providerId);
    } else {
      set.delete(providerId);
    }
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // headless fallback
  }
}
const ROUTE_TITLES: Record<string, string> = {
  OK: "Route healthy",
  HANG: "Route stalled — no response from this route; use Check to probe it",
  AUTH: "Route blocked — sign-in or credentials need attention",
  MODEL: "Route blocked — model unavailable for this account",
  ERR: "Route error — the last probe failed; use Check to probe it",
  STALE: "Route observation is stale (>15m); use Check to probe it",
  "—": "No route health data yet",
};

export function renderProviderCard(
  provider: DashboardProvider,
  hasAnyRoute: boolean,
  providerIndex: number,
  state: PanelState,
  filterScope: FilterScope = "all",
): HTMLElement | null {
  const matchingRows = provider.rows.filter((row) => {
    if (filterScope === "all") return true;
    if (filterScope === "ok") {
      return (row.health === null || row.health === "ok") && row.level === "ok";
    }
    if (filterScope === "hot") {
      return row.maxUsed >= 0.8 || row.level === "hot" || row.level === "critical";
    }
    if (filterScope === "issues") {
      return row.health !== null && row.health !== "ok";
    }
    return true;
  });

  if (filterScope !== "all" && matchingRows.length === 0) {
    return null;
  }

  let isCollapsed = isProviderCollapsed(provider.id);
  const hasWarmUp = supportsWarmUp(provider.id);
  const card = document.createElement("section");
  card.className = isCollapsed ? "provider-card card-collapsed" : "provider-card";
  const headerDiv = document.createElement("div");
  headerDiv.className = "provider-header";

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "card-toggle-btn";
  toggleBtn.setAttribute(
    "aria-label",
    isCollapsed ? `Expand ${provider.name}` : `Collapse ${provider.name}`,
  );
  toggleBtn.title = isCollapsed ? "Expand card" : "Collapse card";
  toggleBtn.appendChild(icon(isCollapsed ? mdiChevronRight : mdiChevronDown));
  headerDiv.appendChild(toggleBtn);

  const logoSlot = document.createElement("span");
  logoSlot.className = "provider-logo";

  const logo = providerLogo(provider.id);
  if (logo) {
    const lightImg = document.createElement("img");
    lightImg.src = `./assets/providers/${logo.light}`;
    lightImg.alt = "";
    lightImg.setAttribute("aria-hidden", "true");
    if (logo.dark) {
      lightImg.className = "logo-light";
      const darkImg = document.createElement("img");
      darkImg.src = `./assets/providers/${logo.dark}`;
      darkImg.alt = "";
      darkImg.setAttribute("aria-hidden", "true");
      darkImg.className = "logo-dark";
      darkImg.onerror = () => darkImg.remove();
      logoSlot.appendChild(darkImg);
    }
    lightImg.onerror = () => lightImg.remove();
    logoSlot.appendChild(lightImg);
  } else {
    const fallback = document.createElement("span");
    fallback.className = "provider-logo-fallback";
    fallback.setAttribute("aria-hidden", "true");
    fallback.textContent = (provider.name.trim().charAt(0) || "?").toUpperCase();
    logoSlot.appendChild(fallback);
  }
  headerDiv.appendChild(logoSlot);

  const titleId = `provider-title-${providerIndex}`;
  const h2 = document.createElement("h2");
  h2.id = titleId;
  h2.className = "provider-title";
  h2.textContent = `${provider.name}${provider.suffix} · ${matchingRows.length} ${matchingRows.length === 1 ? "account" : "accounts"}`;
  h2.style.cursor = "pointer";
  headerDiv.appendChild(h2);

  // Collapsed summary preview
  const previewDiv = document.createElement("div");
  previewDiv.className = "collapsed-preview";

  const countBadge = document.createElement("span");
  countBadge.className = "collapsed-badge";
  countBadge.textContent = `${matchingRows.length} ${matchingRows.length === 1 ? "acct" : "accts"}`;
  previewDiv.appendChild(countBadge);

  const hasRouteData = matchingRows.some((r) => r.route.text !== "—");
  if (hasAnyRoute && hasWarmUp && hasRouteData) {
    const worstRoute =
      matchingRows.find((r) => r.route.text === "HANG" || r.route.text === "ERR") ??
      matchingRows.find((r) => r.route.text === "AUTH" || r.route.text === "MODEL") ??
      matchingRows.find((r) => r.route.text === "STALE") ??
      matchingRows.find((r) => r.route.text === "OK") ??
      matchingRows[0];
    if (worstRoute && worstRoute.route.text !== "—") {
      const badgeKind =
        worstRoute.route.level === "ok"
          ? "ok"
          : worstRoute.route.level === "critical"
            ? "danger"
            : "neutral";
      const routeBadge = document.createElement("span");
      routeBadge.className = `collapsed-badge badge-${badgeKind}`;
      routeBadge.textContent = worstRoute.route.text;
      previewDiv.appendChild(routeBadge);
    }
  }

  const maxUsed = Math.max(0, ...matchingRows.map((r) => r.maxUsed));
  if (maxUsed > 0) {
    const maxBadge = document.createElement("span");
    const level =
      maxUsed >= 0.85 ? "danger" : maxUsed >= 0.7 ? "hot" : maxUsed >= 0.4 ? "warn" : "ok";
    maxBadge.className = `collapsed-badge badge-${level}`;
    maxBadge.textContent = `${formatPercent(maxUsed)} max`;
    previewDiv.appendChild(maxBadge);
  }
  headerDiv.appendChild(previewDiv);

  const toggleCollapse = () => {
    isCollapsed = !isCollapsed;
    setProviderCollapsed(provider.id, isCollapsed);
    card.className = isCollapsed ? "provider-card card-collapsed" : "provider-card";
    toggleBtn.setAttribute(
      "aria-label",
      isCollapsed ? `Expand ${provider.name}` : `Collapse ${provider.name}`,
    );
    toggleBtn.title = isCollapsed ? "Expand card" : "Collapse card";
    toggleBtn.replaceChildren(icon(isCollapsed ? mdiChevronRight : mdiChevronDown));
  };

  toggleBtn.addEventListener("click", toggleCollapse);
  h2.addEventListener("click", toggleCollapse);

  if (provider.timeWindow) {
    const badge = document.createElement("span");
    const isPeak = provider.timeWindow.isPeak;
    badge.className = `time-window-badge ${isPeak ? "badge-peak" : "badge-off-peak"}`;
    badge.textContent = `${provider.timeWindow.label} · ${provider.timeWindow.formattedTimeUntilNext}`;
    badge.title = `${provider.timeWindow.badgeText} (reference clock: ${provider.timeWindow.referenceTimeZone})`;
    badge.setAttribute("aria-label", provider.timeWindow.badgeText);
    headerDiv.appendChild(badge);
  }

  if (hasWarmUp) {
    const eligibleCount = matchingRows.filter(
      (r) => warmUpEligibility(provider.id, r.health) === "warm",
    ).length;
    const skippedCount = matchingRows.length - eligibleCount;
    const warmupAllBtn = document.createElement("button");
    warmupAllBtn.type = "button";
    warmupAllBtn.className = "provider-action";
    warmupAllBtn.setAttribute("aria-label", `Warm up all ${provider.name} accounts`);
    warmupAllBtn.title = `${eligibleCount} eligible; ${skippedCount} non-OK skipped`;
    warmupAllBtn.appendChild(icon(mdiFlash));
    warmupAllBtn.appendChild(document.createTextNode("Warm up all"));
    if (state.warmup.running || eligibleCount === 0) {
      warmupAllBtn.disabled = true;
    }
    warmupAllBtn.addEventListener("click", () => {
      window.omp.warmup({ provider: provider.id, action: "warm", all: true });
    });
    headerDiv.appendChild(warmupAllBtn);
  }

  card.appendChild(headerDiv);
  const table = document.createElement("table");
  table.className = hasWarmUp ? "table has-actions" : "table";
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
  if (hasWarmUp) {
    const thAction = document.createElement("th");
    thAction.scope = "col";
    thAction.className = "col-action";
    thAction.setAttribute("aria-label", "Account actions");
    trHead.appendChild(thAction);
  }

  thead.appendChild(trHead);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of matchingRows) {
    const tr = document.createElement("tr");

    const thAcc = document.createElement("th");
    thAcc.scope = "row";
    thAcc.className = `account col-account level-${row.level} account-clickable`;
    thAcc.textContent = row.displayAccount;
    thAcc.title = `Click to copy ${row.account}`;

    const copyIconSpan = document.createElement("span");
    copyIconSpan.className = "account-copy-icon";
    copyIconSpan.appendChild(icon(mdiContentCopy));
    thAcc.appendChild(copyIconSpan);

    thAcc.addEventListener("click", () => {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(row.account);
        copyIconSpan.replaceChildren(icon(mdiCheck));
        const copiedTag = document.createElement("span");
        copiedTag.className = "account-copied-tag";
        copiedTag.textContent = "Copied!";
        thAcc.appendChild(copiedTag);
        setTimeout(() => {
          copyIconSpan.replaceChildren(icon(mdiContentCopy));
          copiedTag.remove();
        }, 1500);
      }
    });
    tr.appendChild(thAcc);

    if (hasAnyRoute) {
      const tdRoute = document.createElement("td");
      tdRoute.className = "col-route";
      const routeSpan = document.createElement("span");
      routeSpan.className = `route level-${row.route.level}`;
      routeSpan.textContent = row.route.text;

      let title = ROUTE_TITLES[row.route.text] ?? row.route.text;
      if (row.route.model) {
        title += ` (${row.route.model})`;
      }
      if (row.route.checkedAt) {
        const ageMin = Math.round((Date.now() - row.route.checkedAt) / 60_000);
        title += ` · ${ageMin}m ago`;
      }
      if (row.route.detail) {
        title += ` · ${row.route.detail}`;
      }

      const isClickable = hasWarmUp && row.route.text !== "OK" && row.route.text !== "—";
      if (isClickable) {
        routeSpan.className += " route-clickable";
        routeSpan.title = `${title} — Click to probe now`;
        routeSpan.addEventListener("click", (e) => {
          e.stopPropagation();
          if (state.warmup.running) return;
          window.omp.warmup({
            provider: provider.id,
            action: "check",
            account: row.account,
          });
        });
      } else {
        routeSpan.title = title;
      }

      routeSpan.setAttribute("aria-label", routeSpan.title);
      tdRoute.appendChild(routeSpan);
      tr.appendChild(tdRoute);
    }

    for (const limit of row.limits) {
      tr.appendChild(renderLimitCell(limit));
    }
    if (hasWarmUp) {
      const tdAction = document.createElement("td");
      tdAction.className = "col-action";
      const eligibility = warmUpEligibility(provider.id, row.health);
      if (eligibility === "warm" || eligibility === "check") {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `row-action action-${eligibility}`;
        const isWarm = eligibility === "warm";
        btn.setAttribute("aria-label", `${isWarm ? "Warm up" : "Check"} ${row.displayAccount}`);
        btn.title = `${isWarm ? "Warm up" : "Check (unhang)"} ${row.account}`;
        btn.appendChild(icon(isWarm ? mdiFlash : mdiStethoscope));
        if (state.warmup.running) {
          btn.disabled = true;
        }
        btn.addEventListener("click", () => {
          window.omp.warmup({
            provider: provider.id,
            action: isWarm ? "warm" : "check",
            account: row.account,
          });
        });
        tdAction.appendChild(btn);
      }
      tr.appendChild(tdAction);
    }

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  card.appendChild(table);
  return card;
}
