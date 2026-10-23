import type { ScheduleRow, TimeWindow, TimeWindowPolicy, WindowEvaluation } from "./types";

interface ZonedTime {
  isoDay: number;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function getZonedTime(timestampMs: number, timeZone: string): ZonedTime {
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

  const dayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };

  return {
    isoDay: dayMap[weekdayStr] ?? 1,
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

export function evaluateWindow(
  policy: TimeWindowPolicy,
  timestampMs: number,
  userTimeZone?: string,
): WindowEvaluation {
  const tz = userTimeZone || "UTC";
  const refTime = getZonedTime(timestampMs, policy.referenceTimeZone);
  const currentMinuteOfDay = refTime.hour * 60 + refTime.minute;

  // Check matching explicit window
  let activeWindow: TimeWindow | null = null;
  for (const win of policy.windows) {
    if (!win.days.includes(refTime.isoDay)) continue;
    const startMin = win.startHour * 60 + win.startMinute;
    const endMin = win.endHour * 60 + win.endMinute;
    if (currentMinuteOfDay >= startMin && currentMinuteOfDay < endMin) {
      activeWindow = win;
      break;
    }
  }

  const isPeak = activeWindow?.type === "peak";
  const currentWindow = activeWindow ?? policy.defaultWindow;

  // Calculate next transition
  let nextTransitionAt: number;

  if (isPeak && activeWindow) {
    // Current window ends at activeWindow.endHour:activeWindow.endMinute
    const endTs = Date.UTC(
      refTime.year,
      refTime.month,
      refTime.day,
      activeWindow.endHour,
      activeWindow.endMinute,
      0,
      0,
    );
    nextTransitionAt = endTs;
  } else {
    // Currently off-peak: search for next peak window starting in the future
    let candidateTransition: number | null = null;

    for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
      const candidateDayNum = ((refTime.isoDay - 1 + dayOffset) % 7) + 1;
      for (const win of policy.windows) {
        if (win.type !== "peak") continue;
        if (!win.days.includes(candidateDayNum)) continue;

        const candidateStartTs = Date.UTC(
          refTime.year,
          refTime.month,
          refTime.day + dayOffset,
          win.startHour,
          win.startMinute,
          0,
          0,
        );

        if (candidateStartTs > timestampMs) {
          if (candidateTransition === null || candidateStartTs < candidateTransition) {
            candidateTransition = candidateStartTs;
          }
        }
      }
      if (candidateTransition !== null) break;
    }

    nextTransitionAt = candidateTransition ?? timestampMs + 86400000;
  }

  const timeUntilNextMs = Math.max(0, nextTransitionAt - timestampMs);
  const formattedTimeUntilNext = formatDuration(timeUntilNextMs);
  const label = isPeak ? "PEAK: 2× Rate" : "OFF-PEAK: 50% OFF";
  const nextTargetName = isPeak ? "Off-Peak" : "Peak";
  const badgeText = `[${label} · Next ${nextTargetName} in ${formattedTimeUntilNext}]`;

  return {
    provider: policy.provider,
    evaluatedAt: timestampMs,
    referenceTimeZone: policy.referenceTimeZone,
    userTimeZone: tz,
    activeWindow: currentWindow,
    isPeak,
    rateMultiplier: currentWindow.rateMultiplier,
    discountPercent: currentWindow.discountPercent,
    nextTransitionAt,
    timeUntilNextMs,
    formattedTimeUntilNext,
    label,
    badgeText,
  };
}

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function buildScheduleTable(
  policy: TimeWindowPolicy,
  timestampMs: number,
  userTimeZone = "UTC",
): ScheduleRow[] {
  const currentEval = evaluateWindow(policy, timestampMs, userTimeZone);
  const rows: ScheduleRow[] = [];

  // For each day 1..7 (Mon..Sun)
  for (let dayNum = 1; dayNum <= 7; dayNum++) {
    const dayName = DAY_NAMES[dayNum - 1];
    const peakWindowsForDay = policy.windows
      .filter((w) => w.type === "peak" && w.days.includes(dayNum))
      .sort((a, b) => a.startHour * 60 + a.startMinute - (b.startHour * 60 + b.startMinute));

    if (peakWindowsForDay.length === 0) {
      // Entire day is off-peak
      const isCurrentDay = new Date(timestampMs).getUTCDay() === (dayNum === 7 ? 0 : dayNum);
      rows.push({
        dayName,
        dayNumber: dayNum,
        windowType: "off-peak",
        referenceTime: "00:00 - 24:00 UTC",
        localTime: formatLocalInterval(timestampMs, dayNum, 0, 0, 24, 0, userTimeZone),
        rateMultiplier: policy.defaultWindow.rateMultiplier,
        discountPercent: policy.defaultWindow.discountPercent,
        isCurrent: isCurrentDay && !currentEval.isPeak,
      });
      continue;
    }

    // Compose intervals: off-peak -> peak -> off-peak ...
    let currentMin = 0;
    for (const peakWin of peakWindowsForDay) {
      const peakStartMin = peakWin.startHour * 60 + peakWin.startMinute;
      const peakEndMin = peakWin.endHour * 60 + peakWin.endMinute;

      if (currentMin < peakStartMin) {
        // Off-peak gap before this peak window
        const isCurrent = isMatchingWindow(
          timestampMs,
          dayNum,
          currentMin,
          peakStartMin,
          currentEval,
        );
        rows.push({
          dayName,
          dayNumber: dayNum,
          windowType: "off-peak",
          referenceTime: `${formatMin(currentMin)} - ${formatMin(peakStartMin)} UTC`,
          localTime: formatLocalInterval(
            timestampMs,
            dayNum,
            Math.floor(currentMin / 60),
            currentMin % 60,
            peakWin.startHour,
            peakWin.startMinute,
            userTimeZone,
          ),
          rateMultiplier: policy.defaultWindow.rateMultiplier,
          discountPercent: policy.defaultWindow.discountPercent,
          isCurrent,
        });
      }

      // Peak window
      const isCurrentPeak = isMatchingWindow(
        timestampMs,
        dayNum,
        peakStartMin,
        peakEndMin,
        currentEval,
      );
      rows.push({
        dayName,
        dayNumber: dayNum,
        windowType: "peak",
        referenceTime: `${formatMin(peakStartMin)} - ${formatMin(peakEndMin)} UTC`,
        localTime: formatLocalInterval(
          timestampMs,
          dayNum,
          peakWin.startHour,
          peakWin.startMinute,
          peakWin.endHour,
          peakWin.endMinute,
          userTimeZone,
        ),
        rateMultiplier: peakWin.rateMultiplier,
        discountPercent: peakWin.discountPercent,
        isCurrent: isCurrentPeak,
      });

      currentMin = peakEndMin;
    }

    if (currentMin < 24 * 60) {
      // Remaining off-peak gap until midnight
      const isCurrent = isMatchingWindow(timestampMs, dayNum, currentMin, 24 * 60, currentEval);
      rows.push({
        dayName,
        dayNumber: dayNum,
        windowType: "off-peak",
        referenceTime: `${formatMin(currentMin)} - 24:00 UTC`,
        localTime: formatLocalInterval(
          timestampMs,
          dayNum,
          Math.floor(currentMin / 60),
          currentMin % 60,
          24,
          0,
          userTimeZone,
        ),
        rateMultiplier: policy.defaultWindow.rateMultiplier,
        discountPercent: policy.defaultWindow.discountPercent,
        isCurrent,
      });
    }
  }

  return rows;
}

function formatMin(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function isMatchingWindow(
  timestampMs: number,
  dayNum: number,
  startMin: number,
  endMin: number,
  currentEval: WindowEvaluation,
): boolean {
  const d = new Date(timestampMs);
  const isoDay = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  if (isoDay !== dayNum) return false;
  const currentMinuteOfDay = d.getUTCHours() * 60 + d.getUTCMinutes();
  return (
    currentMinuteOfDay >= startMin &&
    currentMinuteOfDay < endMin &&
    (currentEval.isPeak ? startMin < endMin : true)
  );
}

function formatLocalInterval(
  anchorTimestampMs: number,
  dayNum: number,
  startH: number,
  startM: number,
  endH: number,
  endM: number,
  userTimeZone: string,
): string {
  const anchorDate = new Date(anchorTimestampMs);
  const currentIsoDay = anchorDate.getUTCDay() === 0 ? 7 : anchorDate.getUTCDay();
  const dayDelta = dayNum - currentIsoDay;

  const startUtc = Date.UTC(
    anchorDate.getUTCFullYear(),
    anchorDate.getUTCMonth(),
    anchorDate.getUTCDate() + dayDelta,
    startH,
    startM,
    0,
  );

  const endUtc = Date.UTC(
    anchorDate.getUTCFullYear(),
    anchorDate.getUTCMonth(),
    anchorDate.getUTCDate() + dayDelta,
    endH,
    endM,
    0,
  );

  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: userTimeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const formattedStart = dtf.format(new Date(startUtc));
  const formattedEnd = dtf.format(new Date(endUtc));
  return `${formattedStart} - ${formattedEnd}`;
}
/**
 * Deep domain module encapsulating time window policy evaluation,
 * timezone-aware transition countdowns, and schedule table generation.
 */
export class ScheduleEvaluator {
  readonly policy: TimeWindowPolicy;

  constructor(policy: TimeWindowPolicy) {
    this.policy = policy;
  }

  evaluate(timestampMs: number = Date.now(), userTimeZone = "UTC"): WindowEvaluation {
    return evaluateWindow(this.policy, timestampMs, userTimeZone);
  }

  buildTable(timestampMs: number = Date.now(), userTimeZone = "UTC"): ScheduleRow[] {
    return buildScheduleTable(this.policy, timestampMs, userTimeZone);
  }

  getNextTransition(timestampMs: number = Date.now()): {
    nextTransitionAt: number;
    timeUntilNextMs: number;
    formattedTimeUntilNext: string;
    isPeak: boolean;
  } {
    const res = this.evaluate(timestampMs);
    return {
      nextTransitionAt: res.nextTransitionAt,
      timeUntilNextMs: res.timeUntilNextMs,
      formattedTimeUntilNext: res.formattedTimeUntilNext,
      isPeak: res.isPeak,
    };
  }
}
