import type { TimeWindow, TimeWindowPolicy, WindowEvaluation } from "./types";
import { formatDuration, getZonedTime } from "./zoned-time";

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
