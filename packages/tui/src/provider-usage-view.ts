import {
  type BalanceAlertThresholds,
  DEFAULT_BALANCE_ALERT,
  type HealthResult,
  limitFor,
  local,
  type ProviderSection,
  providerName,
  shortProvider,
  type UsageLimit,
  usedPercent,
} from "@omp-toolkit/core";
import { ANSI, bar, colorFor, healthAge, padVisible, paint, percent, resetIn } from "./theme";

export interface ProviderUsageViewOptions {
  interval: number;
  watch: boolean;
  showHealth: boolean;
  checkedAt?: number;
  balanceAlert?: BalanceAlertThresholds;
}

function routeTag(health: HealthResult | undefined): string {
  if (!health) return paint("  —  ", ANSI.muted);
  switch (health.status) {
    case "ok":
      return paint(" OK  ", ANSI.green);
    case "hang":
      return paint("HANG ", ANSI.red);
    case "auth":
      return paint("AUTH ", ANSI.yellow);
    case "model-error":
      return paint("MODEL", ANSI.yellow);
    default:
      return paint(" ERR ", ANSI.red);
  }
}

export function money(value: number | undefined, unit: string | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const symbol = unit === "cny" ? "¥" : unit === "usd" ? "$" : "";
  const amount = value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${symbol}${amount}`;
}

function fit(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
}

export function isLowBalance(
  limit: UsageLimit | undefined,
  thresholds: BalanceAlertThresholds,
): boolean {
  if (!limit?.id?.endsWith(":balance")) return false;
  const unit = limit.amount?.unit?.toLowerCase();
  const threshold = unit === "cny" ? thresholds.cny : unit === "usd" ? thresholds.usd : undefined;
  const remaining = limit.amount?.remaining;
  return threshold !== undefined && remaining !== undefined && remaining <= threshold;
}

function columnBlock(
  limit: UsageLimit | undefined,
  width: number,
  balanceAlert: BalanceAlertThresholds,
): string {
  const unit = limit?.amount?.unit?.toLowerCase();
  if (unit === "cny" || unit === "usd") {
    const low = isLowBalance(limit, balanceAlert);
    const amount = money(limit?.amount?.remaining, unit);
    const text = low ? (width >= 12 ? `${amount} LOW` : `!${amount}`) : amount;
    return padVisible(paint(text, low ? ANSI.red : ANSI.green), width);
  }
  const value = usedPercent(limit);
  if (width >= 15) {
    return padVisible(
      `${paint(bar(value, Math.max(1, width - 14)), colorFor(value))} ${paint(percent(value), colorFor(value))} ${paint(resetIn(limit), ANSI.muted)}`,
      width,
    );
  }
  if (width >= 13) {
    return padVisible(
      `${paint(percent(value), colorFor(value))} ${paint(resetIn(limit), ANSI.muted)}`,
      width,
    );
  }
  return padVisible(paint(percent(value), colorFor(value)), width);
}

export function renderProviderUsage(
  sections: ProviderSection[],
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

  const allRows = sections.flatMap((section) => section.rows);
  const above80 = allRows.filter((row) => row.max >= 0.8).length;
  const exhausted = allRows.filter((row) => row.max >= 1).length;
  const percentageRows = sections.flatMap((section) =>
    section.rows.filter((row) =>
      section.columns.some((column) => usedPercent(limitFor(row.report, column)) !== undefined),
    ),
  );
  const tightest = percentageRows.reduce(
    (best, row) => (!best || row.max > best.max ? row : best),
    undefined as (typeof percentageRows)[number] | undefined,
  );
  const summary = [
    `${sections.length} providers`,
    `${allRows.length} accounts`,
    `${above80} ≥80%`,
    `${exhausted} maxed`,
    tightest
      ? `tightest ${shortProvider(tightest.report.provider)}:${local(tightest.account)} ${(tightest.max * 100).toFixed(0)}%`
      : "no usage data",
  ].join(" · ");

  const balanceAlert = options.balanceAlert ?? DEFAULT_BALANCE_ALERT;
  const hasAnyRoute =
    options.showHealth &&
    sections.some((section) => section.rows.some((row) => row.health !== undefined));
  const contentWidth = width - 4;
  const accountWidth = 20;
  const routeWidth = 7;
  const gap = 3;
  const maxColumns = Math.max(1, ...sections.map((section) => section.columns.length));
  const base = accountWidth + 1 + (hasAnyRoute ? routeWidth : 0);
  const available = contentWidth - base - (maxColumns > 1 ? gap * (maxColumns - 1) : 0);
  const columnWidth = Math.max(8, Math.min(24, Math.floor(available / maxColumns)));

  const output: string[] = [top, line(paint(summary, ANSI.muted))];

  for (const section of sections) {
    output.push(border("├" + "─".repeat(inner) + "┤"));
    const plans = [
      ...new Set(
        section.reports
          .map((report) => report.metadata?.plan)
          .filter((plan): plan is string => typeof plan === "string" && plan.length > 0),
      ),
    ];
    const balanceCurrency = section.reports
      .map((report) => report.metadata?.balance?.currency)
      .find((currency): currency is string => typeof currency === "string" && currency.length > 0);
    const suffix =
      section.provider === "google-antigravity"
        ? " · Gemini"
        : balanceCurrency
          ? ` · ${balanceCurrency}`
          : plans.length === 1
            ? ` · ${plans[0]}`
            : "";
    output.push(
      line(
        paint(
          `${providerName(section.provider)} · ${section.reports.length} ${section.reports.length === 1 ? "account" : "accounts"}${suffix}`,
          ANSI.bold + ANSI.cyan,
        ),
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
        fit(local(row.account), accountWidth).padEnd(accountWidth),
        colorFor(row.max),
      );
      const route = hasRoute ? padVisible(routeTag(row.health), routeWidth) : "";
      const blocks = section.columns
        .map((column) => columnBlock(limitFor(row.report, column), columnWidth, balanceAlert))
        .join(" ".repeat(gap));
      output.push(line(`${account} ${route}${blocks}`));
    }
  }

  output.push(border("├" + "─".repeat(inner) + "┤"));
  const stale =
    options.showHealth &&
    options.checkedAt !== undefined &&
    options.checkedAt > 0 &&
    Date.now() - options.checkedAt > 15 * 60_000;
  const healthNote = options.showHealth
    ? ` · health ${healthAge(options.checkedAt, options.watch)}${stale ? " (stale)" : ""}`
    : "";
  output.push(
    line(
      paint(
        `Source: omp usage${healthNote} · ${
          options.watch ? `refresh ${options.interval}s · Ctrl+C to stop` : "one-shot"
        }`,
        ANSI.muted,
      ),
    ),
  );
  output.push(border("╰" + "─".repeat(inner) + "╯"));
  return output.join("\n");
}
