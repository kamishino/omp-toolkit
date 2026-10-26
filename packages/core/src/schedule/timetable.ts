import type { ScheduleRow, TimeWindowPolicy, WindowEvaluation } from "./types";
import { evaluateWindow } from "./window";

export const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export function formatMin(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

export function isMatchingWindow(
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

export function formatLocalInterval(
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

export function createScheduleRow(
  dayName: string,
  dayNumber: number,
  windowType: "peak" | "off-peak",
  startMin: number,
  endMin: number,
  rateMultiplier: number,
  discountPercent: number,
  isCurrent: boolean,
  timestampMs: number,
  userTimeZone: string,
): ScheduleRow {
  return {
    dayName,
    dayNumber,
    windowType,
    referenceTime: `${formatMin(startMin)} - ${formatMin(endMin)} UTC`,
    localTime: formatLocalInterval(
      timestampMs,
      dayNumber,
      Math.floor(startMin / 60),
      startMin % 60,
      Math.floor(endMin / 60),
      endMin % 60,
      userTimeZone,
    ),
    rateMultiplier,
    discountPercent,
    isCurrent,
  };
}

export function buildScheduleTable(
  policy: TimeWindowPolicy,
  timestampMs: number,
  userTimeZone = "UTC",
): ScheduleRow[] {
  const currentEval = evaluateWindow(policy, timestampMs, userTimeZone);
  const rows: ScheduleRow[] = [];

  for (let dayNum = 1; dayNum <= 7; dayNum++) {
    const dayName = DAY_NAMES[dayNum - 1];
    const peakWindowsForDay = policy.windows
      .filter((w) => w.type === "peak" && w.days.includes(dayNum))
      .sort((a, b) => a.startHour * 60 + a.startMinute - (b.startHour * 60 + b.startMinute));

    if (peakWindowsForDay.length === 0) {
      const isCurrentDay = new Date(timestampMs).getUTCDay() === (dayNum === 7 ? 0 : dayNum);
      rows.push(
        createScheduleRow(
          dayName,
          dayNum,
          "off-peak",
          0,
          24 * 60,
          policy.defaultWindow.rateMultiplier,
          policy.defaultWindow.discountPercent,
          isCurrentDay && !currentEval.isPeak,
          timestampMs,
          userTimeZone,
        ),
      );
      continue;
    }

    let currentMin = 0;
    for (const peakWin of peakWindowsForDay) {
      const peakStartMin = peakWin.startHour * 60 + peakWin.startMinute;
      const peakEndMin = peakWin.endHour * 60 + peakWin.endMinute;

      if (currentMin < peakStartMin) {
        const isCurrent = isMatchingWindow(
          timestampMs,
          dayNum,
          currentMin,
          peakStartMin,
          currentEval,
        );
        rows.push(
          createScheduleRow(
            dayName,
            dayNum,
            "off-peak",
            currentMin,
            peakStartMin,
            policy.defaultWindow.rateMultiplier,
            policy.defaultWindow.discountPercent,
            isCurrent,
            timestampMs,
            userTimeZone,
          ),
        );
      }

      const isCurrentPeak = isMatchingWindow(
        timestampMs,
        dayNum,
        peakStartMin,
        peakEndMin,
        currentEval,
      );
      rows.push(
        createScheduleRow(
          dayName,
          dayNum,
          "peak",
          peakStartMin,
          peakEndMin,
          peakWin.rateMultiplier,
          peakWin.discountPercent,
          isCurrentPeak,
          timestampMs,
          userTimeZone,
        ),
      );

      currentMin = peakEndMin;
    }

    if (currentMin < 24 * 60) {
      const isCurrent = isMatchingWindow(timestampMs, dayNum, currentMin, 24 * 60, currentEval);
      rows.push(
        createScheduleRow(
          dayName,
          dayNum,
          "off-peak",
          currentMin,
          24 * 60,
          policy.defaultWindow.rateMultiplier,
          policy.defaultWindow.discountPercent,
          isCurrent,
          timestampMs,
          userTimeZone,
        ),
      );
    }
  }

  return rows;
}
