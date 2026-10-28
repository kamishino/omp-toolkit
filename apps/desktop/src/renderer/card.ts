import { mdiFlash, mdiStethoscope } from "@mdi/js";
import { type DashboardProvider, supportsWarmUp, warmUpEligibility } from "@omp-toolkit/core";
import type { PanelState } from "../ipc";
import { icon } from "./icon";
import { renderLimitCell } from "./limit-cell";
import { providerLogo } from "./provider-logos";

export function renderProviderCard(
  provider: DashboardProvider,
  hasAnyRoute: boolean,
  providerIndex: number,
  state: PanelState,
): HTMLElement {
  const hasWarmUp = supportsWarmUp(provider.id);
  const card = document.createElement("section");
  card.className = "provider-card";
  const headerDiv = document.createElement("div");
  headerDiv.className = "provider-header";

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
  }
  headerDiv.appendChild(logoSlot);

  const titleId = `provider-title-${providerIndex}`;
  const h2 = document.createElement("h2");
  h2.id = titleId;
  h2.className = "provider-title";
  h2.textContent = `${provider.name}${provider.suffix} · ${provider.accounts} ${provider.accounts === 1 ? "account" : "accounts"}`;
  headerDiv.appendChild(h2);

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
    const eligibleCount = provider.rows.filter(
      (r) => warmUpEligibility(provider.id, r.health) === "warm",
    ).length;
    const skippedCount = provider.rows.length - eligibleCount;
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
