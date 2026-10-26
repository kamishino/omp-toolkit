import { type DashboardLimit, formatPercent, formatResetCompact, money } from "@omp-toolkit/core";

export function renderLimitCell(limit: DashboardLimit): HTMLElement {
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
