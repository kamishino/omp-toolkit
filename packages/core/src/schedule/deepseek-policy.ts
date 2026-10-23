import type { TimeWindowPolicy } from "./types";

/**
 * Authoritative DeepSeek API time-of-day pricing schedule.
 *
 * Peak hours (Mon-Fri 01:00-04:00 UTC and 06:00-10:00 UTC) bill at standard rates.
 * Off-peak hours (all other weekday hours + 100% of weekends) receive a 50% discount.
 */
export const DEEPSEEK_POLICY: TimeWindowPolicy = {
  provider: "deepseek",
  name: "DeepSeek API Time-of-Day Pricing",
  referenceTimeZone: "UTC",
  windows: [
    {
      type: "peak",
      days: [1, 2, 3, 4, 5], // Monday through Friday
      startHour: 1,
      startMinute: 0,
      endHour: 4,
      endMinute: 0,
      rateMultiplier: 1.0,
      discountPercent: 0,
    },
    {
      type: "peak",
      days: [1, 2, 3, 4, 5], // Monday through Friday
      startHour: 6,
      startMinute: 0,
      endHour: 10,
      endMinute: 0,
      rateMultiplier: 1.0,
      discountPercent: 0,
    },
  ],
  defaultWindow: {
    type: "off-peak",
    days: [1, 2, 3, 4, 5, 6, 7],
    startHour: 0,
    startMinute: 0,
    endHour: 24,
    endMinute: 0,
    rateMultiplier: 0.5,
    discountPercent: 50,
  },
};
