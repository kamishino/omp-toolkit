import { formatPercent, formatResetCompact, type UsageLevel, usageLevel } from "@omp-toolkit/core";
import tokens from "../../../design/tokens.json";

function ansiColor(value: string): string {
  const match = /^ansi:(\d+)$/.exec(value);
  if (!match) throw new Error(`unsupported color token: ${value}`);
  return `\x1b[38;5;${match[1]}m`;
}

export const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  border: ansiColor(tokens.color.border.$value),
  muted: ansiColor(tokens.color.muted.$value),
  cyan: ansiColor(tokens.color.accent.$value),
  green: ansiColor(tokens.color.ok.$value),
  yellow: ansiColor(tokens.color.warn.$value),
  orange: ansiColor(tokens.color.hot.$value),
  red: ansiColor(tokens.color.danger.$value),
} as const;

export const USAGE_THRESHOLDS = {
  warm: tokens.usage.warmThreshold.$value,
  hot: tokens.usage.hotThreshold.$value,
  critical: tokens.usage.criticalThreshold.$value,
  above: tokens.usage.aboveThreshold.$value,
} as const;

export const HEALTH_THRESHOLDS = {
  restoreStreak: tokens.health.restoreStreak.$value,
  restoreGapSeconds: tokens.health.restoreGapSeconds.$value,
  staleSnapshotMinutes: tokens.health.staleSnapshotMinutes.$value,
} as const;

export function colorEnabled(): boolean {
  return (
    (process.stdout.isTTY === true && !process.env.NO_COLOR) || process.env.FORCE_COLOR === "1"
  );
}

export function paint(text: string, code: string): string {
  return colorEnabled() ? `${code}${text}${ANSI.reset}` : text;
}

export function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI SGR codes is the intent
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

export function padVisible(text: string, width: number): string {
  const length = stripAnsi(text).length;
  return length >= width ? text : text + " ".repeat(width - length);
}

export function colorForLevel(level: UsageLevel): string {
  switch (level) {
    case "critical":
      return ANSI.red;
    case "hot":
      return ANSI.orange;
    case "warn":
      return ANSI.yellow;
    case "ok":
      return ANSI.green;
    default:
      return ANSI.muted;
  }
}

export function colorFor(value: number | undefined): string {
  return colorForLevel(usageLevel(value, USAGE_THRESHOLDS));
}

export function bar(value: number | undefined, width = 10): string {
  if (value === undefined) return "░".repeat(width);
  const filled = Math.round(value * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function percent(value: number | undefined): string {
  return formatPercent(value).padStart(6);
}

export function resetInAt(resetsAt: number | undefined): string {
  return formatResetCompact(resetsAt, Date.now()).padStart(6);
}
