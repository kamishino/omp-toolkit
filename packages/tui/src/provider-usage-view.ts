import {
  type BalanceAlertThresholds,
  buildDashboard,
  type Dashboard,
  type DashboardLimit,
  type DashboardRoute,
  DEFAULT_BALANCE_ALERT,
  formatAge,
  formatResetCompact,
  money,
  type ProviderSection,
  summaryText,
  type WeeklyPacing,
} from "@omp-toolkit/core";
import { createParagraph, type Frame, frameRenderWidget, renderParagraph } from "terminui";
import {
  ANSI,
  ansiToText,
  bar,
  colorForLevel,
  HEALTH_THRESHOLDS,
  padVisible,
  paint,
  percent,
  resetInAt,
  USAGE_THRESHOLDS,
} from "./theme";

export interface ProviderUsageViewOptions {
  interval: number;
  watch: boolean;
  showHealth: boolean;
  checkedAt?: number;
  balanceAlert?: BalanceAlertThresholds;
}

const ROUTE_SPACING: Record<string, string> = {
  OK: " OK  ",
  HANG: "HANG ",
  AUTH: "AUTH ",
  MODEL: "MODEL",
  ERR: " ERR ",
  "—": "  —  ",
};

function routeTag(route: DashboardRoute): string {
  const text = ROUTE_SPACING[route.text] ?? route.text;
  return paint(text, colorForLevel(route.level));
}

function fit(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
}

function columnBlock(limit: DashboardLimit, width: number): string {
  const unit = limit.unit;
  if (unit === "cny" || unit === "usd") {
    const amount = money(limit.remaining, unit);
    const text = limit.low ? (width >= 12 ? `${amount} LOW` : `!${amount}`) : amount;
    return padVisible(paint(text, colorForLevel(limit.level)), width);
  }
  const value = limit.usedFraction;
  if (width >= 15) {
    return padVisible(
      `${paint(bar(value, Math.max(1, width - 14)), colorForLevel(limit.level))} ${paint(percent(value), colorForLevel(limit.level))} ${paint(resetInAt(limit.resetsAt), ANSI.muted)}`,
      width,
    );
  }
  if (width >= 13) {
    return padVisible(
      `${paint(percent(value), colorForLevel(limit.level))} ${paint(resetInAt(limit.resetsAt), ANSI.muted)}`,
      width,
    );
  }
  return padVisible(paint(percent(value), colorForLevel(limit.level)), width);
}

function pacingLines(pacing: WeeklyPacing, indent = 2): string[] {
  const prefix = " ".repeat(indent);
  const {
    dayIndex,
    todayUsedFraction,
    todayLowerBound,
    safeLeftTodayFraction,
    status,
    paceDeltaFraction,
    projectedExhaustionAt,
    level,
    slices,
    unobservedFraction,
  } = pacing;

  let paceWord = "on pace";
  let sign = "±";
  if (status === "over") {
    paceWord = "over";
    sign = "+";
  } else if (status === "under") {
    paceWord = "under";
    sign = "−";
  }

  const todayStr =
    todayUsedFraction === null ? "—" : `${todayLowerBound ? "≥" : ""}${percent(todayUsedFraction)}`;
  const deltaStr = `${paceWord} ${sign}${percent(Math.abs(paceDeltaFraction))}`;
  const exhaustionStr = projectedExhaustionAt
    ? `empty in ${formatResetCompact(projectedExhaustionAt, Date.now())}`
    : "lasts to reset";

  const metricsContent = `Day ${dayIndex + 1}/7 · today ${todayStr} · safe left ${percent(safeLeftTodayFraction)} · ${deltaStr} · ${exhaustionStr}`;
  const metricsLine = `${prefix}${paint("PACE", ANSI.muted)} ${paint(metricsContent, colorForLevel(level))}`;

  const sliceTokens = slices.map((slice) => {
    let tokenVal = "—";
    if (slice.state === "future") {
      tokenVal = `[${percent(slice.budgetFraction ?? 0)}]`;
    } else if (slice.usedFraction !== null) {
      tokenVal = `${slice.lowerBound ? "≥" : ""}${percent(slice.usedFraction)}`;
    }
    const token = `D${slice.index + 1} ${tokenVal}`;
    return slice.state === "current"
      ? paint(token, colorForLevel(level))
      : paint(token, ANSI.muted);
  });

  let slicesLine = `${prefix}${sliceTokens.join(" ")}`;
  if (unobservedFraction > 0) {
    slicesLine += ` ${paint(`· unobserved ${percent(unobservedFraction)}`, ANSI.muted)}`;
  }

  return [metricsLine, slicesLine];
}

