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
