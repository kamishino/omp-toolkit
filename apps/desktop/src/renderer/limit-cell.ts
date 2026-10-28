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
    if (limit.pacing) {
      const whole = (v: number) => Math.round(v * 100);
      const used = limit.usedFraction;
      const ceiling = limit.pacing.todayCeilingFraction;
      const headroom = limit.pacing.headroomFraction;

      const barWrap = document.createElement("div");
      barWrap.className = `limit-bar-wrap level-${limit.level}`;
      barWrap.setAttribute("role", "progressbar");
      barWrap.setAttribute("aria-valuemin", "0");
      barWrap.setAttribute("aria-valuemax", "100");
      barWrap.setAttribute("aria-valuenow", String(whole(used)));
      barWrap.setAttribute(
        "aria-label",
        `${limit.label} ${formatPercent(used)} of ${whole(ceiling)}% max today`,
      );
      barWrap.title = `Day ${limit.pacing.dayIndex + 1}/7 · max today ${whole(ceiling)}% · ${headroom >= 0 ? `${whole(headroom)}% left` : `${whole(-headroom)}% over`}`;

      const barTrack = document.createElement("div");
      barTrack.className = "limit-bar-track";

      const barFill = document.createElement("div");
      barFill.className = "limit-bar-fill";
      barFill.style.width = `${Math.min(used, ceiling) * 100}%`;
      barTrack.appendChild(barFill);

      if (used > ceiling) {
        const barOver = document.createElement("div");
        barOver.className = "limit-bar-over";
        barOver.style.left = `${ceiling * 100}%`;
        barOver.style.width = `${(used - ceiling) * 100}%`;
        barTrack.appendChild(barOver);
      }
      barWrap.appendChild(barTrack);

      if (ceiling < 1) {
        const barTick = document.createElement("div");
        barTick.className = "limit-bar-tick";
        barTick.style.left = `${ceiling * 100}%`;
        barWrap.appendChild(barTick);
      }
      container.appendChild(barWrap);

      const pctSpan = document.createElement("span");
      pctSpan.className = `percent level-${limit.level}`;
      pctSpan.textContent = `${whole(used)}/${whole(ceiling)}%`;
      container.appendChild(pctSpan);

      const resetSpan = document.createElement("span");
      resetSpan.className = "reset";
      resetSpan.textContent = formatResetCompact(limit.resetsAt, Date.now());
      container.appendChild(resetSpan);
    } else {
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
    }
  } else {
    const emptySpan = document.createElement("span");
    emptySpan.className = "level-unknown";
    emptySpan.textContent = "—";
    container.appendChild(emptySpan);
  }

  td.appendChild(container);
  return td;
}
