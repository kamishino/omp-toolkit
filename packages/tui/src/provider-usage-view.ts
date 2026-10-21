import {
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

function columnBlock(limit: UsageLimit | undefined): string {
  const unit = limit?.amount?.unit?.toLowerCase();
  if (unit === "cny" || unit === "usd") {
    const color = limit?.status === "exhausted" ? ANSI.red : ANSI.green;
    return padVisible(paint(money(limit?.amount?.remaining, unit), color), 24);
  }
  const value = usedPercent(limit);
  return `${paint(bar(value), colorFor(value))} ${paint(percent(value), colorFor(value))} ${paint(resetIn(limit), ANSI.muted)}`;
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
    second: "2-digit",
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

    const hasRoute = options.showHealth && section.provider === "google-antigravity";
    const header =
      `${"ACCOUNT".padEnd(20)} ${hasRoute ? "ROUTE  " : ""}` +
      section.columns.map((column) => `${column.label.toUpperCase().padEnd(24)}`).join("   ");
    output.push(line(paint(header, ANSI.bold)));

    for (const row of section.rows) {
      const account = paint(local(row.account).padEnd(20), colorFor(row.max));
      const route = hasRoute ? `${routeTag(row.health)}  ` : "";
      const blocks = section.columns
        .map((column) => columnBlock(limitFor(row.report, column)))
        .join("   ");
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
    ? ` · health ${healthAge(options.checkedAt)}${stale ? " (stale)" : ""}`
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
