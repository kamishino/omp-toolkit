import { formatPercent, formatResetCompact, type UsageLevel, usageLevel } from "@omp-toolkit/core";
import {
  createStyle,
  indexedColor,
  Modifier,
  type Style,
  styleAddModifier,
  styleFg,
} from "terminui";
import tokens from "../../../design/tokens.json";

function ansiIndex(value: string): number {
  const match = /^ansi:(\d+)$/.exec(value);
  if (!match) throw new Error(`unsupported color token: ${value}`);
  return Number.parseInt(match[1], 10);
}

export const COLOR_INDICES = {
  border: ansiIndex(tokens.color.border.$value),
  muted: ansiIndex(tokens.color.muted.$value),
  accent: ansiIndex(tokens.color.accent.$value),
  ok: ansiIndex(tokens.color.ok.$value),
  warn: ansiIndex(tokens.color.warn.$value),
  hot: ansiIndex(tokens.color.hot.$value),
  danger: ansiIndex(tokens.color.danger.$value),
} as const;

export const TERMINUI_STYLES = {
  border: styleFg(createStyle(), indexedColor(COLOR_INDICES.border)),
  muted: styleFg(createStyle(), indexedColor(COLOR_INDICES.muted)),
  accent: styleFg(createStyle(), indexedColor(COLOR_INDICES.accent)),
  accentBold: styleAddModifier(
    styleFg(createStyle(), indexedColor(COLOR_INDICES.accent)),
    Modifier.BOLD,
  ),
  bold: styleAddModifier(createStyle(), Modifier.BOLD),
  ok: styleFg(createStyle(), indexedColor(COLOR_INDICES.ok)),
  warn: styleFg(createStyle(), indexedColor(COLOR_INDICES.warn)),
  hot: styleFg(createStyle(), indexedColor(COLOR_INDICES.hot)),
  danger: styleFg(createStyle(), indexedColor(COLOR_INDICES.danger)),
};

export function styleForLevel(level: UsageLevel): Style {
  switch (level) {
    case "ok":
      return TERMINUI_STYLES.ok;
    case "warn":
      return TERMINUI_STYLES.warn;
    case "hot":
      return TERMINUI_STYLES.hot;
    case "critical":
      return TERMINUI_STYLES.danger;
    case "unknown":
      return TERMINUI_STYLES.muted;
  }
}

export const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  border: `\x1b[38;5;${COLOR_INDICES.border}m`,
  muted: `\x1b[38;5;${COLOR_INDICES.muted}m`,
  cyan: `\x1b[38;5;${COLOR_INDICES.accent}m`,
  green: `\x1b[38;5;${COLOR_INDICES.ok}m`,
  yellow: `\x1b[38;5;${COLOR_INDICES.warn}m`,
  orange: `\x1b[38;5;${COLOR_INDICES.hot}m`,
  red: `\x1b[38;5;${COLOR_INDICES.danger}m`,
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
