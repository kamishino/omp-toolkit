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

export function colorFor(value: number | undefined): string {
  if (value === undefined) return ANSI.muted;
  if (value >= USAGE_THRESHOLDS.critical) return ANSI.red;
  if (value >= USAGE_THRESHOLDS.hot) return ANSI.orange;
  if (value >= USAGE_THRESHOLDS.warm) return ANSI.yellow;
  return ANSI.green;
}

export function bar(value: number | undefined, width = 10): string {
  if (value === undefined) return "░".repeat(width);
  const filled = Math.round(value * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function percent(value: number | undefined): string {
  return value === undefined ? "     —" : `${(value * 100).toFixed(1)}%`.padStart(6);
}

export function resetIn(limit: { window?: { resetsAt?: number } } | undefined): string {
  const resetsAt = limit?.window?.resetsAt;
  if (typeof resetsAt !== "number" || !Number.isFinite(resetsAt)) return "     —";
  const delta = resetsAt - Date.now();
  if (delta <= 0) return "   now";
  const minutes = Math.floor(delta / 60_000);
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d${hours}h`.padStart(6);
  if (hours > 0) return `${hours}h${mins}m`.padStart(6);
  return `${mins}m`.padStart(6);
}

export function healthAge(checkedAt: number | undefined): string {
  if (!checkedAt) return "no snapshot";
  const seconds = Math.max(0, Math.round((Date.now() - checkedAt) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}
