import { type DashboardLimit, formatPercent, formatResetCompact, money } from "@omp-toolkit/core";

function span(className: string, text: string): HTMLSpanElement {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = text;
  return node;
}

export function renderLimitCell(limit: DashboardLimit): HTMLElement {
  const td = document.createElement("td");
  td.className = "col-limit";

  const container = document.createElement("div");
  container.className = "limit-cell";

  const main = document.createElement("div");
  main.className = "limit-main";

  const detail = document.createElement("div");
  detail.className = "limit-detail";

  if (limit.unit === "cny" || limit.unit === "usd") {
    main.appendChild(span(`money level-${limit.level}`, money(limit.remaining, limit.unit)));
    detail.appendChild(span("limit-context", "remaining"));
    if (limit.low) {
      const lowSpan = span("low", "LOW");
      lowSpan.title = "Balance at or below the low-balance alert threshold";
      main.appendChild(lowSpan);
    }
  } else if (limit.usedFraction !== undefined) {
    main.className = "limit-main limit-main-fraction";

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
        `${limit.label}: ${formatPercent(used)} used, today's max ${whole(ceiling)}%`,
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
      main.appendChild(barWrap);

      const pctSpan = span(`percent level-${limit.level}`, `${whole(used)}% used`);
      pctSpan.title = `${whole(used)}% used · ${whole(ceiling)}% pacing ceiling for today (day ${limit.pacing.dayIndex + 1} of 7)`;
      main.appendChild(pctSpan);

      const ceilingSpan = span("limit-context", `${whole(ceiling)}% max today`);
      ceilingSpan.title = `Day ${limit.pacing.dayIndex + 1} of 7 · ${headroom >= 0 ? `${whole(headroom)}% headroom` : `${whole(-headroom)}% over ceiling`}`;
      detail.appendChild(ceilingSpan);

      if (limit.resetsAt !== undefined) {
        const resetSpan = span("reset", `resets ${formatResetCompact(limit.resetsAt, Date.now())}`);
        resetSpan.title = "Time until this limit resets";
        detail.appendChild(resetSpan);
      }
    } else {
      const progress = document.createElement("progress");
      progress.max = 100;
      progress.value = Math.round(limit.usedFraction * 100);
      progress.className = `level-${limit.level}`;
      progress.setAttribute(
        "aria-label",
        limit.resetsAt !== undefined
          ? `${limit.label} ${formatPercent(limit.usedFraction)} used, resets in ${formatResetCompact(limit.resetsAt, Date.now())}`
          : `${limit.label} ${formatPercent(limit.usedFraction)} used`,
      );
      main.appendChild(progress);

      main.appendChild(
        span(`percent level-${limit.level}`, `${Math.round(limit.usedFraction * 100)}% used`),
      );

      if (limit.resetsAt !== undefined) {
        const resetSpan = span("reset", `resets ${formatResetCompact(limit.resetsAt, Date.now())}`);
        resetSpan.title = "Time until this limit resets";
        detail.appendChild(resetSpan);
      }
    }
  } else {
    main.appendChild(span("level-unknown", "—"));
  }

  container.appendChild(main);
  if (detail.children.length > 0) container.appendChild(detail);
  td.appendChild(container);
  return td;
}