export function renderProviderUsageFromDashboard(
  dashboard: Dashboard,
  options: ProviderUsageViewOptions,
): string {
  const width = 86;
  const inner = width - 2;
  const border = (text: string) => paint(text, ANSI.border);
  const line = (content: string) =>
    `${border("│")} ${padVisible(content, width - 4)} ${border("│")}`;

  const time = ` ${new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    ...(options.watch ? {} : { second: "2-digit" }),
  })} `;
  const title = " OMP Provider Usage ";
  const topFill = Math.max(0, width - 4 - title.length - time.length);
  const top =
    border("╭─") +
    paint(title, ANSI.bold + ANSI.cyan) +
    border("─".repeat(topFill)) +
    paint(time, ANSI.muted) +
    border("─╮");

  const now = Date.now();

  const summary = summaryText(dashboard.summary);
  const hasAnyRoute =
    options.showHealth &&
    dashboard.providers.some((section) => section.rows.some((row) => row.health !== null));

  const contentWidth = width - 4;
  const accountWidth = 20;
  const routeWidth = 7;
  const gap = 3;
  const maxColumns = Math.max(1, ...dashboard.providers.map((section) => section.columns.length));
  const base = accountWidth + 1 + (hasAnyRoute ? routeWidth : 0);
  const available = contentWidth - base - (maxColumns > 1 ? gap * (maxColumns - 1) : 0);
  const columnWidth = Math.max(8, Math.min(24, Math.floor(available / maxColumns)));

  const output: string[] = [top, line(paint(summary, ANSI.muted))];

  for (const section of dashboard.providers) {
    output.push(border(`├${"─".repeat(inner)}┤`));
    const badge = section.timeWindow
      ? ` ${paint(section.timeWindow.badgeText, section.timeWindow.isPeak ? ANSI.yellow : ANSI.green)}`
      : "";

    output.push(
      line(
        paint(
          `${section.name} · ${section.accounts} ${section.accounts === 1 ? "account" : "accounts"}${section.suffix}`,
          ANSI.bold + ANSI.cyan,
        ) + badge,
      ),
    );

    const hasRoute = hasAnyRoute;
    const header =
      `${"ACCOUNT".padEnd(accountWidth)} ` +
      (hasRoute ? `${"ROUTE".padEnd(routeWidth)}` : "") +
      section.columns
        .map((column) => fit(column.label.toUpperCase(), columnWidth).padEnd(columnWidth))
        .join(" ".repeat(gap));
    output.push(line(paint(header, ANSI.bold)));

    for (const row of section.rows) {
      const account = paint(
        fit(row.displayAccount, accountWidth).padEnd(accountWidth),
        colorForLevel(row.level),
      );
      const route = hasRoute ? padVisible(routeTag(row.route), routeWidth) : "";
      const blocks = row.limits
        .map((limit) => columnBlock(limit, columnWidth))
        .join(" ".repeat(gap));
      output.push(line(`${account} ${route}${blocks}`));
      const pacingLimit = row.limits.find((l) => l.pacing);
      if (pacingLimit?.pacing) {
        for (const pLine of pacingLines(pacingLimit.pacing, 2)) {
          output.push(line(pLine));
        }
      }
    }
  }

  output.push(border(`├${"─".repeat(inner)}┤`));
  const healthNote = options.showHealth
    ? ` · health ${dashboard.health?.checkedAt ? formatAge(dashboard.health.checkedAt, now, options.watch) : "no snapshot"}${dashboard.health?.stale ? " (stale)" : ""}`
    : "";
  output.push(
    line(
      paint(
        `Source: omp usage${healthNote} · ${
          options.watch
            ? `refresh ${options.interval}s · [q] quit  [r] refresh  [Tab] schedule`
            : "one-shot"
        }`,
        ANSI.muted,
      ),
    ),
  );
  output.push(border(`╰${"─".repeat(inner)}╯`));
  return output.join("\n");
}

export function renderProviderUsage(
  target: Dashboard | ProviderSection[],
  options: ProviderUsageViewOptions,
): string {
  if ("providers" in target && "summary" in target) {
    return renderProviderUsageFromDashboard(target, options);
  }
  const now = Date.now();
  const dashboard = buildDashboard(target, {
    fetchedAt: now,
    now,
    showHealth: options.showHealth,
    checkedAt: options.checkedAt,
    thresholds: USAGE_THRESHOLDS,
    staleMinutes: HEALTH_THRESHOLDS.staleSnapshotMinutes,
    balanceAlert: options.balanceAlert ?? DEFAULT_BALANCE_ALERT,
  });
  return renderProviderUsageFromDashboard(dashboard, options);
}

export function drawProviderUsage(
  frame: Frame,
  dashboard: Dashboard,
  options: ProviderUsageViewOptions,
): void {
  const rendered = renderProviderUsageFromDashboard(dashboard, options);
  const p = createParagraph(ansiToText(rendered));
  frameRenderWidget(frame, renderParagraph(p), frame.area);
}
