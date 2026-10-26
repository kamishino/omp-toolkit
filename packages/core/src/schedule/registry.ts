import { DEEPSEEK_POLICY } from "./deepseek-policy";
import { buildScheduleTable } from "./timetable";
import type { ScheduleRow, TimeWindowPolicy, WindowEvaluation } from "./types";
import { evaluateWindow } from "./window";

/**
 * Deep Domain Schedule Registry.
 *
 * Encapsulates:
 * - Registration and storage of provider time-window pricing policies
 * - One-step point-in-time pricing window evaluation (rate multiplier, peak status, transition countdown)
 * - Schedule timetable generation for UI presentation
 */
export class ScheduleRegistry {
  private readonly policies = new Map<string, TimeWindowPolicy>();

  constructor(initialPolicies: readonly TimeWindowPolicy[] = [DEEPSEEK_POLICY]) {
    for (const policy of initialPolicies) {
      this.register(policy);
    }
  }

  register(policy: TimeWindowPolicy): void {
    this.policies.set(policy.provider, policy);
  }

  get(provider: string): TimeWindowPolicy | undefined {
    return this.policies.get(provider);
  }

  all(): TimeWindowPolicy[] {
    return Array.from(this.policies.values());
  }

  evaluate(
    provider: string,
    timestampMs: number = Date.now(),
    userTimeZone = "UTC",
  ): WindowEvaluation | null {
    const policy = this.get(provider);
    if (!policy) return null;
    return evaluateWindow(policy, timestampMs, userTimeZone);
  }

  buildTable(
    provider: string,
    timestampMs: number = Date.now(),
    userTimeZone = "UTC",
  ): ScheduleRow[] | null {
    const policy = this.get(provider);
    if (!policy) return null;
    return buildScheduleTable(policy, timestampMs, userTimeZone);
  }
}

export const scheduleRegistry = new ScheduleRegistry();

export function registerTimeWindowPolicy(policy: TimeWindowPolicy): void {
  scheduleRegistry.register(policy);
}

export function getTimeWindowPolicy(provider: string): TimeWindowPolicy | undefined {
  return scheduleRegistry.get(provider);
}

export function getAllTimeWindowPolicies(): TimeWindowPolicy[] {
  return scheduleRegistry.all();
}
