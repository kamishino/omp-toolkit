import { mdiCheck, mdiChevronRight, mdiContentCopy, mdiFlash, mdiStethoscope } from "@mdi/js";
import {
  type DashboardProvider,
  type DashboardRow,
  formatPercent,
  supportsWarmUp,
  usageLevel,
  warmUpEligibility,
} from "@omp-toolkit/core";
import tokens from "../../../../design/tokens.json";
import type { PanelState } from "../ipc";
import { icon } from "./icon";
import { renderLimitCell } from "./limit-cell";
import { providerLogo } from "./provider-logos";

export type FilterScope = "all" | "high-usage" | "attention";

const COLLAPSED_STORAGE_KEY = "omp.collapsedProviders";

const USAGE_THRESHOLDS = {
  warm: tokens.usage.warmThreshold.$value,
  hot: tokens.usage.hotThreshold.$value,
  critical: tokens.usage.criticalThreshold.$value,
  above: tokens.usage.aboveThreshold.$value,
};

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

/**
 * The single filter predicate shared by chip counts and visible rows.
 * High usage is a quota-threshold test; attention is a triage grouping.
 */
export function matchesFilter(
  row: DashboardRow,
  scope: FilterScope,
  aboveThreshold: number,
): boolean {
  if (scope === "all") return true;
  if (scope === "high-usage") return row.maxUsed >= aboveThreshold;
  return (
    row.level === "critical" ||
    row.limits.some((limit) => limit.low) ||
    (row.health !== null && row.health !== "ok")
  );
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

function worstRoute(rows: readonly DashboardRow[]): DashboardRow | undefined {
  return (
    rows.find((r) => r.route.text === "HANG" || r.route.text === "ERR") ??
    rows.find((r) => r.route.text === "AUTH" || r.route.text === "MODEL") ??
    rows.find((r) => r.route.text === "STALE") ??
    rows.find((r) => r.route.text === "OK") ??
    rows[0]
  );
}

export function renderProviderCard(
  provider: DashboardProvider,
  aboveThreshold: number,
  providerIndex: number,
  state: PanelState,
  filterScope: FilterScope = "all",
): HTMLElement | null {
  const matchingRows = provider.rows.filter((row) =>
    matchesFilter(row, filterScope, aboveThreshold),
  );

  if (filterScope !== "all" && matchingRows.length === 0) {
    return null;
  }

  let isCollapsed = isProviderCollapsed(provider.id);
  const hasWarmUp = supportsWarmUp(provider.id);
  const showRoute = provider.rows.some((row) => row.health !== null);
  const titleId = `provider-title-${providerIndex}`;
  const tableId = `provider-table-${providerIndex}`;

  const card = document.createElement("section");
  card.className = isCollapsed ? "provider-card card-collapsed" : "provider-card";
  const headerDiv = document.createElement("div");
  headerDiv.className = "provider-header";

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "card-toggle-btn";
  toggleBtn.dataset.provider = provider.id;
  toggleBtn.dataset.action = "toggle";
  toggleBtn.setAttribute("aria-expanded", String(!isCollapsed));
  toggleBtn.setAttribute("aria-controls", tableId);
  toggleBtn.setAttribute(
    "aria-label",
    isCollapsed ? `Expand ${provider.name}` : `Collapse ${provider.name}`,
  );
  toggleBtn.title = isCollapsed ? "Expand card" : "Collapse card";
  toggleBtn.appendChild(icon(mdiChevronRight));
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

  const h2 = document.createElement("h2");
  h2.id = titleId;
  h2.className = "provider-title";
  h2.textContent = `${provider.name}${provider.suffix}`;
  headerDiv.appendChild(h2);

  const trailing = document.createElement("div");
  trailing.className = "provider-trailing";

  const previewDiv = document.createElement("div");
  previewDiv.className = "provider-summary";

  const countBadge = document.createElement("span");
  countBadge.className = "provider-summary-badge";
  countBadge.textContent = `${provider.accounts} ${provider.accounts === 1 ? "account" : "accounts"}`;
  previewDiv.appendChild(countBadge);

  if (showRoute) {
    const routeRow = worstRoute(provider.rows);
    if (routeRow && routeRow.route.text !== "—") {
      const badgeKind =
        routeRow.route.level === "ok"
          ? "ok"
          : routeRow.route.level === "critical"
            ? "danger"
            : "neutral";
      const routeBadge = document.createElement("span");
      routeBadge.className = `provider-summary-badge badge-${badgeKind}`;
      routeBadge.textContent = routeRow.route.text;
      routeBadge.title = ROUTE_TITLES[routeRow.route.text] ?? routeRow.route.text;
      previewDiv.appendChild(routeBadge);
    }
  }

  const maxUsed = Math.max(0, ...provider.rows.map((row) => row.maxUsed));
  if (maxUsed > 0) {
    const maxBadge = document.createElement("span");
    const level = usageLevel(maxUsed, USAGE_THRESHOLDS);
    const badgeKind = level === "critical" ? "danger" : level;
    maxBadge.className = `provider-summary-badge badge-${badgeKind}`;
    maxBadge.textContent = `${formatPercent(maxUsed)} max`;
    previewDiv.appendChild(maxBadge);
  }

  if (filterScope !== "all") {
    const filteredBadge = document.createElement("span");
    filteredBadge.className = "provider-summary-badge badge-neutral";
    filteredBadge.textContent = `showing ${matchingRows.length} of ${provider.rows.length}`;
    previewDiv.appendChild(filteredBadge);
  }

  trailing.appendChild(previewDiv);
  headerDiv.appendChild(trailing);

  const toggleCollapse = () => {
    isCollapsed = !isCollapsed;
    setProviderCollapsed(provider.id, isCollapsed);
    card.className = isCollapsed ? "provider-card card-collapsed" : "provider-card";
    toggleBtn.setAttribute("aria-expanded", String(!isCollapsed));
    toggleBtn.setAttribute(
      "aria-label",
      isCollapsed ? `Expand ${provider.name}` : `Collapse ${provider.name}`,
    );
    toggleBtn.title = isCollapsed ? "Expand card" : "Collapse card";
    table.hidden = isCollapsed;
    table.classList.toggle("motion-enter", !isCollapsed);
  };

  toggleBtn.addEventListener("click", toggleCollapse);

  if (provider.timeWindow) {
    const badge = document.createElement("span");
    const isPeak = provider.timeWindow.isPeak;
    badge.className = `time-window-badge ${isPeak ? "badge-peak" : "badge-off-peak"}`;
    badge.textContent = `${provider.timeWindow.label} · ${provider.timeWindow.formattedTimeUntilNext}`;
    badge.title = `${provider.timeWindow.badgeText} (reference clock: ${provider.timeWindow.referenceTimeZone})`;
    badge.setAttribute("aria-label", provider.timeWindow.badgeText);
    trailing.appendChild(badge);
  }

  if (hasWarmUp) {
    const eligibleCount = provider.rows.filter(
      (row) => warmUpEligibility(provider.id, row.health) === "warm",
    ).length;
    const skippedCount = provider.rows.length - eligibleCount;
    const warmupAllBtn = document.createElement("button");
    warmupAllBtn.type = "button";
    warmupAllBtn.className = "provider-action";
    warmupAllBtn.dataset.provider = provider.id;
    warmupAllBtn.dataset.action = "warm-all";
    warmupAllBtn.setAttribute("aria-label", `Warm up all ${provider.name} accounts`);
    warmupAllBtn.title = `${eligibleCount} eligible; ${skippedCount} non-OK skipped (all accounts)`;
    warmupAllBtn.appendChild(icon(mdiFlash));
    warmupAllBtn.appendChild(document.createTextNode("Warm up all"));
    if (state.warmup.running || eligibleCount === 0) {
      warmupAllBtn.disabled = true;
    }
    warmupAllBtn.addEventListener("click", () => {
      window.omp.warmup({ provider: provider.id, action: "warm", all: true });
    });
    trailing.appendChild(warmupAllBtn);
  }

  card.appendChild(headerDiv);
  const table = document.createElement("table");
  table.id = tableId;
  table.className = hasWarmUp ? "table has-actions" : "table";
  table.setAttribute("aria-labelledby", titleId);
  table.hidden = isCollapsed;

  const colgroup = document.createElement("colgroup");
  const accountCol = document.createElement("col");
  accountCol.className = "col-account";
  colgroup.appendChild(accountCol);
  if (showRoute) {
    const routeCol = document.createElement("col");
    routeCol.className = "col-route";
    colgroup.appendChild(routeCol);
  }
  for (const _column of provider.columns) {
    const limitCol = document.createElement("col");
    limitCol.className = "col-limit";
    colgroup.appendChild(limitCol);
  }
  if (hasWarmUp) {
    const actionCol = document.createElement("col");
    actionCol.className = "col-action";
    colgroup.appendChild(actionCol);
  }
  table.appendChild(colgroup);

  const thead = document.createElement("thead");
  const trHead = document.createElement("tr");

  const thAccount = document.createElement("th");
  thAccount.scope = "col";
  thAccount.className = "col-account";
  thAccount.textContent = "ACCOUNT";
  trHead.appendChild(thAccount);

  if (showRoute) {
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
    thAcc.className = "account col-account";

    const accountLine = document.createElement("div");
    accountLine.className = "account-line";

    const accountName = document.createElement("span");
    accountName.className = "account-name";
    accountName.textContent = row.displayAccount;
    accountName.title = row.account;
    accountLine.appendChild(accountName);

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "account-copy";
    copyBtn.dataset.provider = provider.id;
    copyBtn.dataset.action = "copy";
    copyBtn.dataset.account = row.account;
    copyBtn.setAttribute("aria-label", `Copy account ${row.account}`);
    copyBtn.title = `Copy ${row.account}`;
    copyBtn.appendChild(icon(mdiContentCopy));
    accountLine.appendChild(copyBtn);

    const copyStatus = document.createElement("span");
    copyStatus.className = "account-copy-status";
    copyStatus.setAttribute("role", "status");
    copyStatus.setAttribute("aria-live", "polite");
    thAcc.appendChild(accountLine);
    thAcc.appendChild(copyStatus);

    copyBtn.addEventListener("click", () => {
      const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
      if (!clipboard?.writeText) {
        copyStatus.textContent = "Copy unavailable";
        return;
      }
      copyBtn.disabled = true;
      void clipboard
        .writeText(row.account)
        .then(() => {
          copyStatus.textContent = "Copied";
          copyBtn.replaceChildren(icon(mdiCheck));
        })
        .catch(() => {
          copyStatus.textContent = "Copy failed";
        })
        .finally(() => {
          copyBtn.disabled = false;
          setTimeout(() => {
            copyStatus.textContent = "";
            copyBtn.replaceChildren(icon(mdiContentCopy));
          }, tokens.desktop.motion.duration.copyFeedback.$value);
        });
    });
    tr.appendChild(thAcc);

    if (showRoute) {
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
      routeSpan.title = title;
      routeSpan.setAttribute("aria-label", title);
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
        btn.dataset.provider = provider.id;
        btn.dataset.action = eligibility === "warm" ? "warm" : "check";
        btn.dataset.account = row.account;
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
