import { buildScheduleTable } from "./timetable";
import type { ScheduleRow, TimeWindowPolicy, WindowEvaluation } from "./types";
import { evaluateWindow } from "./window";

export { buildScheduleTable } from "./timetable";
export { evaluateWindow } from "./window";
export { formatDuration } from "./zoned-time";

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
