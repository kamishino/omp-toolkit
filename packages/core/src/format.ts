export function money(value: number | undefined, unit: string | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const normalized = unit?.trim().toLowerCase();
  const symbol = normalized === "cny" ? "¥" : normalized === "usd" ? "$" : "";
  const amount = value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${symbol}${amount}`;
}

export function formatAge(checkedAt: number | undefined, now: number, coarse = false): string {
  if (!checkedAt) return "no snapshot";
  const seconds = Math.max(0, Math.round((now - checkedAt) / 1000));
  if (coarse) {
    const minutes = Math.floor(seconds / 60);
    if (minutes < 1) return "<1m ago";
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
  }
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export function formatPercent(value: number | undefined): string {
  return value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
}

export function padPercent(value: number | undefined, width = 6): string {
  return formatPercent(value).padStart(width);
}

export function formatResetCompact(resetsAt: number | undefined, now: number): string {
  if (typeof resetsAt !== "number" || !Number.isFinite(resetsAt)) return "—";
  const delta = resetsAt - now;
  if (delta <= 0) return "now";
  const minutes = Math.floor(delta / 60_000);
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${mins}m`;
  return `${mins}m`;
}

export function padResetCompact(
  resetsAt: number | undefined,
  now: number = Date.now(),
  width = 6,
): string {
  return formatResetCompact(resetsAt, now).padStart(width);
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return max <= 3 ? text.slice(0, max) : `${text.slice(0, max - 3)}...`;
}
