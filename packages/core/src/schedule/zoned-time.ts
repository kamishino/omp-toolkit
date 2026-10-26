export interface ZonedTime {
  isoDay: number;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const DAY_MAP: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export function getZonedTime(timestampMs: number, timeZone: string): ZonedTime {
  const d = new Date(timestampMs);
  if (timeZone === "UTC" || timeZone === "Etc/UTC") {
    const day = d.getUTCDay();
    return {
      isoDay: day === 0 ? 7 : day,
      year: d.getUTCFullYear(),
      month: d.getUTCMonth(),
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
    };
  }

  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });

  const parts = dtf.formatToParts(d);
  let weekdayStr = "";
  let year = d.getUTCFullYear();
  let month = d.getUTCMonth();
  let day = d.getUTCDate();
  let hour = 0;
  let minute = 0;
  let second = 0;

  for (const p of parts) {
    if (p.type === "weekday") weekdayStr = p.value;
    else if (p.type === "year") year = Number.parseInt(p.value, 10);
    else if (p.type === "month") month = Number.parseInt(p.value, 10) - 1;
    else if (p.type === "day") day = Number.parseInt(p.value, 10);
    else if (p.type === "hour") hour = Number.parseInt(p.value, 10);
    else if (p.type === "minute") minute = Number.parseInt(p.value, 10);
    else if (p.type === "second") second = Number.parseInt(p.value, 10);
  }

  return {
    isoDay: DAY_MAP[weekdayStr] ?? 1,
    year,
    month,
    day,
    hour,
    minute,
    second,
  };
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}
