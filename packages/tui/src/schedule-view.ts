import { buildScheduleTable, evaluateWindow, type TimeWindowPolicy } from "@omp-toolkit/core";
import { createParagraph, type Frame, frameRenderWidget, renderParagraph } from "terminui";
import { ANSI, padVisible, paint, stripAnsi } from "./theme";

export interface ScheduleViewOptions {
  userTimeZone?: string;
  now?: number;
}

export function renderScheduleView(
  policies: TimeWindowPolicy[],
  options: ScheduleViewOptions = {},
): string {
  const width = 86;
  const inner = width - 2;
  const border = (text: string) => paint(text, ANSI.border);
  const line = (content: string) =>
    `${border("│")} ${padVisible(content, width - 4)} ${border("│")}`;

  const tz = options.userTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const now = options.now ?? Date.now();
  const time = ` ${new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} `;
  const title = " Provider Pricing Schedules ";
  const topFill = Math.max(0, width - 4 - title.length - time.length);

  const top =
    border("╭─") +
    paint(title, ANSI.bold + ANSI.cyan) +
    border("─".repeat(topFill)) +
    paint(time, ANSI.muted) +
    border("─╮");

  const lines: string[] = [top, line(paint(`Local Timezone: ${tz}`, ANSI.muted))];

  for (const policy of policies) {
    const currentEval = evaluateWindow(policy, now, tz);
    lines.push(border(`├${"─".repeat(inner)}┤`));
    const badgeColor = currentEval.isPeak ? ANSI.yellow : ANSI.green;
    lines.push(
      line(
        `${paint(policy.name, ANSI.bold + ANSI.cyan)} ${paint(currentEval.badgeText, badgeColor)}`,
      ),
    );

    const header = `${"DAY".padEnd(10)} ${"REFERENCE (UTC)".padEnd(18)} ${"LOCAL TIME".padEnd(26)} ${"RATE".padEnd(14)} STATUS`;
    lines.push(line(paint(header, ANSI.bold)));

    const rows = buildScheduleTable(policy, now, tz);
    for (const r of rows) {
      const day = r.dayName.padEnd(10);
      const ref = r.referenceTime.padEnd(18);
      const local = r.localTime.padEnd(26);
      const rate = (r.windowType === "peak" ? "1.0× (Peak)" : "0.5× (50% off)").padEnd(14);
      const statusText = r.isCurrent ? "● ACTIVE" : "—";
      const statusColor = r.isCurrent
        ? r.windowType === "peak"
          ? ANSI.yellow
          : ANSI.green
        : ANSI.muted;
      const status = paint(statusText, statusColor);

      lines.push(line(`${paint(day, ANSI.muted)} ${ref} ${local} ${rate} ${status}`));
    }
  }

  lines.push(border(`╰${"─".repeat(inner)}╯`));
  return lines.join("\n");
}
export function drawScheduleView(
  frame: Frame,
  policies: TimeWindowPolicy[],
  options: ScheduleViewOptions = {},
): void {
  const rendered = renderScheduleView(policies, options);
  const p = createParagraph(stripAnsi(rendered));
  frameRenderWidget(frame, renderParagraph(p), frame.area);
}
