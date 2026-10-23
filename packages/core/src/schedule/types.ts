export type WindowType = "peak" | "off-peak";

export interface TimeWindow {
  type: WindowType;
  /** ISO days of the week: 1 = Monday ... 7 = Sunday */
  days: number[];
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  rateMultiplier: number;
  discountPercent: number;
}

export interface TimeWindowPolicy {
  provider: string;
  name: string;
  referenceTimeZone: string;
  windows: TimeWindow[];
  defaultWindow: TimeWindow;
}

export interface WindowEvaluation {
  provider: string;
  evaluatedAt: number;
  referenceTimeZone: string;
  userTimeZone: string;
  activeWindow: TimeWindow;
  isPeak: boolean;
  rateMultiplier: number;
  discountPercent: number;
  nextTransitionAt: number;
  timeUntilNextMs: number;
  formattedTimeUntilNext: string;
  label: string;
  badgeText: string;
}

export interface ScheduleRow {
  dayName: string;
  dayNumber: number;
  windowType: WindowType;
  referenceTime: string;
  localTime: string;
  rateMultiplier: number;
  discountPercent: number;
  isCurrent: boolean;
}
