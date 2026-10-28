import { formatPercent, formatResetCompact, type WeeklyPacing } from "@omp-toolkit/core";

function formatChipPercent(val: number): string {
  return `${Math.round(val * 100)}%`;
}

export function renderPacingRow(pacing: WeeklyPacing, colSpan: number): HTMLElement {
  const tr = document.createElement("tr");
  tr.className = "pacing-row";

  const td = document.createElement("td");
  td.className = "col-pacing";
  td.setAttribute("colspan", String(colSpan));

  const container = document.createElement("div");
  container.className = "pacing-container";

  // 1. Metrics div
  const metricsDiv = document.createElement("div");
  metricsDiv.className = `pacing-metrics level-${pacing.level}`;

  const badge = document.createElement("span");
  badge.className = "pacing-badge";
  badge.textContent = "PACE";
  metricsDiv.appendChild(badge);

  let paceWord = "on pace";
  let sign = "±";
  if (pacing.status === "over") {
    paceWord = "over";
    sign = "+";
  } else if (pacing.status === "under") {
    paceWord = "under";
    sign = "−";
  }

  const todayStr =
    pacing.todayUsedFraction === null
      ? "—"
      : `${pacing.todayLowerBound ? "≥" : ""}${formatPercent(pacing.todayUsedFraction)}`;
  const deltaStr = `${paceWord} ${sign}${formatPercent(Math.abs(pacing.paceDeltaFraction))}`;
  const exhaustionStr = pacing.projectedExhaustionAt
    ? `empty in ${formatResetCompact(pacing.projectedExhaustionAt, Date.now())}`
    : "lasts to reset";

  const textSpan = document.createElement("span");
  textSpan.className = "pacing-text";
  textSpan.textContent = `Day ${pacing.dayIndex + 1}/7 · today ${todayStr} · safe left ${formatPercent(pacing.safeLeftTodayFraction)} · ${deltaStr} · ${exhaustionStr}`;
  metricsDiv.appendChild(textSpan);

  container.appendChild(metricsDiv);

  // 2. Slices div
  const slicesDiv = document.createElement("div");
  slicesDiv.className = "pacing-slices";

  for (const slice of pacing.slices) {
    const chip = document.createElement("div");
    const isUnobserved = slice.usedFraction === null && slice.state !== "future";
    chip.className = `pacing-slice is-${slice.state}${isUnobserved ? " is-unobserved" : ""}${slice.state === "current" ? ` level-${pacing.level}` : ""}`;
    chip.setAttribute(
      "title",
      `Day ${slice.index + 1}: ${slice.state}${
        slice.state === "future"
          ? ` (budget: ${formatPercent(slice.budgetFraction ?? 0)})`
          : slice.usedFraction !== null
            ? ` (${slice.lowerBound ? "≥" : ""}${formatPercent(slice.usedFraction)})`
            : " (unobserved)"
      }`,
    );

    const lbl = document.createElement("span");
    lbl.className = "slice-label";
    lbl.textContent = `D${slice.index + 1}`;
    chip.appendChild(lbl);

    const progress = document.createElement("progress");
    progress.max = 100;
    const progressVal =
      slice.state === "future"
        ? Math.round((slice.budgetFraction ?? 0) * 100)
        : slice.usedFraction !== null
          ? Math.round(slice.usedFraction * 100)
          : 0;
    progress.value = progressVal;
    progress.className = slice.state === "current" ? `level-${pacing.level}` : "";
    chip.appendChild(progress);

    const val = document.createElement("span");
    val.className = "slice-value";
    let tokenVal = "—";
    if (slice.state === "future") {
      tokenVal = `[${formatChipPercent(slice.budgetFraction ?? 0)}]`;
    } else if (slice.usedFraction !== null) {
      tokenVal = `${slice.lowerBound ? "≥" : ""}${formatChipPercent(slice.usedFraction)}`;
    }
    val.textContent = tokenVal;
    chip.appendChild(val);

    slicesDiv.appendChild(chip);
  }

  if (pacing.unobservedFraction > 0) {
    const unobsSpan = document.createElement("span");
    unobsSpan.className = "pacing-unobserved";
    unobsSpan.textContent = `· unobserved ${formatPercent(pacing.unobservedFraction)}`;
    slicesDiv.appendChild(unobsSpan);
  }

  container.appendChild(slicesDiv);
  td.appendChild(container);
  tr.appendChild(td);
  return tr;
}
